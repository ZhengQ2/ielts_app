import type {
  Centre,
  OfferingDeliveryMode,
  TestCategory,
  TestModule,
} from '@ielts-map/core';
import {
  nameKey,
  nameSimilarity,
  normaliseText,
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

export interface IdpGlobalLocation {
  id: string;
  externalReferenceId: string | null;
  name: string;
  addressLines: string[];
  contactEmailAddress: string | null;
  contactPhoneNumber: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface IdpGlobalSession {
  sessionId: string;
  testDate: string;
  timeText: string | null;
  testCategory: string;
  testFormat: string;
  testModule: string;
  languageSkills: string[];
  remainingSeats: number | null;
  maximumSeats: number | null;
  location: IdpGlobalLocation;
}

export interface IdpGlobalSearchCapture {
  sourceUrl: string;
  countryCode: string;
  countryName: string;
  city: string;
  totalCount: number;
  locations: IdpGlobalLocation[];
  sessions: IdpGlobalSession[];
}

interface CentreMatch {
  status: ProviderCentreMatchStatus;
  centreId: string | null;
  candidateCentreIds: string[];
}

type IdpGlobalCentre = Pick<
  Centre,
  'id' | 'name' | 'address' | 'operator' | 'bookingUrl' | 'offerings' | 'geo'
>;

const GLOBAL_IDP_HOSTS = new Set([
  'bxsearch.ielts.idp.com',
  'ielts.idp.com',
]);

export function parseIdpGlobalSearchCapture(
  value: unknown,
  context: {
    sourceUrl: string;
    countryCode: string;
    countryName: string;
    city: string;
  },
): IdpGlobalSearchCapture {
  const root = record(value, 'search response');
  const rawLocations = array(root.testLocations, 'testLocations');
  const rawItems = array(root.items, 'items');
  const locations = rawLocations.map(parseLocation);
  const sessions = rawItems.map(parseSession);
  return {
    sourceUrl: requiredHttpsUrl(context.sourceUrl),
    countryCode: requiredText(context.countryCode, 'countryCode'),
    countryName: requiredText(context.countryName, 'countryName'),
    city: requiredText(context.city, 'city'),
    totalCount: nonNegativeInteger(root.totalCount, 'totalCount'),
    locations,
    sessions,
  };
}

export function buildIdpGlobalAvailabilitySnapshot(
  captures: readonly IdpGlobalSearchCapture[],
  centres: readonly IdpGlobalCentre[],
  checkedAt: string,
): ProviderSessionSnapshot {
  const records: ProviderSessionRecord[] = [];
  const rejectedCaptures: { sourceUrl: string; reason: string }[] = [];

  for (const capture of captures) {
    const problem = validateCapture(capture);
    if (problem) {
      rejectedCaptures.push({ sourceUrl: capture.sourceUrl, reason: problem });
      continue;
    }
    for (const session of capture.sessions) {
      const offering = offeringIdentity(session);
      if (!offering) {
        rejectedCaptures.push({
          sourceUrl: capture.sourceUrl,
          reason:
            `unsupported offering ${session.testCategory}/` +
            `${session.testModule}/${session.testFormat}`,
        });
        continue;
      }
      const match = matchIdpGlobalCentre(
        capture,
        session.location,
        offering,
        centres,
      );
      records.push({
        source: 'idp_global',
        providerLocationId: session.location.id,
        providerLocationLabel: session.location.name,
        centreId: match.centreId,
        centreMatchStatus: match.status,
        candidateCentreIds: match.candidateCentreIds,
        offering,
        testDate: session.testDate,
        timeText: session.timeText,
        status:
          session.remainingSeats !== null && session.remainingSeats > 0
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
    source: 'idp_global',
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

export function idpGlobalAvailabilitySafetyProblems(
  snapshot: ProviderSessionSnapshot,
  expectedCities: number,
  expectedLocations: number,
): string[] {
  const problems: string[] = [];
  if (snapshot.source !== 'idp_global') {
    problems.push(`unexpected provider source ${snapshot.source}`);
  }
  if (snapshot.diagnostics.captures !== expectedLocations) {
    problems.push(
      `captured ${snapshot.diagnostics.captures} of ${expectedLocations} provider locations`,
    );
  }
  if (expectedCities < 1) problems.push('no provider cities were discovered');
  if (expectedLocations < 1) {
    problems.push('no provider locations were discovered');
  }
  if (snapshot.records.length < 1) {
    problems.push('no IDP Global sessions were parsed');
  }
  if (snapshot.diagnostics.rejectedCaptures.length > 0) {
    problems.push(
      `${snapshot.diagnostics.rejectedCaptures.length} IDP Global capture(s) or offering(s) were rejected`,
    );
  }
  return problems;
}

export function matchIdpGlobalCentre(
  capture: Pick<IdpGlobalSearchCapture, 'countryName' | 'city'>,
  location: IdpGlobalLocation,
  offering: ProviderOfferingIdentity,
  centres: readonly IdpGlobalCentre[],
): CentreMatch {
  const candidates = centres
    .filter(isIdpGlobalCentre)
    .filter((centre) => countryMatches(centre.address.country, capture.countryName))
    .filter((centre) => cityMatches(centre, capture.city))
    .filter((centre) =>
      centre.offerings.some(
        (candidate) =>
          offeringModule(candidate) === offering.module &&
          offeringCategory(candidate) === offering.category &&
          deliveryCompatible(
            offeringDeliveryMode(candidate),
            offering.deliveryMode,
          ),
      ),
    )
    .map((centre) => ({
      centre,
      score: centreMatchScore(centre, location),
    }))
    .filter(({ score }) => score >= 0.48)
    .sort(
      (a, b) =>
        b.score - a.score || a.centre.id.localeCompare(b.centre.id),
    );

  if (!candidates.length) {
    return { status: 'unmatched', centreId: null, candidateCentreIds: [] };
  }
  const best = candidates[0]!;
  const second = candidates[1];
  const safeMargin = !second || best.score - second.score >= 0.12;
  if (best.score >= 0.76 && safeMargin) {
    return {
      status: 'matched',
      centreId: best.centre.id,
      candidateCentreIds: candidates.map(({ centre }) => centre.id),
    };
  }
  return {
    status: 'ambiguous',
    centreId: null,
    candidateCentreIds: candidates.map(({ centre }) => centre.id),
  };
}

function parseSession(value: unknown, index: number): IdpGlobalSession {
  const item = record(value, `items[${index}]`);
  const availability =
    item.seatAvailability === null || item.seatAvailability === undefined
      ? null
      : record(item.seatAvailability, `items[${index}].seatAvailability`);
  const localDateTime = requiredText(
    item.testStartLocalDatetime,
    `items[${index}].testStartLocalDatetime`,
  );
  const dateMatch = localDateTime.match(/^(\d{4}-\d{2}-\d{2})T(.+)$/);
  if (!dateMatch) {
    throw new Error(
      `items[${index}].testStartLocalDatetime is not an ISO local datetime`,
    );
  }
  return {
    sessionId: requiredText(item.sessionId, `items[${index}].sessionId`),
    testDate: dateMatch[1]!,
    timeText: dateMatch[2]!.replace(/(?:[+-]\d{2}:\d{2}|Z)$/, '') || null,
    testCategory: requiredText(
      item.testCategory,
      `items[${index}].testCategory`,
    ),
    testFormat: requiredText(item.testFormat, `items[${index}].testFormat`),
    testModule: requiredText(item.testModule, `items[${index}].testModule`),
    languageSkills: array(
      item.languageSkills,
      `items[${index}].languageSkills`,
    ).map((skill, skillIndex) =>
      requiredText(skill, `items[${index}].languageSkills[${skillIndex}]`),
    ),
    remainingSeats: availability
      ? nullableNonNegativeInteger(
          availability.remaining,
          `items[${index}].seatAvailability.remaining`,
        )
      : null,
    maximumSeats: availability
      ? nullableNonNegativeInteger(
          availability.maxAvailable,
          `items[${index}].seatAvailability.maxAvailable`,
        )
      : null,
    location: parseLocation(item.testLocation, index),
  };
}

function parseLocation(value: unknown, index = 0): IdpGlobalLocation {
  const location = record(value, `testLocations[${index}]`);
  const address =
    location.address === null || location.address === undefined
      ? null
      : record(location.address, `testLocations[${index}].address`);
  const addressLines = address
    ? ['line1', 'line2', 'line3', 'line4']
        .map((key) => optionalText(address[key]))
        .filter((line): line is string => Boolean(line))
    : [];
  return {
    id: requiredText(location.id, `testLocations[${index}].id`),
    externalReferenceId: optionalText(location.externalReferenceId),
    name: requiredText(location.name, `testLocations[${index}].name`),
    addressLines,
    contactEmailAddress: optionalText(location.contactEmailAddress),
    contactPhoneNumber: optionalText(location.contactPhoneNumber),
    latitude: nullableFiniteNumber(location.latitude),
    longitude: nullableFiniteNumber(location.longitude),
  };
}

function offeringIdentity(
  session: IdpGlobalSession,
): ProviderOfferingIdentity | null {
  const module = moduleFromProvider(session.testModule);
  const category = categoryFromProvider(session.testCategory);
  const deliveryMode = deliveryFromProvider(
    session.testFormat,
    session.languageSkills,
  );
  if (!module || !category || deliveryMode === undefined) return null;
  return {
    module,
    category,
    deliveryMode,
    sourceTestId: session.testCategory,
    sourceModuleId: session.testModule,
    sourceLabel: [
      session.testCategory,
      session.testModule,
      session.testFormat,
    ].join(' — '),
  };
}

function moduleFromProvider(value: string): TestModule | null {
  const key = normaliseText(value);
  if (key === 'academic') return 'academic';
  if (key === 'general training') return 'general_training';
  if (key.includes('life skills')) return 'life_skills';
  return null;
}

function categoryFromProvider(value: string): TestCategory | null {
  const key = normaliseText(value);
  if (key === 'ielts') return 'standard';
  if (key.includes('ukvi') || key.includes('selt') || key.includes('life skills')) {
    return 'ukvi_selt';
  }
  return null;
}

function deliveryFromProvider(
  format: string,
  languageSkills: readonly string[],
): OfferingDeliveryMode | null | undefined {
  const key = normaliseText(format);
  if (key === 'cd' || key.includes('computer')) {
    return 'computer_delivered';
  }
  if (key === 'pb' || key.includes('paper')) return 'paper_based';
  if (
    key === 'wop' ||
    (languageSkills.some((skill) => /writing/i.test(skill)) &&
      key.includes('hybrid'))
  ) {
    return 'writing_on_paper';
  }
  if (key === 'online' || key === 'iol') return null;
  return undefined;
}

function validateCapture(capture: IdpGlobalSearchCapture): string | null {
  if (!isHttpsHost(capture.sourceUrl, 'api.session-search.prod.ielts.com')) {
    return 'source URL is not the approved IDP Global API';
  }
  if (!capture.countryCode || !capture.countryName || !capture.city) {
    return 'country/city context is incomplete';
  }
  if (capture.sessions.length < 1) return 'capture contains no sessions';
  if (
    capture.sessions.some(
      (session) =>
        !capture.locations.some(
          (location) => location.id === session.location.id,
        ),
    )
  ) {
    return 'session location was absent from response location metadata';
  }
  return null;
}

function isIdpGlobalCentre(centre: IdpGlobalCentre): boolean {
  if (centre.operator !== 'IDP' || !centre.bookingUrl) return false;
  try {
    return GLOBAL_IDP_HOSTS.has(new URL(centre.bookingUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function countryMatches(
  centreCountryCode: string | null,
  providerCountryName: string,
): boolean {
  if (!centreCountryCode) return false;
  const display = new Intl.DisplayNames(['en'], { type: 'region' }).of(
    centreCountryCode.toUpperCase(),
  );
  if (!display) return false;
  const left = countryKey(display);
  const right = countryKey(providerCountryName);
  return (
    left === right ||
    COUNTRY_ALIASES.get(left) === right ||
    COUNTRY_ALIASES.get(right) === left
  );
}

const COUNTRY_ALIASES = new Map([
  ['south korea', 'korea republic of'],
  ['laos', 'lao peoples democratic republic'],
  ['moldova', 'moldova republic of'],
  ['syria', 'syrian arab republic'],
  ['taiwan', 'taiwan province of china'],
  ['united arab emirates', 'united arab emirates the'],
]);

function countryKey(value: string): string {
  return nameKey(value).replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();
}

function cityMatches(centre: IdpGlobalCentre, providerCity: string): boolean {
  const city = nameKey(providerCity);
  if (!city) return false;
  const values = [
    centre.address.city,
    centre.address.region,
    centre.address.raw,
    centre.name,
  ]
    .filter((value): value is string => Boolean(value))
    .map(nameKey);
  return values.some(
    (value) =>
      value === city ||
      value.includes(` ${city} `) ||
      value.startsWith(`${city} `) ||
      value.endsWith(` ${city}`),
  );
}

function deliveryCompatible(
  centre: OfferingDeliveryMode | null,
  provider: OfferingDeliveryMode | null,
): boolean {
  if (provider === null) return true;
  return centre === provider;
}

function centreMatchScore(
  centre: IdpGlobalCentre,
  location: IdpGlobalLocation,
): number {
  const nameScore = nameSimilarity(
    locationKey(location.name),
    locationKey(centre.name),
  );
  const addressScore = tokenSimilarity(
    location.addressLines.join(' '),
    centre.address.raw,
  );
  const distance =
    centre.geo &&
    location.latitude !== null &&
    location.longitude !== null
      ? haversineKm(
          centre.geo.lat,
          centre.geo.lng,
          location.latitude,
          location.longitude,
        )
      : null;
  const geoScore =
    distance === null
      ? 0
      : distance <= 0.1
        ? 1
        : distance <= 0.5
          ? 0.9
          : distance <= 2
            ? 0.65
            : 0;
  return Math.max(
    nameScore,
    addressScore,
    nameScore * 0.58 + addressScore * 0.32 + geoScore * 0.1,
  );
}

function locationKey(value: string): string {
  return nameKey(value)
    .split(' ')
    .filter(
      (token) =>
        token !== 'ielts' &&
        token !== 'idp' &&
        token !== 'test' &&
        token !== 'centre' &&
        token !== 'center',
    )
    .join(' ');
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(nameKey(left).split(' ').filter(Boolean));
  const rightTokens = new Set(nameKey(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is not a non-negative integer`);
  }
  return value as number;
}

function nullableNonNegativeInteger(
  value: unknown,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, label);
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('sourceUrl must use HTTPS');
  return url.toString();
}

function isHttpsHost(value: string, host: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host;
  } catch {
    return false;
  }
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
