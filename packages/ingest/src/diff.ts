import type { Centre, CentreDataset } from '@ielts-map/core';

/**
 * Compare a freshly built dataset against the committed one.
 *
 * The point is to tell a *meaningful* change from bookkeeping. Every record
 * carries `firstSeenAt`, `lastSeenAt` and per-source `seenAt`, all of which move
 * on every run; comparing raw records would report a change every night and
 * commit noise forever. Those fields are excluded here.
 */

export interface CentreRef {
  id: string;
  name: string;
  city: string | null;
}

export interface CentreChange extends CentreRef {
  fields: string[];
}

export interface DatasetDiff {
  added: CentreRef[];
  removed: CentreRef[];
  changed: CentreChange[];
  unchanged: number;
  /** True when anything a reader would care about moved. */
  meaningful: boolean;
}

const ref = (c: Centre): CentreRef => ({ id: c.id, name: c.name, city: c.address.city });

/** Coordinates are compared at ~1 m, below which movement is noise. */
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * The fields whose movement matters, keyed for per-field reporting so a commit
 * message can say *what* changed rather than just that something did.
 */
function facets(c: Centre): Record<string, unknown> {
  return {
    name: c.name,
    operator: c.operator,
    address: c.address.raw,
    city: c.address.city,
    postcode: c.address.postcode,
    phone: c.phone,
    price: c.priceFrom,
    currency: c.currency,
    formats: [...c.formats].sort(),
    offerings: c.offerings
      .map((o) => `${o.label}|${o.format}|${o.currency ?? ''}${o.price ?? ''}`)
      .sort(),
    bookingUrl: c.bookingUrl,
    location: c.geo ? `${round(c.geo.lat)},${round(c.geo.lng)}|${c.geo.precision}` : null,
    googlePlaceId: c.googlePlaceId,
    isActive: c.isActive,
    // Which source pages back this centre — but not when they were seen.
    sources: c.sources.map((s) => s.externalSlug).sort(),
  };
}

export function diffDatasets(previous: CentreDataset | null, next: CentreDataset): DatasetDiff {
  const before = new Map((previous?.centres ?? []).map((c) => [c.id, c]));
  const after = new Map(next.centres.map((c) => [c.id, c]));

  const added: CentreRef[] = [];
  const removed: CentreRef[] = [];
  const changed: CentreChange[] = [];
  let unchanged = 0;

  for (const [id, centre] of after) {
    const prev = before.get(id);
    if (!prev) {
      added.push(ref(centre));
      continue;
    }
    const a = facets(prev);
    const b = facets(centre);
    const fields = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (fields.length) changed.push({ ...ref(centre), fields });
    else unchanged++;
  }

  for (const [id, centre] of before) {
    if (!after.has(id)) removed.push(ref(centre));
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    meaningful: added.length > 0 || removed.length > 0 || changed.length > 0,
  };
}

/** One-line commit subject describing the run. */
export function summariseDiff(diff: DatasetDiff): string {
  if (!diff.meaningful) return 'No centre changes';
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (diff.changed.length) parts.push(`${diff.changed.length} updated`);
  return parts.join(', ');
}

/** Markdown detail for a CI job summary or a commit body. */
export function renderDiff(diff: DatasetDiff): string {
  if (!diff.meaningful) return '_No centre changes._';

  const lines: string[] = [];
  const section = (title: string, rows: CentreRef[], detail?: (r: CentreRef) => string) => {
    if (!rows.length) return;
    lines.push(`### ${title} (${rows.length})`, '');
    for (const r of rows.slice(0, 50)) {
      const where = r.city ? ` — ${r.city}` : '';
      lines.push(`- ${r.name}${where}${detail ? ` ${detail(r)}` : ''}`);
    }
    if (rows.length > 50) lines.push(`- …and ${rows.length - 50} more`);
    lines.push('');
  };

  section('Added', diff.added);
  section('Removed', diff.removed);
  section('Updated', diff.changed, (r) => `\`${(r as CentreChange).fields.join(', ')}\``);
  lines.push(`_${diff.unchanged} centres unchanged._`);
  return lines.join('\n');
}
