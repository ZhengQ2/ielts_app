import type { Centre, CentreDataset } from './types.ts';
import raw from '../data/centres.all.json' with { type: 'json' };
import availabilityRaw from '../data/availability.all.json' with { type: 'json' };

interface AvailabilitySnapshotRecord {
  status:
    | 'registration_available'
    | 'not_accepting_registrations'
    | 'future_location';
  sourceLabel: string;
}

interface AvailabilitySnapshot {
  version: 1;
  checkedAt: string;
  source: 'ielts_usa_network';
  sourceUrl: string;
  records: Record<string, AvailabilitySnapshotRecord>;
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
const availability = availabilityRaw as AvailabilitySnapshot;

const centresWithAvailability = committed.centres.map((centre) => {
  const evidence = availability.records[centre.id];
  if (!evidence) return centre;
  return {
    ...centre,
    availability: {
      ...evidence,
      source: availability.source,
      sourceUrl: availability.sourceUrl,
      checkedAt: availability.checkedAt,
    },
  };
});

/**
 * Operator-declared future locations are discovery leads, not current test
 * centres. Keep them in the ingest artifacts for later refreshes, but exclude
 * them at the shared publication boundary so web pages, feeds and mobile
 * clients cannot accidentally expose them.
 */
export const omittedFutureLocationCount = centresWithAvailability.filter(
  (centre) => centre.availability?.status === 'future_location',
).length;

export const dataset: CentreDataset = {
  ...committed,
  centres: centresWithAvailability.filter(
    (centre) => centre.availability?.status !== 'future_location',
  ),
};

export const centres: Centre[] = dataset.centres;

export function getCentreBySlug(slug: string): Centre | undefined {
  return centres.find((c) => c.ieltsOrgSlug === slug || c.mergedSlugs.includes(slug));
}

export function getCentreById(id: string): Centre | undefined {
  return centres.find((c) => c.id === id);
}

export const publishableCentres: Centre[] = centres.filter((c) => c.isPublishable);
