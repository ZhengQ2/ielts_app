import type {
  Centre,
  OfferingDeliveryMode,
  TestCategory,
  TestModule,
} from '@ielts-map/core';
import {
  nameKey,
  nameSimilarity,
  offeringCategory,
  offeringDeliveryMode,
  offeringModule,
} from '@ielts-map/core';
import type {
  ProviderCentreMatchStatus,
  ProviderOfferingIdentity,
  ProviderSessionRecord,
  ProviderSessionSnapshot,
} from './provider-availability.ts';

const IDP_INDIA_HOST = 'ieltsidpindia.com';

/**
 * Normalised output expected from the isolated browser collector.
 *
 * Keeping browser mechanics outside the parser makes fixtures deterministic
 * and prevents DOM changes from silently becoming trusted availability data.
 */
export interface IdpIndiaBrowserCapture {
  sourceUrl: string;
  testId: string;
  testLabel: string;
  moduleId: string | null;
  moduleLabel: string | null;
  cityId: string;
  cityLabel: string;
  sessions: {
    /** YYYY-MM-DD, already normalised by the browser collector. */
    testDate: string;
    timeText: string | null;
    /** True only when the visible source explicitly says "Available". */
    explicitlyAvailable: boolean;
  }[];
}

interface CentreMatch {
  status: ProviderCentreMatchStatus;
  centreId: string | null;
  candidateCentreIds: string[];
}

type IdpIndiaCentre = Pick<
  Centre,
  'id' | 'name' | 'operator' | 'bookingUrl' | 'offerings'
>;

const TEST_TYPES: Record<
  string,
  {
    category: TestCategory;
    deliveryMode: OfferingDeliveryMode | null;
    fixedModule?: TestModule;
  }
> = {
  // IELTS on Paper
  '1': { category: 'standard', deliveryMode: 'paper_based' },
  // Life Skills
  '3': {
    category: 'ukvi_selt',
    deliveryMode: null,
    fixedModule: 'life_skills',
  },
  // IELTS on Computer
  '4': { category: 'standard', deliveryMode: 'computer_delivered' },
  // Computer-delivered IELTS for UKVI
  '5': { category: 'ukvi_selt', deliveryMode: 'computer_delivered' },
  // Listening/Reading on computer, Writing on paper
  '16': { category: 'standard', deliveryMode: 'writing_on_paper' },
};

export function buildIdpIndiaAvailabilitySnapshot(
  captures: readonly IdpIndiaBrowserCapture[],
  centres: readonly IdpIndiaCentre[],
  checkedAt: string,
): ProviderSessionSnapshot {
  const records: ProviderSessionRecord[] = [];
  const rejectedCaptures: { sourceUrl: string; reason: string }[] = [];

  for (const capture of captures) {
    const problem = validateCapture(capture);
    if (problem) {
      rejectedCaptures.push({
        sourceUrl: capture.sourceUrl,
        reason: problem,
      });
      continue;
    }

    const offering = offeringIdentity(capture);
    if (!offering) {
      rejectedCaptures.push({
        sourceUrl: capture.sourceUrl,
        reason: `unsupported test/module combination ${capture.testId}/${capture.moduleLabel ?? 'none'}`,
      });
      continue;
    }

    const match = matchIdpIndiaCentre(capture.cityLabel, offering, centres);
    for (const session of capture.sessions) {
      records.push({
        source: 'idp_india',
        providerLocationId: capture.cityId,
        providerLocationLabel: capture.cityLabel.trim(),
        centreId: match.centreId,
        centreMatchStatus: match.status,
        candidateCentreIds: match.candidateCentreIds,
        offering,
        testDate: session.testDate,
        timeText: session.timeText?.trim() || null,
        status: session.explicitlyAvailable
          ? 'available'
          : 'session_published',
        sourceUrl: capture.sourceUrl,
        checkedAt,
      });
    }
  }

  records.sort(compareRecords);
  return {
    version: 1,
    source: 'idp_india',
    checkedAt,
    records,
    diagnostics: {
      captures: captures.length,
      publishedSessions: records.length,
      explicitlyAvailable: records.filter(
        (record) => record.status === 'available',
      ).length,
      matchedSessions: records.filter(
        (record) => record.centreMatchStatus === 'matched',
      ).length,
      ambiguousSessions: records.filter(
        (record) => record.centreMatchStatus === 'ambiguous',
      ).length,
      unmatchedSessions: records.filter(
        (record) => record.centreMatchStatus === 'unmatched',
      ).length,
      rejectedCaptures,
    },
  };
}

export function idpIndiaAvailabilitySafetyProblems(
  previous: ProviderSessionSnapshot | null,
  next: ProviderSessionSnapshot,
): string[] {
  const problems: string[] = [];
  if (next.source !== 'idp_india') {
    problems.push(`unexpected provider source ${next.source}`);
  }
  if (next.diagnostics.captures < 1) {
    problems.push('no IDP India browser captures were produced');
  }
  if (next.records.length < 1) {
    problems.push('no IDP India sessions were parsed');
  }
  if (next.diagnostics.rejectedCaptures.length > 0) {
    problems.push(
      `${next.diagnostics.rejectedCaptures.length} IDP India capture(s) were rejected`,
    );
  }

  if (previous?.source === 'idp_india') {
    const before = previous.records.length;
    const after = next.records.length;
    const maximumDrop = Math.max(5, Math.floor(before / 2));
    if (before - after > maximumDrop) {
      problems.push(
        `IDP India sessions fell from ${before} to ${after}, exceeding the safe drop of ${maximumDrop}`,
      );
    }
  }
  return problems;
}

export function matchIdpIndiaCentre(
  cityLabel: string,
  offering: ProviderOfferingIdentity,
  centres: readonly IdpIndiaCentre[],
): CentreMatch {
  const sourceKey = providerLocationKey(cityLabel);
  if (!sourceKey) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }

  const scored = centres
    .filter(isIdpIndiaCentre)
    .filter((centre) =>
      centre.offerings.some(
        (candidate) =>
          offeringModule(candidate) === offering.module &&
          offeringCategory(candidate) === offering.category &&
          offeringDeliveryMode(candidate) === offering.deliveryMode,
      ),
    )
    .map((centre) => ({
      centre,
      score: locationSimilarity(sourceKey, providerLocationKey(centre.name)),
    }))
    .filter(({ score }) => score >= 0.45)
    .sort(
      (a, b) =>
        b.score - a.score || a.centre.id.localeCompare(b.centre.id),
    );

  if (!scored.length) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }

  const best = scored[0]!;
  const second = scored[1];
  const exact = best.score === 1;
  const safeMargin = !second || best.score - second.score >= 0.2;
  const candidateCentreIds = scored.map(({ centre }) => centre.id);
  if ((exact || best.score >= 0.72) && safeMargin) {
    return {
      status: 'matched',
      centreId: best.centre.id,
      candidateCentreIds,
    };
  }

  return {
    status: 'ambiguous',
    centreId: null,
    candidateCentreIds,
  };
}

function offeringIdentity(
  capture: IdpIndiaBrowserCapture,
): ProviderOfferingIdentity | null {
  const test = TEST_TYPES[capture.testId];
  if (!test) return null;
  const module =
    test.fixedModule ?? moduleFromLabel(capture.moduleLabel ?? '');
  if (!module) return null;
  return {
    module,
    category: test.category,
    deliveryMode: test.deliveryMode,
    sourceTestId: capture.testId,
    sourceModuleId: capture.moduleId,
    sourceLabel: [capture.testLabel, capture.moduleLabel]
      .filter(Boolean)
      .join(' — '),
  };
}

function moduleFromLabel(label: string): TestModule | null {
  if (/general\s*training/i.test(label)) return 'general_training';
  // The live UKVI endpoint abbreviates its modules as
  // "CDIELTS for UKVI AC" and "CDIELTS for UKVI GT".
  if (/\b(?:ukvi\s+)?gt\b/i.test(label)) return 'general_training';
  if (/academic/i.test(label)) return 'academic';
  if (/\b(?:ukvi\s+)?ac\b/i.test(label)) return 'academic';
  if (/life\s*skills/i.test(label)) return 'life_skills';
  return null;
}

function validateCapture(capture: IdpIndiaBrowserCapture): string | null {
  if (!isHttpUrlOnHost(capture.sourceUrl, IDP_INDIA_HOST)) {
    return 'source URL is not an IDP India HTTPS URL';
  }
  if (!capture.testId.trim()) return 'test id is missing';
  if (!capture.testLabel.trim()) return 'test label is missing';
  if (!capture.cityId.trim()) return 'city id is missing';
  if (!capture.cityLabel.trim()) return 'city label is missing';
  if (!capture.sessions.length) return 'capture contains no sessions';
  for (const session of capture.sessions) {
    if (!isIsoDate(session.testDate)) {
      return `invalid test date ${session.testDate}`;
    }
  }
  return null;
}

function isIdpIndiaCentre(centre: IdpIndiaCentre): boolean {
  if (centre.operator !== 'IDP') return false;
  return isHttpUrlOnHost(centre.bookingUrl, IDP_INDIA_HOST);
}

function isHttpUrlOnHost(value: string | null, hostname: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.replace(/^www\./i, '').toLowerCase() === hostname
    );
  } catch {
    return false;
  }
}

function providerLocationKey(value: string): string {
  return nameKey(value)
    .split(' ')
    .filter(
      (token) =>
        token !== 'india' &&
        token !== 'pvt' &&
        token !== 'private' &&
        token !== 'speaking',
    )
    .join(' ');
}

function locationSimilarity(sourceKey: string, centreKey: string): number {
  if (!sourceKey || !centreKey) return 0;
  if (sourceKey === centreKey) return 1;
  if (
    centreKey.endsWith(` ${sourceKey}`) ||
    centreKey.startsWith(`${sourceKey} `)
  ) {
    return 0.9;
  }
  return nameSimilarity(sourceKey, centreKey);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
}

function compareRecords(
  a: ProviderSessionRecord,
  b: ProviderSessionRecord,
): number {
  return (
    a.testDate.localeCompare(b.testDate) ||
    a.providerLocationLabel.localeCompare(b.providerLocationLabel) ||
    a.offering.sourceLabel.localeCompare(b.offering.sourceLabel) ||
    (a.timeText ?? '').localeCompare(b.timeText ?? '')
  );
}
