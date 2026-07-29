import {
  boundsFor,
  haversineKm,
  isPinnable,
  isPlausibleForCountry,
  nameKey,
  normalisePostcode,
  normaliseText,
  tokenSimilarity,
  type Centre,
} from '@ielts-map/core';

export interface ApplePilotCentre {
  id: string;
  name: string;
  address: string;
  city: string | null;
  postcode: string | null;
  country: string;
  referenceCoordinate: { lat: number; lng: number };
  referenceSource: string;
  searchRegion: {
    centerLatitude: number;
    centerLongitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null;
  queries: Array<{ kind: string; text: string }>;
}

export interface AppleSearchCandidate {
  rank: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  url: string | null;
}

export interface AppleSearchAttempt {
  kind: string;
  query: string;
  candidates: AppleSearchCandidate[];
  error: string | null;
}

export interface AppleCentreSearchResult {
  centreId: string;
  searches: AppleSearchAttempt[];
}

export interface AppleCandidateAssessment {
  queryKind: string;
  query: string;
  candidate: AppleSearchCandidate;
  score: number;
  nameScore: number;
  addressScore: number;
  postcodeMatches: boolean;
  cityMatches: boolean;
  streetNumberMatches: boolean;
  countryPlausible: boolean;
  distanceKm: number;
}

export type AppleAgreement = 'exact' | 'campus' | 'disagrees' | 'no_result';

export interface AppleCentreAssessment {
  centre: ApplePilotCentre;
  agreement: AppleAgreement;
  best: AppleCandidateAssessment | null;
  transportErrors: string[];
  outsideCountryCandidates: number;
}

/**
 * Deterministic coverage across the largest centre markets. Only internally
 * verified street/rooftop points participate: their restricted coordinate is
 * diagnostic control data and never enters an Apple search query.
 */
export function selectApplePilotSample(
  centres: Centre[],
  limit = 50,
): ApplePilotCentre[] {
  const byCountry = new Map<string, Centre[]>();
  for (const centre of centres) {
    if (!centre.address.country || !isPinnable(centre.geo)) continue;
    const rows = byCountry.get(centre.address.country) ?? [];
    rows.push(centre);
    byCountry.set(centre.address.country, rows);
  }

  const strata = [...byCountry.entries()]
    .map(([country, rows]) => ({
      country,
      rows: rows.sort(
        (left, right) =>
          stableHash(left.id) - stableHash(right.id) ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        right.rows.length - left.rows.length ||
        left.country.localeCompare(right.country),
    )
    .slice(0, Math.min(limit, 25));

  const selected: Centre[] = [];
  for (let round = 0; selected.length < limit; round++) {
    let added = false;
    for (const stratum of strata) {
      const centre = stratum.rows[round];
      if (!centre) continue;
      selected.push(centre);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }

  return selected.map(toPilotCentre);
}

export function assessAppleSearch(
  centre: ApplePilotCentre,
  result: AppleCentreSearchResult | undefined,
): AppleCentreAssessment {
  const transportErrors =
    result?.searches.flatMap((search) => search.error ? [search.error] : []) ?? [];
  const candidates =
    result?.searches.flatMap((search) =>
      search.candidates.map((candidate) =>
        assessCandidate(centre, search, candidate),
      ),
    ) ?? [];
  const outsideCountryCandidates = candidates.filter(
    (candidate) => !candidate.countryPlausible,
  ).length;
  const best =
    candidates
      .filter((candidate) => candidate.countryPlausible)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.candidate.rank - right.candidate.rank ||
          left.distanceKm - right.distanceKm,
      )[0] ?? null;

  if (!best) {
    return {
      centre,
      agreement: 'no_result',
      best: null,
      transportErrors,
      outsideCountryCandidates,
    };
  }

  // 250 m is the normal evidence-agreement threshold. Up to 750 m is retained
  // as campus-level review, never claimed as an exact venue.
  const agreement: AppleAgreement =
    best.distanceKm <= 0.25
      ? 'exact'
      : best.distanceKm <= 0.75
        ? 'campus'
        : 'disagrees';
  return {
    centre,
    agreement,
    best,
    transportErrors,
    outsideCountryCandidates,
  };
}

function toPilotCentre(centre: Centre): ApplePilotCentre {
  const queries: ApplePilotCentre['queries'] = [
    {
      kind: 'canonical_name_address',
      text: `${centre.name}, ${centre.address.raw}`,
    },
    {
      kind: 'canonical_address',
      text: centre.address.raw,
    },
  ];
  const localization = centre.localizations?.find(
    (entry) => entry.name && entry.address,
  );
  if (localization?.name && localization.address) {
    queries.push({
      kind: `localized_${localization.locale}`,
      text: `${localization.name}, ${localization.address}`,
    });
  }
  const bounds = boundsFor(centre.address.country);
  return {
    id: centre.id,
    name: centre.name,
    address: centre.address.raw,
    city: centre.address.city,
    postcode: centre.address.postcode,
    country: centre.address.country!,
    referenceCoordinate: { lat: centre.geo!.lat, lng: centre.geo!.lng },
    referenceSource: centre.geo!.source,
    searchRegion: bounds
      ? {
          centerLatitude: (bounds.minLat + bounds.maxLat) / 2,
          centerLongitude: (bounds.minLng + bounds.maxLng) / 2,
          latitudeDelta: Math.min(180, bounds.maxLat - bounds.minLat),
          longitudeDelta: Math.min(360, bounds.maxLng - bounds.minLng),
        }
      : null,
    queries,
  };
}

function assessCandidate(
  centre: ApplePilotCentre,
  search: AppleSearchAttempt,
  candidate: AppleSearchCandidate,
): AppleCandidateAssessment {
  const candidateText = `${candidate.name} ${candidate.address}`;
  const sourceName = nameKey(centre.name);
  const candidateName = nameKey(candidate.name);
  const nameScore = tokenSimilarity(sourceName, candidateName);
  const addressScore = tokenSimilarity(
    normaliseText(centre.address),
    normaliseText(candidate.address),
  );
  const postcode = normalisePostcode(centre.postcode);
  const postcodeMatches =
    Boolean(postcode) &&
    normalisePostcode(candidate.address).includes(postcode);
  const city = normaliseText(centre.city ?? '');
  const cityMatches =
    Boolean(city) && normaliseText(candidateText).includes(city);
  const streetNumberMatches = streetNumbers(centre.address).some((number) =>
    streetNumbers(candidate.address).includes(number),
  );
  const score =
    nameScore * 0.35 +
    addressScore * 0.35 +
    (postcodeMatches ? 0.1 : 0) +
    (cityMatches ? 0.1 : 0) +
    // A shared city token in a venue name is weak; matching the published
    // street number is materially stronger identity evidence.
    (streetNumberMatches ? 0.1 : 0);
  return {
    queryKind: search.kind,
    query: search.query,
    candidate,
    score: Number(score.toFixed(4)),
    nameScore: Number(nameScore.toFixed(4)),
    addressScore: Number(addressScore.toFixed(4)),
    postcodeMatches,
    cityMatches,
    streetNumberMatches,
    countryPlausible: isPlausibleForCountry(
      candidate.latitude,
      candidate.longitude,
      centre.country,
    ),
    distanceKm: Number(
      haversineKm(centre.referenceCoordinate, {
        lat: candidate.latitude,
        lng: candidate.longitude,
      }).toFixed(3),
    ),
  };
}

function streetNumbers(value: string): string[] {
  return [
    ...new Set(
      normaliseText(value)
        .split(' ')
        .filter((token) => /^\p{Number}{1,6}$/u.test(token)),
    ),
  ];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): { low: number; high: number } | null {
  if (total <= 0) return null;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center =
    (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z *
      Math.sqrt(
        (proportion * (1 - proportion)) / total +
          (z * z) / (4 * total * total),
      )) /
    denominator;
  return {
    low: Number(Math.max(0, center - margin).toFixed(4)),
    high: Number(Math.min(1, center + margin).toFixed(4)),
  };
}
