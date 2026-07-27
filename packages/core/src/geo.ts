import type { Geo, GeoPrecision } from './types.ts';

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
  return precisionTier(geo.precision) >= 3 && geo.confidence >= 0.5;
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
  /** Google Place ID, when the candidate came from Google. */
  placeId?: string | null;
  /** What the geocoder echoed back, used to corroborate the parsed record. */
  echoedPostcode?: string | null;
  echoedCity?: string | null;
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
/** Beyond this, the two lookups contradict each other — cap both. */
const DIVERGE_KM = 2;

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

  // Base confidence from precision, then adjusted by corroboration.
  let confidence = Math.min(1, 0.25 + best.score * 0.15);
  let precision = best.c.precision;

  const second = scored[1];
  if (second) {
    const gap = haversineKm(best.c, second.c);
    if (gap <= AGREE_KM) {
      confidence = Math.min(1, confidence + 0.2);
    } else if (gap > DIVERGE_KM) {
      // The two lookups disagree materially — don't pretend to a precise pin.
      precision = 'approximate';
      confidence = Math.min(confidence, 0.3);
    }
  }

  return {
    lat: best.c.lat,
    lng: best.c.lng,
    precision,
    source: best.c.source,
    confidence: Number(confidence.toFixed(2)),
    placeId: best.c.placeId ?? null,
  };
}
