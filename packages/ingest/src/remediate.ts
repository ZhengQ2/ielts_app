import type {
  Centre,
  MergeLink,
  ParsedCentre,
} from '@ielts-map/core';
import { haversineKm, isPinnable } from '@ielts-map/core';
import { RESOLVE_CONCURRENCY } from './config.ts';
import { mapWithConcurrency } from './fetcher.ts';
import { type GeocodeCache } from './geocode.ts';
import {
  analyseCentreQuality,
  type CentreQualityAnalysis,
  type QualityIssue,
} from './quality.ts';
import { clusterId, localRefinementRadiusKm, resolveCluster } from './resolve.ts';

const LOCATION_ISSUES = new Set([
  'missing_location',
  'location_not_verified',
  'location_too_coarse',
  'location_not_independently_corroborated',
  'location_outside_country',
]);
const CITY_ISSUES = new Set(['missing_city', 'legacy_city']);

export type RemediationOutcome =
  | 'accepted'
  | 'unchanged'
  | 'rejected'
  | 'skipped_admin';

export interface RemediationAttempt {
  id: string;
  name: string;
  country: string | null;
  targetedIssues: string[];
  outcome: RemediationOutcome;
  reason: string;
  beforeIssues: string[];
  afterIssues: string[];
  changedFields: string[];
}

export interface PendingDuplicateEvidence {
  a: string;
  b: string;
  reason: MergeLink['reason'];
  strength: number;
  sameOperator: boolean;
  sameAddress: boolean;
  samePostcode: boolean;
  sharedPhones: string[];
  sharedEmails: string[];
  sharedWebsites: string[];
  distanceKm: number | null;
  conclusion: 'insufficient_identity_evidence';
}

export interface ProviderCallSnapshot {
  google: number;
  googlePlaces: number;
  nominatim: number;
  amap: number;
  amapPlaces: number;
  mappls: number;
  cacheHits: number;
  budgetSkips: number;
}

export interface RemediationReport {
  enabled: boolean;
  limit: number;
  candidates: number;
  attempted: number;
  accepted: number;
  unchanged: number;
  rejected: number;
  skippedAdmin: number;
  skippedOverLimit: number;
  unresolvedPagesRetried: number;
  pendingDuplicatesEvaluated: number;
  providerCalls: {
    before: ProviderCallSnapshot;
    after: ProviderCallSnapshot;
    delta: ProviderCallSnapshot;
  };
  attempts: RemediationAttempt[];
  pendingDuplicateEvidence: PendingDuplicateEvidence[];
}

export interface RemediationOptions {
  analyses: CentreQualityAnalysis[];
  clusters: ParsedCentre[][];
  cache: GeocodeCache;
  pendingLinks: MergeLink[];
  parseFailures: Array<{ slug: string; error: string }>;
  previousUnresolvedSlugs: string[];
  limit: number;
  enabled: boolean;
  /** Test seam; production always uses the evidence-scoring resolver. */
  resolve?: typeof resolveCluster;
}

interface Candidate {
  analysis: CentreQualityAnalysis;
  centreIndex: number;
  cluster: ParsedCentre[];
  targetedIssues: string[];
}

/**
 * Turn analyzer issue codes into bounded repair attempts. Only location/city
 * fields can be changed here; source text, offerings, prices, contacts and
 * centre identity remain untouched.
 */
export async function remediateCentres(
  centres: Centre[],
  options: RemediationOptions,
): Promise<RemediationReport> {
  const beforeCalls = providerCalls(options.cache);
  const clusterById = new Map(
    options.clusters.map((cluster) => [clusterId(cluster), cluster]),
  );
  const countryTotals = new Map<string, number>();
  for (const analysis of options.analyses) {
    const country = analysis.signals.country ?? 'UNASSIGNED';
    countryTotals.set(country, (countryTotals.get(country) ?? 0) + 1);
  }
  const candidates: Candidate[] = [];
  for (let centreIndex = 0; centreIndex < centres.length; centreIndex++) {
    const analysis = options.analyses[centreIndex];
    const centre = centres[centreIndex];
    if (!analysis || !centre) continue;
    const targetedIssues = analysis.issues
      .map((issue) => issue.code)
      .filter(
        (code) => LOCATION_ISSUES.has(code) || CITY_ISSUES.has(code),
      );
    const cluster = clusterById.get(centre.id);
    if (!targetedIssues.length || !cluster) continue;
    candidates.push({ analysis, centreIndex, cluster, targetedIssues });
  }
  const countryCandidates = new Map<string, number>();
  for (const candidate of candidates) {
    const country = candidate.analysis.signals.country ?? 'UNASSIGNED';
    countryCandidates.set(
      country,
      (countryCandidates.get(country) ?? 0) + 1,
    );
  }
  const countryIssuePriority = (candidate: Candidate) => {
    const country = candidate.analysis.signals.country ?? 'UNASSIGNED';
    const total = Math.max(1, countryTotals.get(country) ?? 0);
    const rate = (countryCandidates.get(country) ?? 0) / total;
    // Weight the rate by cohort size so a one-centre country at 100% does not
    // always displace a large, broadly broken country such as Oman or China.
    return rate * Math.sqrt(total);
  };
  candidates.sort(
    (left, right) =>
      Number(right.analysis.isNew) - Number(left.analysis.isNew) ||
      severityCost(right.analysis.issues) - severityCost(left.analysis.issues) ||
      countryIssuePriority(right) - countryIssuePriority(left) ||
      left.analysis.id.localeCompare(right.analysis.id),
  );

  const selected = options.enabled ? candidates.slice(0, options.limit) : [];
  const attempts = await mapWithConcurrency(
    selected,
    RESOLVE_CONCURRENCY,
    async (candidate) =>
      attemptRemediation(
        centres,
        candidate,
        options.cache,
        options.pendingLinks,
        options.resolve ?? resolveCluster,
      ),
  );
  const afterCalls = providerCalls(options.cache);
  const previousFailures = new Set(options.previousUnresolvedSlugs);
  const pendingDuplicateEvidence = inspectPendingDuplicates(
    centres,
    options.pendingLinks,
  );

  return {
    enabled: options.enabled,
    limit: options.limit,
    candidates: candidates.length,
    attempted: attempts.length,
    accepted: attempts.filter((attempt) => attempt.outcome === 'accepted').length,
    unchanged: attempts.filter((attempt) => attempt.outcome === 'unchanged').length,
    rejected: attempts.filter((attempt) => attempt.outcome === 'rejected').length,
    skippedAdmin: attempts.filter(
      (attempt) => attempt.outcome === 'skipped_admin',
    ).length,
    skippedOverLimit: options.enabled
      ? Math.max(0, candidates.length - selected.length)
      : 0,
    unresolvedPagesRetried: options.parseFailures.filter((failure) =>
      previousFailures.has(failure.slug),
    ).length,
    pendingDuplicatesEvaluated: pendingDuplicateEvidence.length,
    providerCalls: {
      before: beforeCalls,
      after: afterCalls,
      delta: subtractCalls(afterCalls, beforeCalls),
    },
    attempts,
    pendingDuplicateEvidence,
  };
}

async function attemptRemediation(
  centres: Centre[],
  candidate: Candidate,
  cache: GeocodeCache,
  pendingLinks: MergeLink[],
  resolve: typeof resolveCluster,
): Promise<RemediationAttempt> {
  const original = centres[candidate.centreIndex]!;
  const beforeIssues = candidate.analysis.issues.map((issue) => issue.code).sort();
  const base = {
    id: original.id,
    name: original.name,
    country: original.address.country,
    targetedIssues: candidate.targetedIssues,
    beforeIssues,
  };
  const targetsLocation = candidate.targetedIssues.some((code) =>
    LOCATION_ISSUES.has(code),
  );
  const targetsCity = candidate.targetedIssues.some((code) =>
    CITY_ISSUES.has(code),
  );
  if (
    original.geo?.source === 'admin' ||
    original.geo?.evidencePaths.includes('admin') ||
    original.address.citySource === 'admin'
  ) {
    return {
      ...base,
      outcome: 'skipped_admin',
      reason: 'Reviewed administrator evidence is never replaced automatically.',
      afterIssues: beforeIssues,
      changedFields: [],
    };
  }

  const resolved = await resolve(candidate.cluster, cache, {
    previous: original,
    regeocode: true,
    preferGoogle: true,
  });
  const proposed = structuredClone(original);
  const changedFields: string[] = [];

  // A location remediation may only propose a pin that already satisfies the
  // final public-display contract. Coarse or one-path coordinates remain in
  // the artifact, not as a silent movement of stored data.
  if (targetsLocation && isPinnable(resolved.geo)) {
    // The address did not change, so this re-geocode refines the existing
    // coordinate rather than looking it up fresh. A jump past the radius for
    // its precision means the new match is likely wrong, not merely more
    // precise — reject it rather than silently relocating the centre.
    if (original.geo) {
      const jumpKm = haversineKm(original.geo, resolved.geo!);
      if (jumpKm > localRefinementRadiusKm(original.geo.precision)) {
        return {
          ...base,
          outcome: 'rejected',
          reason: `Re-geocoded pin moved ${jumpKm.toFixed(1)}km from the existing coordinate for an unchanged address — treated as a mismatch, not a refinement.`,
          afterIssues: beforeIssues,
          changedFields: [],
        };
      }
    }
    proposed.geo = resolved.geo;
    proposed.googlePlaceId = resolved.googlePlaceId;
    proposed.confidence = resolved.confidence;
    if (!sameGeo(original, proposed)) changedFields.push('location');
    if (original.googlePlaceId !== proposed.googlePlaceId) {
      changedFields.push('googlePlaceId');
    }
    if (resolved.localizations?.length) {
      proposed.localizations = resolved.localizations;
    } else if (!sameGeo(original, proposed)) {
      delete proposed.localizations;
    }
  }
  if (
    targetsCity &&
    resolved.address.city &&
    resolved.address.citySource !== 'legacy'
  ) {
    proposed.address = {
      ...proposed.address,
      city: resolved.address.city,
      citySource: resolved.address.citySource,
      region: proposed.address.region ?? resolved.address.region,
      postcode: proposed.address.postcode ?? resolved.address.postcode,
    };
    if (
      original.address.city !== proposed.address.city ||
      original.address.citySource !== proposed.address.citySource
    ) {
      changedFields.push('city');
    }
  }

  const proposedRun = analyseCentreQuality([proposed], {
    previous: null,
    pendingLinks,
    parseFailures: [],
    generatedAt: new Date().toISOString(),
    country: original.address.country ?? 'ALL',
  });
  const after = proposedRun.analyses[0]!;
  const afterIssues = after.issues.map((issue) => issue.code).sort();
  const newProblems = after.issues.filter(
    (issue) =>
      issue.severity !== 'info' &&
      !candidate.analysis.issues.some(
        (before) => before.code === issue.code && before.severity === issue.severity,
      ),
  );
  const locationImproved =
    targetsLocation &&
    !candidate.analysis.signals.location.pinnable &&
    after.signals.location.pinnable;
  const cityImproved =
    targetsCity &&
    Boolean(after.signals.city) &&
    after.signals.citySource !== 'legacy';
  const costImproved =
    severityCost(after.issues) < severityCost(candidate.analysis.issues);

  if (!changedFields.length) {
    return {
      ...base,
      outcome: 'unchanged',
      reason: 'The available evidence produced the same canonical result.',
      afterIssues,
      changedFields: [],
    };
  }
  if (newProblems.length) {
    return {
      ...base,
      outcome: 'rejected',
      reason: `Proposed repair introduced ${newProblems
        .map((issue) => issue.code)
        .join(', ')}.`,
      afterIssues,
      changedFields,
    };
  }
  if (!(locationImproved || cityImproved) || !costImproved) {
    return {
      ...base,
      outcome: 'rejected',
      reason:
        'The proposal did not remove a targeted issue with a net quality improvement.',
      afterIssues,
      changedFields,
    };
  }

  centres[candidate.centreIndex] = proposed;
  return {
    ...base,
    outcome: 'accepted',
    reason: [
      locationImproved ? 'location independently verified' : null,
      cityImproved ? 'city replaced by structured evidence' : null,
    ]
      .filter(Boolean)
      .join('; '),
    afterIssues,
    changedFields: [...new Set(changedFields)].sort(),
  };
}

function severityCost(issues: QualityIssue[]): number {
  return issues.reduce((total, issue) => {
    if (issue.severity === 'error') return total + 100;
    if (issue.severity === 'warning') return total + 10;
    return total + 1;
  }, 0);
}

function sameGeo(left: Centre, right: Centre): boolean {
  if (!left.geo || !right.geo) return left.geo === right.geo;
  return (
    Math.abs(left.geo.lat - right.geo.lat) < 1e-7 &&
    Math.abs(left.geo.lng - right.geo.lng) < 1e-7 &&
    left.geo.precision === right.geo.precision &&
    left.geo.verification === right.geo.verification &&
    left.geo.confidence === right.geo.confidence &&
    JSON.stringify([...left.geo.evidencePaths].sort()) ===
      JSON.stringify([...right.geo.evidencePaths].sort()) &&
    left.geo.agreementKm === right.geo.agreementKm
  );
}

function inspectPendingDuplicates(
  centres: Centre[],
  pendingLinks: MergeLink[],
): PendingDuplicateEvidence[] {
  const bySlug = new Map<string, Centre>();
  for (const centre of centres) {
    for (const source of centre.sources) {
      bySlug.set(source.externalSlug, centre);
    }
  }

  return pendingLinks.flatMap((link) => {
    const left = bySlug.get(link.a);
    const right = bySlug.get(link.b);
    if (!left || !right || left.id === right.id) return [];
    return [{
      a: link.a,
      b: link.b,
      reason: link.reason,
      strength: link.strength,
      sameOperator:
        left.operator !== 'unknown' && left.operator === right.operator,
      sameAddress: normalized(left.address.raw) === normalized(right.address.raw),
      samePostcode:
        Boolean(left.address.postcode) &&
        normalized(left.address.postcode) === normalized(right.address.postcode),
      sharedPhones: intersection(
        left.contact.phones.map(phoneIdentity),
        right.contact.phones.map(phoneIdentity),
      ),
      sharedEmails: intersection(
        left.contact.emails.map(normalized),
        right.contact.emails.map(normalized),
      ),
      sharedWebsites: intersection(
        left.contact.websites.map(websiteIdentity),
        right.contact.websites.map(websiteIdentity),
      ),
      distanceKm:
        isPinnable(left.geo) && isPinnable(right.geo)
          ? Number(haversineKm(left.geo!, right.geo!).toFixed(3))
          : null,
      conclusion: 'insufficient_identity_evidence' as const,
    }];
  });
}

function normalized(value: string | null): string {
  return (value ?? '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
}

function phoneIdentity(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function websiteIdentity(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized(value);
  }
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.filter(Boolean));
  return [...new Set(left.filter((value) => value && rightSet.has(value)))].sort();
}

function providerCalls(cache: GeocodeCache): ProviderCallSnapshot {
  return {
    google: cache.stats.googleCalls,
    googlePlaces: cache.stats.placesCalls,
    nominatim: cache.stats.nominatimCalls,
    amap: cache.stats.amapCalls,
    amapPlaces: cache.stats.amapPlacesCalls,
    mappls: cache.stats.mapplsCalls,
    cacheHits: cache.stats.cacheHits,
    budgetSkips: cache.stats.budgetSkips,
  };
}

function subtractCalls(
  after: ProviderCallSnapshot,
  before: ProviderCallSnapshot,
): ProviderCallSnapshot {
  return Object.fromEntries(
    Object.keys(after).map((key) => [
      key,
      after[key as keyof ProviderCallSnapshot] -
        before[key as keyof ProviderCallSnapshot],
    ]),
  ) as unknown as ProviderCallSnapshot;
}

export function renderRemediationReport(report: RemediationReport): string {
  const lines = [
    '## Automated remediation',
    '',
    report.enabled
      ? `Attempted ${report.attempted}/${report.candidates} eligible centre(s): ${report.accepted} accepted, ${report.unchanged} unchanged, ${report.rejected} rejected, ${report.skippedAdmin} administrator-protected.`
      : `Remediation disabled; ${report.candidates} eligible centre(s) were analysed without mutation.`,
    '',
    `Retried ${report.unresolvedPagesRetried} previously unresolved source page(s) in the normal crawl and evaluated ${report.pendingDuplicatesEvaluated} pending duplicate pair(s).`,
    '',
    `Repair-stage provider use: ${report.providerCalls.delta.google} Google address, ${report.providerCalls.delta.googlePlaces} Google Places, ${report.providerCalls.delta.amap} AMap, ${report.providerCalls.delta.mappls} Mappls, ${report.providerCalls.delta.cacheHits} cache hits, ${report.providerCalls.delta.budgetSkips} budget skips.`,
    '',
  ];
  const accepted = report.attempts.filter(
    (attempt) => attempt.outcome === 'accepted',
  );
  if (accepted.length) {
    lines.push('### Accepted repairs', '');
    for (const attempt of accepted.slice(0, 50)) {
      lines.push(
        `- ${attempt.name} (${attempt.country ?? 'unknown'}) — ${attempt.reason}`,
      );
    }
    lines.push('');
  }
  if (report.skippedOverLimit) {
    lines.push(
      `_${report.skippedOverLimit} eligible centre(s) were deferred by the per-run remediation limit._`,
      '',
    );
  }
  return lines.join('\n');
}
