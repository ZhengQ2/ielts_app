import type {
  Centre,
  CentreAvailabilityStatus,
} from '@ielts-map/core';
import {
  nameKey,
  nameSimilarity,
  normaliseText,
} from '@ielts-map/core';
import { decodeEntities, sliceElement, stripTags } from './html.ts';

export interface OperatorAvailabilityRecord {
  status: CentreAvailabilityStatus;
  label: string;
  url: string | null;
}

export interface AvailabilitySnapshotRecord {
  status: CentreAvailabilityStatus;
  sourceLabel: string;
}

export interface AvailabilitySnapshot {
  version: 1;
  checkedAt: string;
  source: 'ielts_usa_network';
  sourceUrl: string;
  records: Record<string, AvailabilitySnapshotRecord>;
  diagnostics: {
    sourceRecords: {
      registrationAvailable: number;
      notAcceptingRegistrations: number;
      futureLocations: number;
    };
    matchedCentres: number;
    unmatchedSourceRecords: OperatorAvailabilityRecord[];
    unmatchedCentres: { id: string; name: string }[];
  };
}

export interface ParsedIeltsUsaAvailability {
  records: OperatorAvailabilityRecord[];
  foundRegistrationList: boolean;
  foundFutureSection: boolean;
}

type AvailabilityCentre = Pick<
  Centre,
  'id' | 'name' | 'bookingUrl' | 'operator' | 'address'
>;

/**
 * Parse only the public semantic statements on IELTS USA's network page.
 * Booking pages and private endpoints are deliberately outside this adapter.
 */
export function parseIeltsUsaAvailability(
  html: string,
): ParsedIeltsUsaAvailability {
  const blocks = textBlocks(html);
  const registrationBlock = blocks
    .map((block) => ({
      block,
      links: anchors(block).filter((link) =>
        isIeltsUsaRegistrationUrl(link.url),
      ),
    }))
    .sort((a, b) => b.links.length - a.links.length)[0];
  const futureBlock = blocks.find((block) =>
    /no scheduled or planned(?:&nbsp;|\s)*test dates/i.test(block),
  );

  const records: OperatorAvailabilityRecord[] = [];
  for (const link of registrationBlock?.links ?? []) {
    records.push({
      status: 'registration_available',
      label: link.label,
      url: link.url,
    });
  }

  if (registrationBlock?.block) {
    for (const line of visibleLines(registrationBlock.block)) {
      if (!/not accepting registrations/i.test(line)) continue;
      const label = line
        .replace(/\s*\(not accepting registrations\).*$/i, '')
        .trim();
      if (label) {
        records.push({
          status: 'not_accepting_registrations',
          label,
          url: null,
        });
      }
    }
  }

  if (futureBlock) {
    for (const link of anchors(futureBlock)) {
      if (!link.label || /privacy|legal|accessibility/i.test(link.label)) {
        continue;
      }
      records.push({
        status: 'future_location',
        label: link.label,
        url: link.url,
      });
    }
  }

  return {
    records: uniqueRecords(records),
    foundRegistrationList: (registrationBlock?.links.length ?? 0) > 0,
    foundFutureSection: Boolean(futureBlock),
  };
}

export function buildIeltsUsaAvailabilitySnapshot(
  html: string,
  centres: readonly AvailabilityCentre[],
  checkedAt: string,
  sourceUrl: string,
): AvailabilitySnapshot {
  const parsed = parseIeltsUsaAvailability(html);
  if (!parsed.foundRegistrationList) {
    throw new Error('IELTS USA registration list was not found');
  }
  if (!parsed.foundFutureSection) {
    throw new Error('IELTS USA future-location disclosure was not found');
  }

  const eligible = centres.filter(
    (centre) =>
      centre.operator === 'IELTS USA' &&
      centre.address.country === 'US',
  );
  const byId = new Map(eligible.map((centre) => [centre.id, centre]));
  const matched = new Map<string, AvailabilitySnapshotRecord>();
  const matchedSource = new Set<number>();

  // Future-location links are stable per interest form and are stronger than
  // name similarity. They take precedence over every weaker signal.
  parsed.records.forEach((record, index) => {
    if (record.status !== 'future_location' || !record.url) return;
    const candidates = eligible.filter(
      (centre) =>
        centre.bookingUrl &&
        normalizedUrl(centre.bookingUrl) === normalizedUrl(record.url!),
    );
    const centre = uniqueOrBestName(candidates, record.label, 0.55);
    if (!centre) return;
    matched.set(centre.id, {
      status: record.status,
      sourceLabel: record.label,
    });
    matchedSource.add(index);
  });

  // Explicit "not accepting registrations" text is also stronger than a
  // registration-link inference, but it has no stable id on the source page.
  parsed.records.forEach((record, index) => {
    if (record.status !== 'not_accepting_registrations') return;
    const candidates = eligible.filter((centre) => !matched.has(centre.id));
    const centre = uniqueOrBestName(candidates, record.label, 0.55);
    if (!centre) return;
    matched.set(centre.id, {
      status: record.status,
      sourceLabel: record.label,
    });
    matchedSource.add(index);
  });

  // Registration URLs carry an organisation key. Several rows on the source
  // reuse an incorrect key, so groups with collisions are assigned by name
  // rather than blindly marking every centre sharing the URL.
  const sourceGroups = new Map<string, { record: OperatorAvailabilityRecord; index: number }[]>();
  parsed.records.forEach((record, index) => {
    if (record.status !== 'registration_available' || !record.url) return;
    const key = bookingIdentity(record.url);
    if (!key) return;
    const group = sourceGroups.get(key) ?? [];
    group.push({ record, index });
    sourceGroups.set(key, group);
  });

  for (const [key, sourceGroup] of sourceGroups) {
    const centreGroup = eligible.filter(
      (centre) =>
        !matched.has(centre.id) &&
        centre.bookingUrl &&
        bookingIdentity(centre.bookingUrl) === key,
    );
    const pairs = sourceGroup
      .flatMap(({ record, index }) =>
        centreGroup.map((centre) => ({
          record,
          index,
          centre,
          score: labelSimilarity(centre.name, record.label),
        })),
      )
      .sort((a, b) => b.score - a.score);
    const usedCentres = new Set<string>();
    const usedSources = new Set<number>();

    for (const pair of pairs) {
      if (usedCentres.has(pair.centre.id) || usedSources.has(pair.index)) {
        continue;
      }
      const uniquePair = centreGroup.length === 1 && sourceGroup.length === 1;
      if (!uniquePair && pair.score < 0.25) continue;
      matched.set(pair.centre.id, {
        status: 'registration_available',
        sourceLabel: pair.record.label,
      });
      matchedSource.add(pair.index);
      usedCentres.add(pair.centre.id);
      usedSources.add(pair.index);
    }
  }

  const records = Object.fromEntries(
    [...matched.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  const sourceCounts = {
    registrationAvailable: parsed.records.filter(
      (record) => record.status === 'registration_available',
    ).length,
    notAcceptingRegistrations: parsed.records.filter(
      (record) => record.status === 'not_accepting_registrations',
    ).length,
    futureLocations: parsed.records.filter(
      (record) => record.status === 'future_location',
    ).length,
  };

  return {
    version: 1,
    checkedAt,
    source: 'ielts_usa_network',
    sourceUrl,
    records,
    diagnostics: {
      sourceRecords: sourceCounts,
      matchedCentres: matched.size,
      unmatchedSourceRecords: parsed.records.filter(
        (_, index) => !matchedSource.has(index),
      ),
      unmatchedCentres: eligible
        .filter((centre) => !matched.has(centre.id))
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/**
 * Detect a parser/source cliff without suppressing ordinary status changes.
 * A small disappearance safely degrades those centres to unknown.
 */
export function availabilitySafetyProblems(
  previous: AvailabilitySnapshot | null,
  next: AvailabilitySnapshot,
): string[] {
  const problems: string[] = [];
  if (next.diagnostics.sourceRecords.registrationAvailable < 10) {
    problems.push(
      `only ${next.diagnostics.sourceRecords.registrationAvailable} IELTS USA registration links were parsed`,
    );
  }
  if (previous) {
    const before = Object.keys(previous.records).length;
    const after = Object.keys(next.records).length;
    const maximumDrop = Math.max(5, Math.floor(before / 2));
    if (before - after > maximumDrop) {
      problems.push(
        `matched availability fell from ${before} to ${after}, exceeding the safe drop of ${maximumDrop}`,
      );
    }
  }
  return problems;
}

function textBlocks(html: string): string[] {
  const blocks: string[] = [];
  const openings =
    /<div\b[^>]*class=["'][^"']*\btext_block\b[^"']*["'][^>]*>/gi;
  for (const match of html.matchAll(openings)) {
    blocks.push(sliceElement(html, match.index ?? 0, 'div'));
  }
  return blocks;
}

function anchors(html: string): { label: string; url: string }[] {
  const result: { label: string; url: string }[] = [];
  const pattern =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = decodeEntities(match[1] ?? '').trim();
    // Inline elements may split a single word ("Assessm<span>ent</span>").
    // Removing their tags without injecting spaces preserves the source text.
    const label = decodeEntities((match[2] ?? '').replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (url && label) result.push({ label, url });
  }
  return result;
}

function visibleLines(html: string): string[] {
  return decodeEntities(html)
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .split('\n')
    .map((line) => stripTags(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isIeltsUsaRegistrationUrl(value: string): boolean {
  try {
    return /(^|\.)registration-ieltsusa\.org$/i.test(
      new URL(value).hostname,
    );
  } catch {
    return false;
  }
}

function bookingIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    const organization =
      url.searchParams.get('organization') ??
      url.searchParams.get('organisation');
    if (!organization) return null;
    return `${url.hostname.toLocaleLowerCase('en')}|${organization.toLocaleLowerCase('en')}`;
  } catch {
    return null;
  }
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLocaleLowerCase('en');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
}

function uniqueOrBestName(
  centres: AvailabilityCentre[],
  label: string,
  threshold: number,
): AvailabilityCentre | null {
  if (centres.length === 1) return centres[0]!;
  const best = centres
    .map((centre) => ({
      centre,
      score: labelSimilarity(centre.name, label),
    }))
    .sort((a, b) => b.score - a.score)[0];
  return best && best.score >= threshold ? best.centre : null;
}

function labelSimilarity(name: string, label: string): number {
  const direct = nameSimilarity(nameKey(name), nameKey(label));
  const normalizedName = normaliseText(name);
  const normalizedLabel = normaliseText(label);
  if (
    normalizedName.includes(normalizedLabel) ||
    normalizedLabel.includes(normalizedName)
  ) {
    return Math.max(direct, 0.9);
  }
  return direct;
}

function uniqueRecords(
  records: OperatorAvailabilityRecord[],
): OperatorAvailabilityRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = [
      record.status,
      normaliseText(record.label),
      record.url ? normalizedUrl(record.url) : '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
