import type {
  Centre,
  CentreSourceRef,
  Geo,
  GeoCandidate,
  GeoExpectation,
  ParsedCentre,
} from '@ielts-map/core';
import {
  mergeFormats,
  mergeOfferings,
  pickCanonical,
  precisionTier,
  resolveGeo,
  scoreCandidate,
  slugBase,
} from '@ielts-map/core';
import { GeocodeCache, nominatim, toCandidates } from './geocode.ts';
import { streetLine } from './address.ts';

const SOURCE_NAME = 'IELTS.org';

/** Turn one dedup cluster into the single Centre record we publish. */
export async function resolveCluster(
  cluster: ParsedCentre[],
  cache: GeocodeCache,
): Promise<Centre> {
  const canonical = pickCanonical(cluster);
  const offerings = mergeOfferings(cluster);
  const formats = mergeFormats(offerings);

  const priced = offerings.filter((o) => o.price !== null);
  const priceFrom = priced.length ? Math.min(...priced.map((o) => o.price!)) : null;
  const currency = priced[0]?.currency ?? null;

  const geo = await resolveLocation(canonical, cluster, cache);

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
): Promise<Geo | null> {
  const embedded = cluster.find((c) => c.embeddedGeo)?.embeddedGeo;
  if (embedded) {
    return {
      lat: embedded.lat,
      lng: embedded.lng,
      precision: 'rooftop',
      source: 'page_embed',
      confidence: 0.9,
    };
  }

  const { address, name } = canonical;
  const country = address.country;
  const candidates: GeoCandidate[] = [];

  const tryQuery = async (text: string | null): Promise<void> => {
    if (!text) return;
    candidates.push(
      ...toCandidates(await cache.lookup(nominatim, { text, country }), 'nominatim'),
    );
  };

  // Structured first. Free-text geocoding trips over the unit, suite and floor
  // designators these addresses are full of — "Unit 210, Bentinck St Level,
  // 500 George St" resolved only to the city — whereas naming the street,
  // city and postcode as separate fields resolves the building.
  const street = streetLine(address.lines);
  if (street) {
    candidates.push(
      ...toCandidates(
        await cache.lookup(nominatim, {
          structured: {
            street,
            city: address.city,
            state: address.region,
            postalcode: address.postcode,
          },
          country,
        }),
        'nominatim',
      ),
    );
  }

  // The address query and the name query fail in opposite situations, so both
  // run: a centre whose name is just a city geocodes from its address, and one
  // with a vague address geocodes from its (precise institutional) name.
  await tryQuery(address.raw || null);
  await tryQuery([name, address.city, address.region].filter(Boolean).join(', ') || null);

  const expect = { postcode: address.postcode, city: address.city, country };

  // Keep climbing while the best hit so far is coarser than postcode level.
  // The trigger is candidate *quality*, not emptiness: a geocoder that answers
  // a full street address with a country centroid has technically returned
  // something, and stopping there pins a centre in the middle of the country
  // when its postcode would have placed it within a few blocks.
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

  return resolveGeo(candidates, expect);
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
