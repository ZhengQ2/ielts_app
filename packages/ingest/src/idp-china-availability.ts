import type { Centre, TestModule } from '@ielts-map/core';
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

const IDP_CHINA_SOURCE_URL = 'https://www.idpielts.cn/test-dates';

export interface IdpChinaSession {
  sessionId: string;
  centreId: string;
  centreEnglishName: string;
  centreChineseName: string;
  projectCode: string;
  projectName: string;
  testDate: string;
  timeText: string;
  capacity: number;
  registrations: number;
  fullyBooked: boolean;
}

interface CentreMatch {
  status: ProviderCentreMatchStatus;
  centreId: string | null;
  candidateCentreIds: string[];
}

type IdpChinaCentre = Pick<
  Centre,
  'id' | 'name' | 'operator' | 'bookingUrl' | 'offerings' | 'address'
>;

export function parseIdpChinaSessionPage(value: unknown): {
  total: number;
  sessions: IdpChinaSession[];
} {
  const root = record(value, 'IDP China session page');
  if (root.code !== 200) {
    throw new Error(
      `IDP China session page code was ${String(root.code ?? 'missing')}`,
    );
  }
  const rows = array(root.rows, 'IDP China session rows');
  const total = nonNegativeInteger(root.total, 'IDP China session total');
  const sessions = rows.map((row, index) => parseSession(row, index));
  if (sessions.length > total) {
    throw new Error(
      `IDP China session page returned ${sessions.length} rows for total ${total}`,
    );
  }
  return { total, sessions };
}

export function buildIdpChinaAvailabilitySnapshot(
  sessions: readonly IdpChinaSession[],
  centres: readonly IdpChinaCentre[],
  checkedAt: string,
): ProviderSessionSnapshot {
  const records: ProviderSessionRecord[] = sessions.map((session) => {
    const offering = offeringIdentity(session);
    const match = matchIdpChinaCentre(
      session.centreEnglishName,
      offering,
      centres,
    );
    return {
      source: 'idp_china',
      providerLocationId: session.centreId,
      providerLocationLabel: session.centreEnglishName,
      centreId: match.centreId,
      centreMatchStatus: match.status,
      candidateCentreIds: match.candidateCentreIds,
      offering,
      testDate: session.testDate,
      timeText: session.timeText,
      status:
        !session.fullyBooked &&
        session.capacity > session.registrations
          ? 'available'
          : 'session_published',
      sourceUrl: IDP_CHINA_SOURCE_URL,
      checkedAt,
    };
  });

  records.sort(compareRecords);
  return {
    version: 1,
    source: 'idp_china',
    checkedAt,
    records,
    diagnostics: {
      captures: new Set(sessions.map((session) => session.centreId)).size,
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
      rejectedCaptures: [],
    },
  };
}

export function idpChinaAvailabilitySafetyProblems(
  snapshot: ProviderSessionSnapshot,
  expectedSessions: number,
): string[] {
  const problems: string[] = [];
  if (snapshot.source !== 'idp_china') {
    problems.push(`unexpected provider source ${snapshot.source}`);
  }
  if (expectedSessions < 1) {
    problems.push('no IDP China sessions were returned');
  }
  if (snapshot.records.length !== expectedSessions) {
    problems.push(
      `parsed ${snapshot.records.length} of ${expectedSessions} IDP China sessions`,
    );
  }
  if (snapshot.diagnostics.captures < 1) {
    problems.push('no IDP China centres were captured');
  }
  if (snapshot.diagnostics.explicitlyAvailable < 1) {
    problems.push('no IDP China sessions had explicit remaining capacity');
  }
  return problems;
}

export function matchIdpChinaCentre(
  centreEnglishName: string,
  offering: ProviderOfferingIdentity,
  centres: readonly IdpChinaCentre[],
): CentreMatch {
  const sourceKey = providerCentreKey(centreEnglishName);
  if (!sourceKey) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }
  const scored = centres
    .filter(isIdpChinaCentre)
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
      score: locationSimilarity(
        sourceKey,
        providerCentreKey(centre.name),
      ),
    }))
    .filter(({ score }) => score >= 0.5)
    .sort(
      (a, b) =>
        b.score - a.score || a.centre.id.localeCompare(b.centre.id),
    );

  if (!scored.length) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }
  const best = scored[0]!;
  const second = scored[1];
  const safeMargin = !second || best.score - second.score >= 0.2;
  const candidateCentreIds = scored.map(({ centre }) => centre.id);
  if (best.score >= 0.82 && safeMargin) {
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

function parseSession(value: unknown, index: number): IdpChinaSession {
  const row = record(value, `IDP China session row ${index}`);
  const projectCode = requiredText(
    row.projectCode,
    `IDP China session row ${index} projectCode`,
  );
  if (projectCode !== '22' && projectCode !== '23') {
    throw new Error(
      `IDP China session row ${index} has unsupported project ${projectCode}`,
    );
  }
  const fullyBookedText = requiredText(
    row.fullyBooked,
    `IDP China session row ${index} fullyBooked`,
  );
  if (fullyBookedText !== '0' && fullyBookedText !== '1') {
    throw new Error(
      `IDP China session row ${index} has invalid fullyBooked value`,
    );
  }
  const testDate = requiredText(
    row.examTimeOrigin,
    `IDP China session row ${index} examTimeOrigin`,
  );
  if (!isIsoDate(testDate)) {
    throw new Error(
      `IDP China session row ${index} has invalid date ${testDate}`,
    );
  }
  return {
    sessionId: requiredText(
      row.ID,
      `IDP China session row ${index} ID`,
    ),
    centreId: requiredText(
      row.centerId,
      `IDP China session row ${index} centerId`,
    ),
    centreEnglishName: requiredText(
      row.centerEnName,
      `IDP China session row ${index} centerEnName`,
    ),
    centreChineseName: requiredText(
      row.centerCnName,
      `IDP China session row ${index} centerCnName`,
    ),
    projectCode,
    projectName: requiredText(
      row.projectName,
      `IDP China session row ${index} projectName`,
    ),
    testDate,
    timeText: requiredText(
      row.examTime,
      `IDP China session row ${index} examTime`,
    ),
    capacity: numericInteger(
      row.participantsCount,
      `IDP China session row ${index} participantsCount`,
    ),
    registrations: numericInteger(
      row.signUpCount,
      `IDP China session row ${index} signUpCount`,
    ),
    fullyBooked: fullyBookedText === '1',
  };
}

function offeringIdentity(
  session: Pick<IdpChinaSession, 'projectCode' | 'projectName'>,
): ProviderOfferingIdentity {
  const module: TestModule =
    session.projectCode === '22' ? 'academic' : 'general_training';
  return {
    module,
    category: 'standard',
    deliveryMode: 'computer_delivered',
    sourceTestId: session.projectCode,
    sourceModuleId: session.projectCode,
    sourceLabel: session.projectName,
  };
}

function isIdpChinaCentre(centre: IdpChinaCentre): boolean {
  if (centre.operator !== 'IDP' || centre.address.country !== 'CN') {
    return false;
  }
  try {
    const url = new URL(centre.bookingUrl ?? '');
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'sign.idpielts.cn'
    );
  } catch {
    return false;
  }
}

function providerCentreKey(value: string): string {
  return nameKey(value)
    .split(' ')
    .filter(
      (token) =>
        token !== 'idp' &&
        token !== 'ielts' &&
        token !== 'china' &&
        token !== 'test' &&
        token !== 'center' &&
        token !== 'centre',
    )
    .join(' ');
}

function locationSimilarity(sourceKey: string, centreKey: string): number {
  if (!sourceKey || !centreKey) return 0;
  if (sourceKey === centreKey) return 1;
  if (
    sourceKey.includes(centreKey) ||
    centreKey.includes(sourceKey)
  ) {
    return 0.9;
  }
  return nameSimilarity(sourceKey, centreKey);
}

function compareRecords(
  a: ProviderSessionRecord,
  b: ProviderSessionRecord,
): number {
  return (
    a.testDate.localeCompare(b.testDate) ||
    a.providerLocationLabel.localeCompare(b.providerLocationLabel) ||
    a.offering.module.localeCompare(b.offering.module) ||
    (a.timeText ?? '').localeCompare(b.timeText ?? '')
  );
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is not a non-negative integer`);
  }
  return Number(value);
}

function numericInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is not a non-negative integer`);
  }
  return parsed;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value;
}
