import type {
  CoordinateSystem,
  Geo,
  GeoEvidencePath,
  GeoPrecision,
} from './types.ts';

/** Precision tier used by the candidate-scoring rule (DEV_PLAN §5.3). */
const PRECISION_TIER: Record<GeoPrecision, number> = {
  rooftop: 4,
  street: 3,
  postcode: 2,
  city: 1,
  country: 0,
  approximate: 0,
};

export function precisionTier(p: GeoPrecision): number {
  return PRECISION_TIER[p];
}

/** Precision good enough to draw a confident pin rather than an area. */
export function isPinnable(geo: Geo | null): boolean {
  if (!geo) return false;
  return (
    geo.verification === 'verified' &&
    precisionTier(geo.precision) >= 3 &&
    geo.confidence >= 0.5
  );
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface GeoCandidate {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  source: Geo['source'];
  evidencePath: GeoEvidencePath;
  coordinateSystem: CoordinateSystem;
  /** Google Place ID, when the candidate came from Google. */
  placeId?: string | null;
  /** What the geocoder echoed back, used to corroborate the parsed record. */
  echoedPostcode?: string | null;
  echoedCity?: string | null;
  echoedRegion?: string | null;
  echoedCountry?: string | null;
}

export interface GeoExpectation {
  postcode?: string | null;
  city?: string | null;
  country?: string | null;
}

const norm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Score one geocode candidate: precision tier, +1 if it echoes the expected
 * postcode, +1 if the city matches. A hit in the wrong country is rejected
 * outright — a precise pin in the wrong country loses to a postcode pin in the
 * right one (§5.3).
 */
export function scoreCandidate(
  c: GeoCandidate,
  expect: GeoExpectation,
): number | null {
  if (
    expect.country &&
    c.echoedCountry &&
    norm(c.echoedCountry) !== norm(expect.country)
  ) {
    return null;
  }

  const cityAgrees =
    Boolean(expect.city) && Boolean(c.echoedCity) && norm(c.echoedCity) === norm(expect.city);

  // A hit echoing a *different* region's postcode is a different place, however
  // precise it claims to be. Searching "A1B 3X2, St Johns" returned a rooftop
  // hit in Prescott, Ontario echoing K0E 1T0; it beat the correct St John's
  // postcode hit on precision alone and pinned the centre 1,500 km away.
  //
  // Compared on the leading three characters — the Canadian forward sortation
  // area, the regional key — and only decisive when the city *also* disagrees.
  // Source pages carry wrong postcodes often enough that a rooftop match on the
  // right street in the right city should win: 3030 Lincoln Ave, Coquitlam is
  // really V3B, though its listing claims V3N.
  if (expect.postcode && c.echoedPostcode && !cityAgrees) {
    const want = norm(expect.postcode).slice(0, 3);
    const got = norm(c.echoedPostcode).slice(0, 3);
    if (want && got && want !== got) return null;
  }
  let score = precisionTier(c.precision);
  if (expect.postcode && c.echoedPostcode && norm(c.echoedPostcode) === norm(expect.postcode)) {
    score += 1;
  }
  if (expect.city && c.echoedCity && norm(c.echoedCity) === norm(expect.city)) {
    score += 1;
  }
  return score;
}

/** Candidates within this distance are treated as agreeing. */
const AGREE_KM = 0.25;
/**
 * Large campuses and complexes can publish a building entrance while a venue
 * POI uses the main gate. Permit a wider gap only when both independent paths
 * resolve at street level or better and echo the same postcode (also matching
 * the source postcode when it has one).
 */
const SAME_POSTCODE_AGREE_KM = 0.75;
/** Beyond this, the two lookups contradict each other — cap both. */
const DIVERGE_KM = 2;

function agreementLimitKm(
  left: GeoCandidate,
  right: GeoCandidate,
  expect: GeoExpectation,
): number {
  const leftPostcode = norm(left.echoedPostcode);
  const rightPostcode = norm(right.echoedPostcode);
  const expectedPostcode = norm(expect.postcode);
  const postcodeCorroborates =
    leftPostcode &&
    leftPostcode === rightPostcode &&
    (!expectedPostcode || leftPostcode === expectedPostcode);
  if (
    postcodeCorroborates &&
    precisionTier(left.precision) >= precisionTier('street') &&
    precisionTier(right.precision) >= precisionTier('street')
  ) {
    return SAME_POSTCODE_AGREE_KM;
  }
  return AGREE_KM;
}

/**
 * Pick between the address-derived and name-derived geocodes and assign a
 * confidence. Triangulation is the point: agreement raises confidence,
 * divergence is itself the signal that both are unreliable (§5.3).
 */
export function resolveGeo(
  candidates: GeoCandidate[],
  expect: GeoExpectation,
): Geo | null {
  const scored = candidates
    .map((c) => ({ c, score: scoreCandidate(c, expect) }))
    .filter((x): x is { c: GeoCandidate; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  // Alternate results from one query/provider are not corroboration. Search
  // for the strongest pair produced through two genuinely different evidence
  // paths (for example page embed + address, or address + venue name).
  const pairs = scored
    .flatMap((left, index) =>
      scored.slice(index + 1).flatMap((right) => {
        if (left.c.evidencePath === right.c.evidencePath) return [];
        const gap = haversineKm(left.c, right.c);
        return [{ left, right, gap, strength: left.score + right.score }];
      }),
    )
    .sort((a, b) => b.strength - a.strength || a.gap - b.gap);

  const agreeing = pairs.find(
    (pair) =>
      pair.gap <= agreementLimitKm(pair.left.c, pair.right.c, expect),
  );
  const selected = agreeing
    ? [agreeing.left, agreeing.right].sort((a, b) => b.score - a.score)[0]!
    : best;
  const nearestDifferentPath = pairs
    .filter((pair) => pair.left === best || pair.right === best)
    .sort((a, b) => a.gap - b.gap)[0];

  let verification: Geo['verification'];
  let confidence: number;
  let precision = selected.c.precision;
  let agreementKm: number | null = null;
  let evidencePaths: GeoEvidencePath[] = [selected.c.evidencePath];

  if (selected.c.evidencePath === 'admin') {
    verification = 'verified';
    confidence = 0.98;
  } else if (agreeing) {
    verification = 'verified';
    agreementKm = Number(agreeing.gap.toFixed(3));
    evidencePaths = [agreeing.left.c.evidencePath, agreeing.right.c.evidencePath].sort();
    confidence = Math.min(1, 0.55 + selected.score * 0.08);
  } else if (nearestDifferentPath && nearestDifferentPath.gap > DIVERGE_KM) {
    verification = 'conflicted';
    precision = 'approximate';
    evidencePaths = [
      nearestDifferentPath.left.c.evidencePath,
      nearestDifferentPath.right.c.evidencePath,
    ].sort();
    agreementKm = Number(nearestDifferentPath.gap.toFixed(3));
    confidence = 0.2;
  } else if (nearestDifferentPath) {
    verification = 'approximate';
    precision = 'approximate';
    evidencePaths = [
      nearestDifferentPath.left.c.evidencePath,
      nearestDifferentPath.right.c.evidencePath,
    ].sort();
    agreementKm = Number(nearestDifferentPath.gap.toFixed(3));
    confidence = 0.35;
  } else {
    verification = 'unverified';
    confidence = Math.min(0.45, 0.2 + selected.score * 0.05);
  }

  const selectedPairCandidates = agreeing
    ? [agreeing.left.c, agreeing.right.c]
    : [selected.c];
  const placeId =
    selectedPairCandidates.find((candidate) => candidate.placeId)?.placeId ??
    selected.c.placeId ??
    null;

  return {
    lat: selected.c.lat,
    lng: selected.c.lng,
    precision,
    source: selected.c.source,
    coordinateSystem: 'WGS84',
    verification,
    evidencePaths: [...new Set(evidencePaths)],
    agreementKm,
    confidence: Number(confidence.toFixed(2)),
    placeId,
    resolvedCity: selected.c.echoedCity ?? null,
    resolvedRegion: selected.c.echoedRegion ?? null,
    resolvedPostcode: selected.c.echoedPostcode ?? null,
  };
}
