import { isPinnable, precisionTier } from './geo.ts';
import type { Geo, GeoPrecision } from './types.ts';

export type ApprovableGeoPrecision = Extract<GeoPrecision, 'street' | 'rooftop'>;

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
