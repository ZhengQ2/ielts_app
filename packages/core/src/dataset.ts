import type { Centre, CentreDataset } from './types.ts';
import raw from '../data/centres.ca.json' with { type: 'json' };

/**
 * The committed dataset. Bundled rather than fetched so the web build is fully
 * static and a future React Native client can ship an offline copy; both can
 * still refresh from the `/api/centres` endpoint at runtime.
 */
export const dataset = raw as unknown as CentreDataset;

export const centres: Centre[] = dataset.centres;

export function getCentreBySlug(slug: string): Centre | undefined {
  return centres.find((c) => c.ieltsOrgSlug === slug || c.mergedSlugs.includes(slug));
}

export function getCentreById(id: string): Centre | undefined {
  return centres.find((c) => c.id === id);
}

export const activeCentres: Centre[] = centres.filter((c) => c.isActive);
