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
  hasPricedOffering,
  mergeContactInformation,
  mergeFormats,
  mergeOfferings,
  pickCanonical,
  precisionTier,
  resolveGeo,
  scoreCandidate,
  slugBase,
} from '@ielts-map/core';
import {
  amapPlaces,
  GeocodeCache,
  gcj02ToWgs84,
  googlePlaces,
  localProviderFor,
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
  /** Retained CLI compatibility; configured production runs use Google. */
  preferGoogle?: boolean;
  /** One-time schema migration: retain an old pin, but mark it unverified. */
  reuseLegacyPrior?: boolean;
}

/** Maximum movement allowed when refining an unchanged coarse coordinate. */
export function localRefinementRadiusKm(precision: Geo['precision']): number {
  if (precision === 'rooftop') return 25;
  if (precision === 'street') return 5;
  return 100;
}

/** Turn one dedup cluster into the single Centre record we publish. */
export async function resolveCluster(
  cluster: ParsedCentre[],
  cache: GeocodeCache,
  options: ResolveOptions = {},
): Promise<Centre> {
  const canonical = pickCanonical(cluster);
  const contact = mergeContactInformation([
    canonical,
    ...cluster.filter((centre) => centre !== canonical),
  ]);
  const offerings = mergeOfferings(cluster);
  const formats = mergeFormats(offerings);

  const priceSummary = summarizePrices(offerings);

  const located = await resolveLocation(canonical, cluster, cache, options);
  const geo = located.geo;
  const address = {
    ...canonical.address,
    city: canonical.address.city ?? located.city,
    citySource: canonical.address.city
      ? canonical.address.citySource ?? 'address_rule'
      : located.citySource,
    region:
      canonical.address.region ??
      (geo?.verification === 'verified' ? located.region : null),
    postcode:
      canonical.address.postcode ??
      (geo?.verification === 'verified' ? located.postcode : null),
  };

  const now = new Date().toISOString();
  const sources: CentreSourceRef[] = cluster.map((c) => ({
    source: SOURCE_NAME,
    externalSlug: c.slug,
    url: c.url,
    seenAt: c.fetchedAt,
    stillPresent: true,
  }));

  const { offersOneSkillRetake, oneSkillRetakeOnly } =
    resolveOneSkillRetakeStatus(cluster, offerings, options.previous);
  // A genuine OSR-only venue has no ordinary full-test fee by definition. Its
  // explicit IELTS.org OSR badge is the narrowly scoped publication exception;
  // ordinary centres still require a source-published price.
  const isPublishable = hasPricedOffering(offerings) || oneSkillRetakeOnly;
  const confidence = scoreConfidence(canonical, cluster, offerings.length, geo);
  const localizations =
    options.previous?.address.raw === canonical.address.raw &&
    sameCoordinate(options.previous.geo, geo)
      ? options.previous.localizations
      : undefined;

  return {
    id: centreId(canonical),
    name: canonical.name,
    operator: canonical.operator,
    operatorSource: canonical.operatorSource,
    externalId: cluster.find((c) => c.externalId)?.externalId ?? null,
    ieltsOrgSlug: canonical.slug,
    mergedSlugs: cluster.map((c) => c.slug).filter((s) => s !== canonical.slug).sort(),
    address,
    ...(localizations?.length ? { localizations } : {}),
    contact,
    phone: contact.phones[0] ?? null,
    geo,
    googlePlaceId: located.placeId,
    formats,
    offerings,
    priceFromText: priceSummary.priceFromText,
    parsedPriceFrom: priceSummary.parsedPriceFrom,
    parsedCurrency: priceSummary.parsedCurrency,
    bookingUrl: cluster.find((c) => c.bookingUrl)?.bookingUrl ?? null,
    offersOneSkillRetake,
    oneSkillRetakeOnly,
    isPublishable,
    confidence,
    sources,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

export function resolveOneSkillRetakeStatus(
  cluster: Pick<ParsedCentre, 'offersOneSkillRetake' | 'oneSkillRetakeOnly'>[],
  offerings: ParsedCentre['offerings'],
  previous?: Pick<Centre, 'offersOneSkillRetake' | 'oneSkillRetakeOnly'>,
): { offersOneSkillRetake: boolean; oneSkillRetakeOnly: boolean } {
  const statusKnown = cluster.some(
    (centre) => centre.offersOneSkillRetake !== undefined,
  );
  if (!statusKnown) {
    return {
      offersOneSkillRetake: previous?.offersOneSkillRetake ?? false,
      oneSkillRetakeOnly: previous?.oneSkillRetakeOnly ?? false,
    };
  }

  const offersOneSkillRetake = cluster.some(
    (centre) => centre.offersOneSkillRetake === true,
  );
  const hasOsrOnlySource = cluster.some(
    (centre) => centre.oneSkillRetakeOnly === true,
  );
  const hasOsrFullTestCard = cluster.some(
    (centre) =>
      centre.offersOneSkillRetake === true &&
      centre.oneSkillRetakeOnly === false,
  );
  const hasFullTestOffering = offerings.some(
    (offering) => offering.kind !== 'life_skills',
  );

  return {
    offersOneSkillRetake,
    oneSkillRetakeOnly:
      offersOneSkillRetake &&
      hasOsrOnlySource &&
      !hasOsrFullTestCard &&
      !hasFullTestOffering,
  };
}

function summarizePrices(offerings: ParsedCentre['offerings']): {
  priceFromText: string | null;
  parsedPriceFrom: number | null;
  parsedCurrency: string | null;
} {
  const published = offerings.filter((offering) => Boolean(offering.priceText));
  if (!published.length) {
    return { priceFromText: null, parsedPriceFrom: null, parsedCurrency: null };
  }

  const parsed = published.filter(
    (offering) =>
      offering.priceParseStatus === 'verified' &&
      offering.parsedPrice !== null &&
      offering.parsedCurrency !== null,
  );
  const currencies = new Set(parsed.map((offering) => offering.parsedCurrency!));
  if (parsed.length && currencies.size === 1) {
    const cheapest = [...parsed].sort((a, b) => a.parsedPrice! - b.parsedPrice!)[0]!;
    return {
      priceFromText: cheapest.priceText,
      parsedPriceFrom: cheapest.parsedPrice,
      parsedCurrency: cheapest.parsedCurrency,
    };
  }

  // Preserve the source fee even when numeric comparison is unavailable.
  return {
    priceFromText: published[0]!.priceText,
    parsedPriceFrom: null,
    parsedCurrency: null,
  };
}

/** A localization remains valid only while both its source address and pin do. */
function sameCoordinate(a: Geo | null, b: Geo | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
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
 * Resolve a location from multiple evidence paths. A page embed is one
 * candidate, never proof: precise publication requires another path to agree.
 */
async function resolveLocation(
  canonical: ParsedCentre,
  cluster: ParsedCentre[],
  cache: GeocodeCache,
  options: ResolveOptions,
): Promise<{
  geo: Geo | null;
  placeId: string | null;
  city: string | null;
  citySource: 'geocoder' | 'legacy' | 'address_rule' | 'admin' | null;
  region: string | null;
  postcode: string | null;
}> {
  const { address, name } = canonical;
  const localProvider = localProviderFor(address.country);
  const prior = options.previous;
  if (
    options.reuseLegacyPrior &&
    prior?.geo &&
    prior.address.raw === canonical.address.raw &&
    isPlausibleForCountry(prior.geo.lat, prior.geo.lng, canonical.address.country)
  ) {
    const sourcePath =
      prior.geo.source === 'page_embed' ? 'page_embed' : 'address';
    return {
      geo: {
        lat: prior.geo.lat,
        lng: prior.geo.lng,
        precision:
          prior.geo.precision === 'rooftop' ? 'street' : prior.geo.precision,
        source: prior.geo.source,
        coordinateSystem: 'WGS84',
        verification: 'unverified',
        evidencePaths: [sourcePath],
        agreementKm: null,
        confidence: Math.min(prior.geo.confidence, 0.4),
      },
      placeId: prior.googlePlaceId,
      city: safeLegacyCity(prior.address.city),
      citySource: safeLegacyCity(prior.address.city) ? 'legacy' : null,
      region: null,
      postcode: null,
    };
  }
  const reusablePrior =
    !options.regeocode &&
    prior?.geo &&
    prior.address.raw === canonical.address.raw &&
    prior.geo.verification === 'verified' &&
    prior.geo.coordinateSystem === 'WGS84' &&
    isPlausibleForCountry(prior.geo.lat, prior.geo.lng, canonical.address.country)
      ? {
          geo: prior.geo,
          placeId: prior.googlePlaceId,
          city: prior.address.city,
          citySource: prior.address.citySource ?? (prior.address.city ? 'legacy' : null),
          region: prior.address.region,
          postcode: prior.address.postcode,
        }
      : null;
  if (reusablePrior) {
    return reusablePrior;
  }

  const country = address.country;
  const candidates: GeoCandidate[] = [];
  const chain = providerChain(country, options.preferGoogle);
  const expect = { postcode: address.postcode, city: address.city, country };
  const street = streetLine(address.lines);
  const plusCode = extractPlusCode(address.raw);
  const lookup = (
    provider: GeocodeProvider,
    query: Parameters<GeocodeProvider['lookup']>[0],
  ) => cache.lookup(provider, query, { force: options.regeocode });

  // Preserve plausible embedded points as candidates. Mainland-China embeds
  // have historically mixed WGS-84 and GCJ-02 semantics, so test both
  // interpretations; only one can corroborate an independent path.
  for (const embedded of cluster.flatMap((centre) =>
    centre.embeddedGeo ? [centre.embeddedGeo] : [],
  )) {
    const interpretations = [
      { lat: embedded.lat, lng: embedded.lng },
      ...(country === 'CN'
        ? [gcj02ToWgs84(embedded.lat, embedded.lng)]
        : []),
    ];
    for (const point of interpretations) {
      if (!isPlausibleForCountry(point.lat, point.lng, country)) continue;
      candidates.push({
        ...point,
        precision: 'street',
        source: 'page_embed',
        evidencePath: 'page_embed',
        coordinateSystem: 'WGS84',
        echoedPostcode: null,
        echoedCity: null,
        echoedRegion: null,
        echoedCountry: country,
      });
    }
  }

  const runProvider = async (
    provider: GeocodeProvider,
    target: GeoCandidate[] = candidates,
  ): Promise<void> => {
    const add = async (
      q: Parameters<GeocodeProvider['lookup']>[0],
      evidencePath: GeoCandidate['evidencePath'],
    ) => {
      target.push(
        ...toCandidates(await lookup(provider, q), provider.name, evidencePath),
      );
    };

    if (street) {
      await add({
        structured: {
          street,
          city: address.city,
          state: address.region,
          postalcode: address.postcode,
        },
        country,
      }, 'address');
    }

    if (
      address.raw &&
      !target.some(
        (candidate) =>
          candidate.source === provider.name &&
          candidate.evidencePath === 'address',
      )
    ) {
      await add({ text: address.raw, country }, 'address');
    }

    if (
      provider.name !== 'amap' &&
      provider.name !== 'google' &&
      resolveGeo(target, expect)?.verification !== 'verified'
    ) {
      const named = [name, address.city, address.region].filter(Boolean).join(', ');
      if (named) await add({ text: named, country }, 'venue_name');
    }
  };

  for (const provider of chain) {
    await runProvider(provider);
    if (resolveGeo(candidates, expect)?.verification === 'verified') break;
  }

  // A Plus Code is an encoded coordinate published by the source, not a
  // second interpretation of its prose address. Treat it as an independent
  // evidence path and use locality context only to expand short codes.
  if (
    plusCode &&
    process.env.GOOGLE_MAPS_API_KEY &&
    resolveGeo(candidates, expect)?.verification !== 'verified'
  ) {
    candidates.push(
      ...toCandidates(
        await lookup(providerChain(country, true)[0]!, {
          text: [
            plusCode,
            address.city ?? safeLegacyCity(prior?.address.city ?? null),
            address.region,
            country,
          ]
            .filter(Boolean)
            .join(', '),
          country,
        }),
        'google',
        'plus_code',
      ),
    );
  }

  // A venue search is a distinct evidence path from address geocoding. Keep
  // the query independent by combining the name only with coarse locality
  // context retained from the source/previous dataset—not the street address.
  if (
    process.env.GOOGLE_MAPS_API_KEY &&
    resolveGeo(candidates, expect)?.verification !== 'verified'
  ) {
    const locality =
      address.city ??
      safeLegacyCity(prior?.address.city ?? null) ??
      address.region;
    const venueQueries = [
      [name, locality, address.postcode, country].filter(Boolean).join(', '),
      // A second Places query may disambiguate a branch/campus whose name is
      // generic at country/city level. It remains one venue-name evidence path
      // and can never corroborate another Places result by itself.
      [name, address.raw].filter(Boolean).join(', '),
    ].filter((query, index, all) => query && all.indexOf(query) === index);

    for (const venueQuery of venueQueries) {
      candidates.push(
        ...toCandidates(
          await lookup(
            googlePlaces,
            { text: venueQuery, country },
          ),
          'google_places',
          'venue_name',
        ),
      );
      if (resolveGeo(candidates, expect)?.verification === 'verified') break;
    }
  }

  // Mainland-China POIs are commonly indexed under Chinese names only.
  // Reuse the durable Place IDs from the venue search to obtain a transient
  // localized name, then ask AMap for the domestic POI coordinate. The Google
  // name is never cached or published; only AMap's result is retained.
  if (
    country === 'CN' &&
    process.env.AMAP_API_KEY &&
    process.env.GOOGLE_MAPS_API_KEY &&
    resolveGeo(candidates, expect)?.verification !== 'verified'
  ) {
    const placeIds = [
      ...new Set(
        candidates
          .filter(
            (candidate) =>
              candidate.source === 'google_places' &&
              candidate.evidencePath === 'venue_name' &&
              candidate.placeId,
          )
          .map((candidate) => candidate.placeId!),
      ),
    ].slice(0, 3);

    for (const placeId of placeIds) {
      candidates.push(
        ...toCandidates(
          await lookup(amapPlaces, {
            text: [name, address.city, country].filter(Boolean).join(', '),
            country,
            placeId,
          }),
          'amap_places',
          'venue_name',
        ),
      );
      if (resolveGeo(candidates, expect)?.verification === 'verified') break;
    }
  }

  const tryQuery = async (text: string | null): Promise<void> => {
    if (!text) return;
    candidates.push(
      ...toCandidates(
        await lookup(nominatim, { text, country }),
        'nominatim',
        'address',
      ),
    );
  };

  // Coarser rungs, tried only if no provider managed better. The trigger is
  // candidate *quality*, not emptiness: a geocoder that answers a full street
  // address with a country centroid has technically returned something, and
  // stopping there pins a centre in the middle of the country when its postcode
  // would have placed it within a few blocks.
  const needsBetter = () => bestTier(candidates, expect) < precisionTier('postcode');

  // Public Nominatim is a no-key development fallback, not a recurring bulk
  // production provider. A configured Google crawler never reaches it.
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    if (needsBetter() && street) {
      await tryQuery(
        [street, address.city, address.region, address.postcode]
          .filter(Boolean)
          .join(', '),
      );
    }
    if (needsBetter() && address.postcode) {
      await tryQuery([address.postcode, address.city].filter(Boolean).join(', '));
      if (needsBetter()) await tryQuery(address.postcode);
    }
    if (candidates.length === 0) {
      await tryQuery([address.city, address.region].filter(Boolean).join(', ') || null);
    }
  }

  let resolved = resolveGeo(candidates, expect);
  if (localProvider && resolved?.verification !== 'verified') {
    await runProvider(localProvider);
    resolved = resolveGeo(candidates, expect);
  }

  if (!resolved) {
    const legacyCity = safeLegacyCity(prior?.address.city ?? null);
    return {
      geo: null,
      placeId: null,
      city: legacyCity,
      citySource: legacyCity ? 'legacy' : null,
      region: null,
      postcode: null,
    };
  }

  const {
    placeId,
    resolvedCity,
    resolvedRegion,
    resolvedPostcode,
    ...geo
  } = resolved;
  const legacyCity = safeLegacyCity(prior?.address.city ?? null);
  const verifiedCity =
    geo.verification === 'verified' ? resolvedCity ?? null : null;
  return {
    geo,
    placeId: placeId ?? null,
    city: verifiedCity ?? legacyCity,
    citySource:
      verifiedCity ? 'geocoder' : legacyCity ? 'legacy' : null,
    region: resolvedRegion ?? null,
    postcode: resolvedPostcode ?? null,
  };
}

function safeLegacyCity(city: string | null): string | null {
  if (!city) return null;
  const value = city.trim();
  if (
    !value ||
    value.length > 60 ||
    /\d/.test(value) ||
    /^(?:other|unknown|n\/a)$/i.test(value) ||
    /https?:|www\.|@/.test(value)
  ) {
    return null;
  }
  return value;
}

/** Extract the first Open Location Code without rewriting the source address. */
export function extractPlusCode(address: string): string | null {
  const match =
    /\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})\b/iu.exec(
      address,
    );
  return match?.[1]?.toUpperCase() ?? null;
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
    if (geo.verification === 'verified' && tier >= 3) score += 0.2;
    else if (geo.verification === 'verified' || tier === 2) score += 0.1;
  }
  // Two pages describing the same centre corroborate each other.
  if (cluster.length > 1) score += 0.05;

  return Number(Math.min(1, score).toFixed(2));
}
