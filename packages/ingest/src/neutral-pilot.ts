import type { Centre } from '@ielts-map/core';
import { haversineKm } from '@ielts-map/core';

const RESTRICTED_GOOGLE_SOURCES = new Set(['google', 'google_places']);
const NAME_STOP_WORDS = new Set([
  'ielts',
  'test',
  'testing',
  'centre',
  'center',
  'central',
  'computer',
  'cbd',
  'official',
  'online',
  'station',
  'venue',
  'location',
  'international',
  'education',
  'academy',
  'institute',
  'school',
  'college',
  'university',
  'services',
  'solutions',
  'lab',
  'laboratory',
]);
const GENERIC_OPERATOR_TOKENS = new Set([
  'british',
  'council',
  'idp',
  'education',
  'limited',
  'ltd',
]);
const GENERIC_IDENTITY_TOKENS = new Set([
  'global',
  'english',
  'language',
]);
const GENERIC_CONTACT_HOSTS = new Set([
  'britishcouncil.org',
  'ielts.org',
  'ielts.idp.com',
]);
const GENERIC_IDENTIFIERS = new Set([
  'cbd',
  'gt',
  'ielts',
  'selt',
  'ukvi',
]);

export interface NeutralPilotCentre {
  id: string;
  name: string;
  address: string;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string;
  phones: string[];
  websites: string[];
  restrictedCoordinate: { lat: number; lng: number };
  restrictedSource: 'google' | 'google_places';
}

export interface OvertureSourceLineage {
  property: string | null;
  dataset: string | null;
  license: string | null;
  recordId: string | null;
  updateTime: string | null;
  confidence: number | null;
}

export interface OverturePlaceCandidate {
  /** Pilot sample that produced this candidate; never a durable provider field. */
  pilotCentreId?: string;
  kind?: 'place' | 'address';
  id: string;
  name: string;
  alternateNames?: string[];
  address: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
  confidence: number | null;
  websites: string[];
  phones: string[];
  emails?: string[];
  discoveryPaths?: Array<'venue_name' | 'address' | 'contact'>;
  sourceLineage?: OvertureSourceLineage[];
  /** Retained for compatibility with version-one pilot reports. */
  sourceLicenses: string[];
}

export type PilotMatchStatus =
  | 'strong_candidate'
  | 'possible_candidate'
  | 'no_candidate';

export type PilotMatchDecision = 'accept' | 'review' | 'reject';

export type PilotDecisionReason =
  | 'two_independent_evidence_paths'
  | 'campus_level_candidate'
  | 'subpremise_not_confirmed'
  | 'same_operator_different_address'
  | 'country_conflict'
  | 'insufficient_identity_evidence'
  | 'insufficient_independent_evidence';

export interface PilotCandidateMatch {
  status: PilotMatchStatus;
  decision: PilotMatchDecision;
  decisionReasons: PilotDecisionReason[];
  score: number;
  nameScore: number;
  addressScore: number;
  cityMatches: boolean;
  postcodeMatches: boolean;
  contactMatches: boolean;
  distanceKm: number;
  addressConflict: boolean;
  recommendedPrecision: 'exact' | 'campus' | null;
  evidencePaths: Array<'venue_name' | 'address' | 'contact'>;
  candidate: OverturePlaceCandidate;
}

/**
 * Select two deterministic centres from each of the 25 largest Google-backed
 * country strata. The pilot therefore exercises the markets that affect most
 * users while still covering multiple scripts and all inhabited regions.
 */
export function selectNeutralPilotSample(
  centres: Centre[],
  limit = 50,
): NeutralPilotCentre[] {
  const byCountry = new Map<string, Centre[]>();
  for (const centre of centres) {
    if (
      !centre.geo ||
      !RESTRICTED_GOOGLE_SOURCES.has(centre.geo.source) ||
      !centre.address.country
    ) {
      continue;
    }
    const group = byCountry.get(centre.address.country) ?? [];
    group.push(centre);
    byCountry.set(centre.address.country, group);
  }

  const strata = [...byCountry.entries()]
    .map(([country, rows]) => ({
      country,
      rows: rows.sort(
        (left, right) =>
          stableHash(left.id) - stableHash(right.id) ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        right.rows.length - left.rows.length ||
        left.country.localeCompare(right.country),
    )
    .slice(0, Math.min(limit, 25));

  const selected: Centre[] = [];
  for (let round = 0; selected.length < limit; round++) {
    let added = false;
    for (const stratum of strata) {
      const centre = stratum.rows[round];
      if (!centre) continue;
      selected.push(centre);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }

  return selected.map((centre) => ({
    id: centre.id,
    name: centre.name,
    address: centre.address.raw,
    city: centre.address.city,
    region: centre.address.region,
    postcode: centre.address.postcode,
    country: centre.address.country!,
    phones: centre.contact.phones,
    websites: centre.contact.websites,
    restrictedCoordinate: {
      lat: centre.geo!.lat,
      lng: centre.geo!.lng,
    },
    restrictedSource: centre.geo!.source as 'google' | 'google_places',
  }));
}

export function distinctiveNameTokens(name: string): string[] {
  return [
    ...new Set(
      normalise(name)
        .split(' ')
        .filter((token) => token.length >= 3 && !NAME_STOP_WORDS.has(token)),
    ),
  ].slice(0, 5);
}

export function distinctiveAddressTokens(
  centre: Pick<
    NeutralPilotCentre,
    'address' | 'city' | 'region' | 'postcode' | 'country'
  >,
): string[] {
  const ignored = new Set([
    ...normalise(centre.city).split(' '),
    ...normalise(centre.region).split(' '),
    ...normalise(centre.postcode).split(' '),
    ...normalise(regionDisplayName(centre.country)).split(' '),
    'building',
    'floor',
    'road',
    'street',
  ]);
  return [
    ...new Set(
      normalise(centre.address)
        .split(' ')
        .filter(
          (token) =>
            token.length >= 3 &&
            !ignored.has(token) &&
            !/^\p{Number}+$/u.test(token),
        ),
    ),
  ].slice(0, 8);
}

export function matchOvertureCandidate(
  centre: NeutralPilotCentre,
  candidate: OverturePlaceCandidate,
): PilotCandidateMatch {
  const candidateNames = [
    candidate.name,
    ...(candidate.alternateNames ?? []),
  ].filter(Boolean);
  const nameScore =
    candidate.kind === 'address'
      ? 0
      : Math.max(
          0,
          ...candidateNames.map((name) => nameSimilarity(centre, name)),
        );
  const sourceAddress = withoutLocationTerms(centre.address, centre);
  const candidateAddress = withoutLocationTerms(
    candidate.address ?? '',
    centre,
  );
  const addressScore = textSimilarity(sourceAddress, candidateAddress);
  const cityMatches = textContainsEither(centre.city, candidate.locality);
  const postcodeMatches =
    Boolean(centre.postcode) &&
    Boolean(candidate.postcode) &&
    compact(centre.postcode) === compact(candidate.postcode);
  const postcodeConflicts =
    Boolean(centre.postcode) &&
    Boolean(candidate.postcode) &&
    !postcodeMatches;
  const cityConflicts =
    Boolean(centre.city) &&
    Boolean(candidate.locality) &&
    !cityMatches;
  const contactMatches =
    phoneOverlap(centre.phones, candidate.phones) ||
    websiteOverlap(centre.websites, candidate.websites);
  const distanceKm = haversineKm(
    centre.restrictedCoordinate,
    candidate,
  );
  const countryConflict =
    Boolean(candidate.country) &&
    compact(candidate.country) !== compact(centre.country);
  const streetNumberConflictValue = streetNumbersConflict(
    sourceAddress,
    candidateAddress,
  );
  const structuredLocationConflict =
    (postcodeConflicts || cityConflicts) && addressScore < 0.35;
  const addressConflict =
    streetNumberConflictValue || structuredLocationConflict;
  const nameEvidence = nameScore >= 0.5;
  const addressEvidence =
    Boolean(candidateAddress) &&
    !addressConflict &&
    (addressScore >= 0.35 ||
      (postcodeMatches && addressScore >= 0.22));
  const evidencePaths: PilotCandidateMatch['evidencePaths'] = [];
  if (nameEvidence) evidencePaths.push('venue_name');
  if (addressEvidence) evidencePaths.push('address');
  if (contactMatches) evidencePaths.push('contact');

  const score = clamp(
    nameScore * 0.58 +
      addressScore * 0.27 +
      (postcodeMatches ? 0.04 : 0) +
      (cityMatches ? 0.02 : 0) +
      (contactMatches ? 0.15 : 0),
  );
  const campusCandidate =
    !countryConflict &&
    nameScore >= 0.5 &&
    (isInstitutionName(centre.name) ||
      isInstitutionName(candidateNames.join(' '))) &&
    (cityMatches || postcodeMatches);
  const subpremiseLost =
    hasSubpremise(centre.address) &&
    !hasSubpremise(candidate.address ?? '');
  const subpremiseConflict = subpremiseNumbersConflict(
    centre.address,
    candidate.address ?? '',
  );
  const decisionReasons: PilotDecisionReason[] = [];
  let decision: PilotMatchDecision;
  let status: PilotMatchStatus;
  let recommendedPrecision: PilotCandidateMatch['recommendedPrecision'];

  if (countryConflict) {
    decision = 'reject';
    status = 'no_candidate';
    recommendedPrecision = null;
    decisionReasons.push('country_conflict');
  } else if (
    structuredLocationConflict &&
    (nameEvidence ||
      contactMatches ||
      sharesOperatorIdentity(centre.name, candidateNames))
  ) {
    decision = 'reject';
    status = 'no_candidate';
    recommendedPrecision = null;
    decisionReasons.push('same_operator_different_address');
  } else if (
    campusCandidate &&
    (addressConflict ||
      !addressEvidence ||
      subpremiseLost ||
      subpremiseConflict)
  ) {
    decision = 'review';
    status = 'possible_candidate';
    recommendedPrecision = 'campus';
    decisionReasons.push('campus_level_candidate');
  } else if (subpremiseLost && evidencePaths.length >= 2) {
    decision = 'review';
    status = 'possible_candidate';
    recommendedPrecision = 'campus';
    decisionReasons.push('subpremise_not_confirmed');
  } else if (
    addressConflict &&
    (nameScore >= 0.4 || sharesOperatorIdentity(centre.name, candidateNames))
  ) {
    decision = 'reject';
    status = 'no_candidate';
    recommendedPrecision = null;
    decisionReasons.push('same_operator_different_address');
  } else if (evidencePaths.length >= 2) {
    decision = 'accept';
    status = 'strong_candidate';
    recommendedPrecision = 'exact';
    decisionReasons.push('two_independent_evidence_paths');
  } else if (
    nameEvidence &&
    (cityMatches || postcodeMatches || addressScore >= 0.2)
  ) {
    decision = 'review';
    status = 'possible_candidate';
    recommendedPrecision = null;
    decisionReasons.push('insufficient_independent_evidence');
  } else if (
    candidate.kind === 'address' &&
    addressEvidence &&
    (cityMatches || postcodeMatches)
  ) {
    decision = 'review';
    status = 'possible_candidate';
    recommendedPrecision = null;
    decisionReasons.push('insufficient_identity_evidence');
  } else {
    decision = 'reject';
    status = 'no_candidate';
    recommendedPrecision = null;
    decisionReasons.push(
      nameEvidence || addressEvidence
        ? 'insufficient_independent_evidence'
        : 'insufficient_identity_evidence',
    );
  }

  return {
    status,
    decision,
    decisionReasons,
    score: round(score),
    nameScore: round(nameScore),
    addressScore: round(addressScore),
    cityMatches,
    postcodeMatches,
    contactMatches,
    distanceKm: Number(distanceKm.toFixed(3)),
    addressConflict,
    recommendedPrecision,
    evidencePaths,
    candidate,
  };
}

export function rankOvertureCandidates(
  centre: NeutralPilotCentre,
  candidates: OverturePlaceCandidate[],
  limit = 5,
): PilotCandidateMatch[] {
  const priority: Record<PilotMatchDecision, number> = {
    accept: 2,
    review: 1,
    reject: 0,
  };
  const rejectionPriority = (match: PilotCandidateMatch): number =>
    match.decisionReasons.includes('same_operator_different_address')
      ? 2
      : match.decisionReasons.includes('insufficient_independent_evidence')
        ? 1
        : 0;
  return candidates
    .filter(
      (candidate) =>
        !candidate.pilotCentreId || candidate.pilotCentreId === centre.id,
    )
    .map((candidate) => matchOvertureCandidate(centre, candidate))
    .sort(
      (left, right) =>
        priority[right.decision] - priority[left.decision] ||
        rejectionPriority(right) - rejectionPriority(left) ||
        right.score - left.score ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, limit);
}

export function bestOvertureMatch(
  centre: NeutralPilotCentre,
  candidates: OverturePlaceCandidate[],
  _radiusKm?: number,
): PilotCandidateMatch | null {
  return rankOvertureCandidates(centre, candidates, 1)[0] ?? null;
}

function normalise(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .toLocaleLowerCase('und')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

function compact(value: string | null | undefined): string {
  return normalise(value).replaceAll(' ', '');
}

function tokenContainment(left: string, right: string): number {
  const leftTokens = new Set(normalise(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalise(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common++;
  }
  return common / Math.min(leftTokens.size, rightTokens.size);
}

function tokenDice(left: string, right: string): number {
  const leftTokens = new Set(normalise(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalise(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) common++;
  }
  return (2 * common) / (leftTokens.size + rightTokens.size);
}

function bigramDice(left: string, right: string): number {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index++) {
    const pair = a.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  let intersection = 0;
  for (let index = 0; index < b.length - 1; index++) {
    const pair = b.slice(index, index + 2);
    const count = counts.get(pair) ?? 0;
    if (!count) continue;
    intersection++;
    counts.set(pair, count - 1);
  }
  return (2 * intersection) / (a.length + b.length - 2);
}

function textSimilarity(left: string, right: string): number {
  return Math.max(tokenDice(left, right), bigramDice(left, right));
}

function nameSimilarity(
  centre: NeutralPilotCentre,
  candidateName: string,
): number {
  const ignored = new Set([
    ...normalise(centre.city).split(' '),
    ...normalise(centre.region).split(' '),
    ...normalise(regionDisplayName(centre.country)).split(' '),
    ...NAME_STOP_WORDS,
    ...GENERIC_IDENTITY_TOKENS,
  ]);
  for (const token of normalise(centre.address).split(' ')) {
    if (token.length >= 3) ignored.add(token);
  }
  const source = comparisonName(centre.name, ignored);
  const candidate = comparisonName(candidateName, ignored);
  if (!source || !candidate) {
    return 0;
  }
  const sourceDistinct = comparisonName(source, GENERIC_OPERATOR_TOKENS);
  const candidateDistinct = comparisonName(candidate, GENERIC_OPERATOR_TOKENS);
  if (!sourceDistinct || !candidateDistinct) {
    return 0;
  }
  return Math.max(
    tokenDice(sourceDistinct, candidateDistinct),
    bigramDice(sourceDistinct, candidateDistinct),
    sourceDistinct && candidateDistinct
      ? distinctiveContainment(
          sourceDistinct,
          candidateDistinct,
          centre.name,
          candidateName,
        )
      : 0,
  );
}

function distinctiveContainment(
  source: string,
  candidate: string,
  rawSource: string,
  rawCandidate: string,
): number {
  const sourceTokens = new Set(normalise(source).split(' ').filter(Boolean));
  const candidateTokens = new Set(normalise(candidate).split(' ').filter(Boolean));
  const common = [...sourceTokens].filter((token) => candidateTokens.has(token));
  if (common.length >= 2) {
    return common.length / Math.min(sourceTokens.size, candidateTokens.size);
  }

  // A single shared geographic word ("Siam", "Chicago") is not identity.
  // Permit one-token containment only for an operator-published identifier
  // such as AEO, MTS, STS, CASSOL or EIKEN.
  const publishedIdentifiers = new Set(
    rawSource.match(/\b[A-Z][A-Z0-9]{2,11}\b/g)?.map((token) => token.toLowerCase()) ??
      [],
  );
  const candidateIdentity = new Set(normalise(rawCandidate).split(' '));
  return common.some(
    (token) =>
      publishedIdentifiers.has(token) &&
      !GENERIC_IDENTIFIERS.has(token) &&
      candidateIdentity.has(token),
  )
    ? 1
    : 0;
}

function comparisonName(value: string, ignored: Set<string>): string {
  return normalise(value)
    .split(' ')
    .filter((token) => token && !ignored.has(token))
    .join(' ');
}

function withoutLocationTerms(
  value: string,
  centre: NeutralPilotCentre,
): string {
  const ignored = new Set([
    ...normalise(centre.city).split(' '),
    ...normalise(centre.region).split(' '),
    ...normalise(centre.postcode).split(' '),
    ...normalise(regionDisplayName(centre.country)).split(' '),
  ]);
  return normalise(value)
    .split(' ')
    .filter((token) => token && !ignored.has(token))
    .join(' ');
}

function regionDisplayName(country: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(country) ?? '';
  } catch {
    return '';
  }
}

function streetNumbersConflict(left: string, right: string): boolean {
  const leftNumbers = new Set(left.match(/\p{Number}+/gu) ?? []);
  const rightNumbers = new Set(right.match(/\p{Number}+/gu) ?? []);
  if (!leftNumbers.size || !rightNumbers.size) return false;
  for (const number of leftNumbers) {
    if (rightNumbers.has(number)) return false;
  }
  return true;
}

function isInstitutionName(value: string): boolean {
  return /\b(?:campus|college|school|university|universitario|universite|universidad)\b/i.test(
    value,
  );
}

function hasSubpremise(value: string): boolean {
  return /\b(?:bldg|building|floor|fl|level|room|suite|unit)\b/i.test(value);
}

function subpremiseNumbersConflict(left: string, right: string): boolean {
  const extract = (value: string): Set<string> =>
    new Set(
      [...value.matchAll(
        /\b(?:bldg|building|floor|fl|level|room|suite|unit)\.?\s*[-#:]?\s*(\d+[a-z]?)/gi,
      )].map((match) => match[1]!.toLowerCase()),
    );
  const leftNumbers = extract(left);
  const rightNumbers = extract(right);
  if (!leftNumbers.size || !rightNumbers.size) return false;
  return ![...leftNumbers].some((number) => rightNumbers.has(number));
}

function sharesOperatorIdentity(
  sourceName: string,
  candidateNames: string[],
): boolean {
  const source = normalise(sourceName);
  const candidates = normalise(candidateNames.join(' '));
  return [
    'british council',
    'idp',
    'wall street english',
    'aeo',
    'mts',
  ].some(
    (operator) =>
      source.includes(operator) && candidates.includes(operator),
  );
}

function phoneOverlap(left: string[], right: string[]): boolean {
  const identities = new Set(
    left
      .map((phone) => phone.replace(/\D/g, '').slice(-8))
      .filter((phone) => phone.length >= 7),
  );
  return right.some((phone) =>
    identities.has(phone.replace(/\D/g, '').slice(-8)),
  );
}

function websiteOverlap(left: string[], right: string[]): boolean {
  const hosts = new Set(
    left
      .map(websiteHost)
      .filter((host) => host && !GENERIC_CONTACT_HOSTS.has(host)),
  );
  return right.some((website) => {
    const host = websiteHost(website);
    return Boolean(host && !GENERIC_CONTACT_HOSTS.has(host) && hosts.has(host));
  });
}

function websiteHost(value: string): string {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function textContainsEither(
  left: string | null,
  right: string | null,
): boolean {
  const a = normalise(left);
  const b = normalise(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
