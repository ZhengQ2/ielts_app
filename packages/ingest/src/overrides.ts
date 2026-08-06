import fs from 'node:fs/promises';
import type { Centre } from '@ielts-map/core';

export type CentreOverridePatch = Partial<
  Pick<
    Centre,
    | 'name'
    | 'address'
    | 'localizations'
    | 'contact'
    | 'phone'
    | 'geo'
    | 'googlePlaceId'
    | 'bookingUrl'
    | 'offersOneSkillRetake'
    | 'oneSkillRetakeOnly'
    | 'isPublishable'
  >
>;

export interface CentreOverride {
  id: string;
  reviewedAt: string;
  reason: string;
  evidence: string[];
  patch: CentreOverridePatch;
}

interface CentreOverrideFile {
  version: 1;
  overrides: CentreOverride[];
}

export interface OverrideResult {
  applied: string[];
  missing: string[];
}

/**
 * Apply only reviewed, committed corrections. The source crawl still runs
 * normally first; this last layer prevents a known-wrong upstream value from
 * returning on the next refresh without making another paid provider request.
 */
export function applyCentreOverrides(
  centres: Centre[],
  overrides: CentreOverride[],
): OverrideResult {
  const byId = new Map(centres.map((centre) => [centre.id, centre]));
  const seen = new Set<string>();
  const result: OverrideResult = { applied: [], missing: [] };

  for (const override of overrides) {
    if (seen.has(override.id)) {
      throw new Error(`Duplicate centre override for "${override.id}"`);
    }
    seen.add(override.id);

    const centre = byId.get(override.id);
    if (!centre) {
      result.missing.push(override.id);
      continue;
    }

    Object.assign(centre, override.patch);
    result.applied.push(override.id);
  }

  return result;
}

export async function loadCentreOverrides(file: string): Promise<CentreOverride[]> {
  const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.overrides)) {
    throw new Error(`Invalid centre override file: ${file}`);
  }

  for (const entry of raw.overrides) {
    if (
      !isObject(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.reviewedAt !== 'string' ||
      typeof entry.reason !== 'string' ||
      !Array.isArray(entry.evidence) ||
      !entry.evidence.every((value) => typeof value === 'string') ||
      !isObject(entry.patch)
    ) {
      throw new Error(`Invalid centre override entry in ${file}`);
    }
  }

  return raw.overrides as CentreOverride[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
