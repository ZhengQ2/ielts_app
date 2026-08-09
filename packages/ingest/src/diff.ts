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
    localizations: c.localizations ?? [],
    city: c.address.city,
    postcode: c.address.postcode,
    contact: c.contact,
    priceText: c.priceFromText,
    parsedPrice: c.parsedPriceFrom,
    parsedCurrency: c.parsedCurrency,
    formats: [...c.formats].sort(),
    offerings: c.offerings
      .map(
        (o) =>
          `${o.label}|${o.format}|${o.priceText ?? ''}|` +
          `${o.parsedCurrency ?? ''}${o.parsedPrice ?? ''}|${o.priceParseStatus}`,
      )
      .sort(),
    bookingUrl: c.bookingUrl,
    offersOneSkillRetake: Boolean(c.offersOneSkillRetake),
    oneSkillRetakeOnly: Boolean(c.oneSkillRetakeOnly),
    location: c.geo ? `${round(c.geo.lat)},${round(c.geo.lng)}|${c.geo.precision}` : null,
    googlePlaceId: c.googlePlaceId,
    isPublishable: c.isPublishable,
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

/**
 * Refuse a source/identity cliff without an explicit operator decision.
 *
 * Ordinary discovery remains fully automatic. These thresholds are aimed at
 * systemic failures: a truncated sitemap, changed parser markup, or a dedup id
 * regression can otherwise look like hundreds of legitimate additions and
 * removals and overwrite the committed dataset.
 */
export function diffSafetyProblems(
  diff: DatasetDiff,
  previousCentreCount: number,
): string[] {
  if (previousCentreCount === 0) return [];
  const problems: string[] = [];
  const removalLimit = Math.max(25, Math.ceil(previousCentreCount * 0.05));
  const additionLimit = Math.max(100, Math.ceil(previousCentreCount * 0.1));

  if (diff.removed.length > removalLimit) {
    problems.push(
      `${diff.removed.length} removals exceed the automatic limit of ${removalLimit}`,
    );
  }
  if (diff.added.length > additionLimit) {
    problems.push(
      `${diff.added.length} additions exceed the automatic limit of ${additionLimit}`,
    );
  }
  return problems;
}

/**
 * Refuse a systemic OSR availability drop whether marked centres remain or disappear.
 * A parser regression can otherwise look like ordinary field updates or centre
 * removals and silently clear OSR coverage in the scheduled crawl.
 */
export function osrSafetyProblems(
  previous: CentreDataset | null,
  next: CentreDataset,
): string[] {
  if (!previous) return [];
  const nextById = new Map(next.centres.map((centre) => [centre.id, centre]));
  const before = previous.centres.filter((centre) => centre.offersOneSkillRetake).length;
  const after = next.centres.filter((centre) => centre.offersOneSkillRetake).length;
  const removals = previous.centres.filter(
    (centre) =>
      centre.offersOneSkillRetake &&
      !nextById.get(centre.id)?.offersOneSkillRetake,
  ).length;
  if (removals === 0) return [];

  if (before >= 5 && removals === before) {
    return [`OSR availability was removed from all ${before} previously marked centres`];
  }
  const limit = Math.max(20, Math.ceil(before * 0.05));
  return removals > limit
    ? [
        `${removals} OSR badge removals exceed the automatic limit of ${limit} ` +
          `(${before} previously marked; ${after} marked after crawl)`,
      ]
    : [];
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
