import { isPinnable, precisionTier } from './geo.ts';
import type { Geo, GeoPrecision } from './types.ts';

export type ApprovableGeoPrecision = Extract<GeoPrecision, 'street' | 'rooftop'>;

const GEO_PRECISIONS = new Set([
  'rooftop',
  'street',
  'postcode',
  'city',
  'country',
  'approximate',
]);
const GEO_SOURCES = new Set([
  'page_embed',
  'google',
  'google_places',
  'overture',
  'amap_places',
  'mapbox',
  'nominatim',
  'amap',
  'mappls',
  'kakao',
  'naver',
  'crowd',
  'admin',
]);
const GEO_VERIFICATIONS = new Set(['verified', 'approximate', 'unverified', 'conflicted']);
const GEO_EVIDENCE_PATHS = new Set([
  'page_embed',
  'address',
  'venue_name',
  'plus_code',
  'operator_map',
  'admin',
]);

/** Runtime boundary for untrusted JSON being edited in the admin textarea. */
export function isLocationReviewGeo(value: unknown): value is Geo {
  if (!isRecord(value)) return false;
  if (!finiteInRange(value.lat, -90, 90) || !finiteInRange(value.lng, -180, 180)) {
    return false;
  }
  if (!isAllowedString(value.precision, GEO_PRECISIONS)) return false;
  if (!isAllowedString(value.source, GEO_SOURCES)) return false;
  if (value.coordinateSystem !== 'WGS84') return false;
  if (!isAllowedString(value.verification, GEO_VERIFICATIONS)) return false;
  if (
    !Array.isArray(value.evidencePaths) ||
    !value.evidencePaths.every(
      (item: unknown) => typeof item === 'string' && GEO_EVIDENCE_PATHS.has(item),
    )
  ) {
    return false;
  }
  if (
    value.agreementKm !== null &&
    (!finiteInRange(value.agreementKm, 0, Number.MAX_VALUE))
  ) {
    return false;
  }
  return finiteInRange(value.confidence, 0, 1);
}

/** Stable identity for the exact point an administrator inspected. */
export function locationConfirmationToken(geo: Geo | null): string | null {
  if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return null;
  return JSON.stringify([geo.lat, geo.lng]);
}

/** Reasons an existing coordinate cannot be presented as a confident point. */
export function locationReviewIssues(geo: Geo | null): string[] {
  if (!geo || isPinnable(geo)) return [];

  const issues: string[] = [];
  if (geo.verification !== 'verified') {
    issues.push(`verification is ${geo.verification}`);
  }
  if (precisionTier(geo.precision) < precisionTier('street')) {
    issues.push(`precision is ${geo.precision}`);
  }
  if (geo.confidence < 0.5) {
    issues.push(`confidence is ${geo.confidence.toFixed(2)}`);
  }
  return issues;
}

/** Only mapped centres have a candidate point an administrator can approve. */
export function needsLocationReview(geo: Geo | null): boolean {
  return geo !== null && !isPinnable(geo);
}

/**
 * Prepare an explicit administrator approval without rewriting the coordinate's
 * provider provenance. The caller must still persist the resulting record.
 */
export function draftLocationApproval(
  geo: Geo,
  precision: ApprovableGeoPrecision,
): Geo {
  return {
    ...geo,
    precision,
    verification: 'verified',
    evidencePaths: [...new Set([...geo.evidencePaths, 'admin' as const])],
    confidence: Math.max(geo.confidence, 0.9),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAllowedString(value: unknown, allowed: Set<string>): value is string {
  return typeof value === 'string' && allowed.has(value);
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}
