import type {
  Centre,
  CentreSourceRef,
  Geo,
  GeoCandidate,
  GeoExpectation,
  ParsedCentre,
} from '@ielts-map/core';
import {
  isPlausibleForCountry,
  mergeFormats,
  mergeOfferings,
  pickCanonical,
  precisionTier,
  resolveGeo,
  scoreCandidate,
  slugBase,
} from '@ielts-map/core';
import {
  GeocodeCache,
  nominatim,
  providerChain,
  toCandidates,
  type GeocodeProvider,
} from './geocode.ts';
import { streetLine } from './address.ts';

const SOURCE_NAME = 'IELTS.org';

export interface ResolveOptions {
  /** The committed record for this centre, if it already existed. */
  previous?: Centre | undefined;
  /** Re-resolve locations even when the address is unchanged. Costs money. */
  regeocode?: boolean;
  /** Try Google before Nominatim. See providerChain's doc for when this is right. */
  preferGoogle?: boolean;
}

/** Turn one dedup cluster into the single Centre record we publish. */
export async function resolveCluster(
  cluster: ParsedCentre[],
  cache: GeocodeCache,
  options: ResolveOptions = {},
): Promise<Centre> {
  const canonical = pickCanonical(cluster);
  const offerings = mergeOfferings(cluster);
  const formats = mergeFormats(offerings);

  const priced = offerings.filter((o) => o.price !== null);
  const priceFrom = priced.length ? Math.min(...priced.map((o) => o.price!)) : null;
  const currency = priced[0]?.currency ?? null;

  const located = await resolveLocation(canonical, cluster, cache, options);
  const geo = located.geo;

  const now = new Date().toISOString();
  const sources: CentreSourceRef[] = cluster.map((c) => ({
    source: SOURCE_NAME,
    externalSlug: c.slug,
    url: c.url,
    seenAt: c.fetchedAt,
    stillPresent: true,
  }));

  const isActive = offerings.length > 0;
  const confidence = scoreConfidence(canonical, cluster, offerings.length, geo);

  return {
    id: centreId(canonical),
    name: canonical.name,
    operator: canonical.operator,
    operatorSource: canonical.operatorSource,
    externalId: cluster.find((c) => c.externalId)?.externalId ?? null,
    ieltsOrgSlug: canonical.slug,
    mergedSlugs: cluster.map((c) => c.slug).filter((s) => s !== canonical.slug).sort(),
    address: canonical.address,
    phone: cluster.find((c) => c.phone)?.phone ?? null,
    geo,
    googlePlaceId: located.placeId,
    formats,
    offerings,
    priceFrom,
    currency,
    bookingUrl: cluster.find((c) => c.bookingUrl)?.bookingUrl ?? null,
    isActive,
    confidence,
    sources,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

/**
 * Stable id. British Council centres key on their real `location=` id; every
 * other centre keys on the slug base, which survives the `…-2` duplicate-page
 * pattern. Stability matters because these ids will become primary keys when
 * the dataset moves to Postgres.
 */
/**
 * The id a cluster will be published under, computed without resolving it — so
 * the caller can look up the previous record and skip geocoding entirely.
 */
export function clusterId(cluster: ParsedCentre[]): string {
  return centreId(pickCanonical(cluster));
}

function centreId(canonical: ParsedCentre): string {
  if (canonical.operator === 'British Council' && canonical.externalId) {
    return `bc-${canonical.externalId}`;
  }
  return slugBase(canonical.slug);
}

/**
 * Location cascade (§5.3): an embedded page coordinate wins outright; otherwise
 * geocode the address *and* the name and let the scoring rule pick, because
 * those two fail in opposite situations.
 */
async function resolveLocation(
  canonical: ParsedCentre,
  cluster: ParsedCentre[],
  cache: GeocodeCache,
  options: ResolveOptions,
): Promise<{ geo: Geo | null; placeId: string | null }> {
  const { address, name } = canonical;

  // A page-embedded coordinate is normally trusted outright, but two real
  // pages have shown it can't be trusted blindly: a Manchester, UK centre
  // embedded `53.48098,2.23259` — a sign error putting the pin over the North
  // Sea instead of at -2.23259°W — and a Hai Phong, Vietnam one embedded the
  // literal placeholder `1,1` (Gulf of Guinea). Neither looks malformed on its
  // own, so implausibility relative to the centre's known country is the only
  // signal that catches them; where the country is unknown or uncovered by
  // country-bounds.ts, this stays permissive and keeps trusting the embed
  // exactly as before.
  const embedded = cluster
    .map((c) => c.embeddedGeo)
    .find((g): g is { lat: number; lng: number } => {
      if (!g) return false;
      if (isPlausibleForCountry(g.lat, g.lng, address.country)) return true;
      console.warn(
        `    ⚠ discarding implausible embedded coordinate for "${canonical.name}": ` +
          `${g.lat},${g.lng} is not in ${address.country} — falling back to geocoding`,
      );
      return false;
    });

  // Cheapest path of all: this centre is already resolved and its address has
  // not moved, so there is nothing to look up. This is what keeps a scheduled
  // run from re-billing every address every week — the query cache alone would
  // not, since any change to address parsing rewrites the cache keys.
  //
  // The committed geo is re-checked against the same plausibility gate as a
  // fresh embed, not just trusted because it's already there: the committed
  // dataset can itself hold a coordinate carried forward from before this gate
  // existed (Manchester, Hai Phong — see above). Without this, fixing the
  // fresh-embed case above would still leave the bad value in place forever,
  // since address-unchanged would keep re-approving it every run.
  const prior = options.previous;
  if (
    !options.regeocode &&
    prior?.geo &&
    prior.address.raw === canonical.address.raw &&
    isPlausibleForCountry(prior.geo.lat, prior.geo.lng, canonical.address.country) &&
    // A (plausible) page-embedded coordinate always wins, so let it take over
    // if the page has gained one since.
    !embedded
  ) {
    return { geo: prior.geo, placeId: prior.googlePlaceId };
  }

  if (embedded) {
    return {
      geo: {
        lat: embedded.lat,
        lng: embedded.lng,
        precision: 'rooftop',
        source: 'page_embed',
        confidence: 0.9,
      },
      placeId: null,
    };
  }

  const country = address.country;
  const candidates: GeoCandidate[] = [];
  const chain = providerChain(country, options.preferGoogle);
  const expect = { postcode: address.postcode, city: address.city, country };

  const street = streetLine(address.lines);

  // Below this, a query is worth trying; at or above, the chain already has
  // enough to stop. Applied before *every* query, not just the last one —
  // structured, raw-address and name all cost a real billed call on Google,
  // and running the other two after structured alone already lands a rooftop
  // hit would spend calls for no improvement. This is what "only when
  // necessary" means in practice, not just which provider goes first.
  const goodEnough = () => bestTier(candidates, expect) >= precisionTier('street');

  const runProvider = async (provider: GeocodeProvider): Promise<void> => {
    const add = async (q: Parameters<GeocodeProvider['lookup']>[0]) => {
      candidates.push(...toCandidates(await cache.lookup(provider, q), provider.name));
    };

    // Structured first. Free-text geocoding trips over the unit, suite and
    // floor designators these addresses are full of — "Unit 210, Bentinck St
    // Level, 500 George St" resolved only to the city — whereas naming the
    // street, city and postcode as separate fields resolves the building.
    if (street) {
      await add({
        structured: {
          street,
          city: address.city,
          state: address.region,
          postalcode: address.postcode,
        },
        country,
      });
    }

    // The address query and the name query fail in opposite situations, so
    // either can be needed: a centre whose name is just a city geocodes from
    // its address, and one with a vague address geocodes from its (precise
    // institutional) name. Neither runs once something street-level or better
    // has already been found.
    if (!goodEnough() && address.raw) await add({ text: address.raw, country });

    if (!goodEnough()) {
      const named = [name, address.city, address.region].filter(Boolean).join(', ');
      if (named) await add({ text: named, country });
    }
  };

  // Walk the chain in order, stopping as soon as a provider lands a
  // street-level-or-better hit. With a Google key configured that is almost
  // always the first provider, so Nominatim is only consulted for the tail.
  for (const provider of chain) {
    await runProvider(provider);
    if (bestTier(candidates, expect) >= precisionTier('street')) break;
  }

  const tryQuery = async (text: string | null): Promise<void> => {
    if (!text) return;
    candidates.push(
      ...toCandidates(await cache.lookup(nominatim, { text, country }), 'nominatim'),
    );
  };

  // Coarser rungs, tried only if no provider managed better. The trigger is
  // candidate *quality*, not emptiness: a geocoder that answers a full street
  // address with a country centroid has technically returned something, and
  // stopping there pins a centre in the middle of the country when its postcode
  // would have placed it within a few blocks.
  const needsBetter = () => bestTier(candidates, expect) < precisionTier('postcode');

  if (needsBetter() && street) {
    await tryQuery([street, address.city, address.region, address.postcode].filter(Boolean).join(', '));
  }
  if (needsBetter() && address.postcode) {
    await tryQuery([address.postcode, address.city].filter(Boolean).join(', '));
    if (needsBetter()) await tryQuery(address.postcode);
  }
  if (candidates.length === 0) {
    await tryQuery([address.city, address.region].filter(Boolean).join(', ') || null);
  }

  const resolved = resolveGeo(candidates, expect);
  if (!resolved) return { geo: null, placeId: null };

  // The Place ID moves onto the centre; the stored coordinate keeps only the
  // fields the dataset schema defines.
  const { placeId, ...geo } = resolved;
  return { geo, placeId: placeId ?? null };
}

/** Best precision tier among candidates that survive the country check. */
function bestTier(candidates: GeoCandidate[], expect: GeoExpectation): number {
  let best = -1;
  for (const c of candidates) {
    if (scoreCandidate(c, expect) === null) continue;
    best = Math.max(best, precisionTier(c.precision));
  }
  return best;
}

/**
 * Cross-source agreement, 0..1. Note what is deliberately *absent*: neither the
 * live IDP finder nor Google "permanently closed" is consulted yet (M1.5 and
 * M3), so no operator gets a liveness boost here and none is penalised for a
 * check we have not run.
 */
function scoreConfidence(
  canonical: ParsedCentre,
  cluster: ParsedCentre[],
  offeringCount: number,
  geo: Geo | null,
): number {
  let score = 0.2;
  if (canonical.operatorSource === 'booking_domain') score += 0.3;
  else if (canonical.operatorSource !== 'unknown') score += 0.1;
  if (canonical.bookingUrl) score += 0.1;
  if (canonical.address.postcode) score += 0.1;
  if (offeringCount > 0) score += 0.1;
  if (geo) {
    const tier = precisionTier(geo.precision);
    if (tier >= 3) score += 0.2;
    else if (tier === 2) score += 0.1;
  }
  // Two pages describing the same centre corroborate each other.
  if (cluster.length > 1) score += 0.05;

  return Number(Math.min(1, score).toFixed(2));
}
