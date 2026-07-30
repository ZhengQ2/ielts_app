import type { Centre, CentreDataset } from './types.ts';
import raw from '../data/centres.all.json' with { type: 'json' };
import futureOpeningsRaw from '../data/future-openings.json' with { type: 'json' };
import { isDirectoryVisible } from './publication.ts';

interface FutureOpeningRecord {
  sourceLabel: string;
}

interface FutureOpeningSnapshot {
  version: 1;
  source: 'ielts_usa_network';
  sourceUrl: string;
  records: Record<string, FutureOpeningRecord>;
}

/**
 * The committed dataset — every country IELTS.org lists, not just Canada.
 * Bundled rather than fetched so the web build is fully static and a future
 * React Native client can ship an offline copy; both can still refresh from
 * the `/data/centres.json` static feed at runtime.
 *
 * This is a real tradeoff, not an oversight: at a few MB worldwide, a
 * client component that receives the array as a prop bundles all of it into
 * the page's hydration payload. Acceptable for now; the plan's Supabase phase
 * is what turns this into a query instead of a bundle.
 */
const committed = raw as unknown as CentreDataset;
const futureOpenings = futureOpeningsRaw as FutureOpeningSnapshot;

const centresWithFutureOpenings = committed.centres.map((centre) => {
  const opening = futureOpenings.records[centre.id];
  if (!opening) return centre;
  return {
    ...centre,
    futureOpening: {
      ...opening,
      source: futureOpenings.source,
      sourceUrl: futureOpenings.sourceUrl,
    },
  };
});

/**
 * The public directory normally requires a source-published price. Curated
 * future openings are the sole exception because their official interest form
 * is useful before bookings begin.
 */
export const futureOpeningCount = centresWithFutureOpenings.filter(
  (centre) => centre.futureOpening !== undefined,
).length;

export const dataset: CentreDataset = {
  ...committed,
  centres: centresWithFutureOpenings.filter(isDirectoryVisible),
};

export const centres: Centre[] = dataset.centres;

export function getCentreBySlug(slug: string): Centre | undefined {
  return centres.find((c) => c.ieltsOrgSlug === slug || c.mergedSlugs.includes(slug));
}

export function getCentreById(id: string): Centre | undefined {
  return centres.find((c) => c.id === id);
}

export const publishableCentres: Centre[] = centres;
