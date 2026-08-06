import type {
  Centre,
  CentreDataset,
  GeoPrecision,
  MergeLink,
  TestOffering,
} from '@ielts-map/core';
import {
  geoPolicyFor,
  isPinnable,
  isPlausibleForCountry,
  offeringModule,
  precisionTier,
} from '@ielts-map/core';

export type QualitySeverity = 'error' | 'warning' | 'info';
export type QualityAction =
  | 'quarantine_centre'
  | 'suppress_map_pin'
  | 'review'
  | 'none';
export type QualityDecision = 'ready' | 'needs_review' | 'quarantined';

export interface QualityIssue {
  code: string;
  severity: QualitySeverity;
  action: QualityAction;
  message: string;
}

export interface CentreQualitySignals {
  sourceSlugs: string[];
  sourceCount: number;
  operator: Centre['operator'];
  operatorSource: Centre['operatorSource'];
  country: string | null;
  city: string | null;
  citySource: Centre['address']['citySource'] | null;
  offeringCount: number;
  pricedOfferingCount: number;
  unparsedPriceCount: number;
  currencies: string[];
  contactValueCount: number;
  location: {
    present: boolean;
    pinnable: boolean;
    precision: GeoPrecision | null;
    verification: string | null;
    evidencePaths: string[];
    agreementKm: number | null;
    origin?: string | null;
    displayRights?: string | null;
    appleDisplayable?: boolean;
  };
  pendingDuplicateSlugs: string[];
}

export interface CentreQualityAnalysis {
  id: string;
  name: string;
  isNew: boolean;
  decision: QualityDecision;
  publishableBefore: boolean;
  publishableAfter: boolean;
  signals: CentreQualitySignals;
  issues: QualityIssue[];
  automatedActions: QualityAction[];
}

export interface DiscoveryFailure {
  slug: string;
  error: string;
}

export interface MergedSourceDiscovery {
  slug: string;
  centreId: string;
  centreName: string;
}

export interface CentreQualityReport {
  generatedAt: string;
  country: string;
  summary: {
    centresAnalysed: number;
    newSourcePages: number;
    newCentres: number;
    readyNewCentres: number;
    newCentresNeedingReview: number;
    quarantinedNewCentres: number;
    unresolvedNewSourcePages: number;
    ongoingUnresolvedSourcePages: number;
    failedPreviouslyKnownSourcePages: number;
    newSourcePagesMergedIntoExistingCentres: number;
    nonPinnableLocationsAcrossDataset: number;
    issuesAcrossDataset: Record<QualitySeverity, number>;
  };
  discovery: {
    newSourceSlugs: string[];
    unresolvedNewSourcePages: DiscoveryFailure[];
    ongoingUnresolvedSourcePages: DiscoveryFailure[];
    failedPreviouslyKnownSourcePages: DiscoveryFailure[];
    mergedIntoExistingCentres: MergedSourceDiscovery[];
  };
  newCentres: CentreQualityAnalysis[];
  deferredChecks: string[];
}

export interface QualityRun {
  analyses: CentreQualityAnalysis[];
  report: CentreQualityReport;
}

export interface QualityState {
  version: 1;
  unresolvedSourceSlugs: string[];
}

interface QualityOptions {
  previous: CentreDataset | null;
  pendingLinks: MergeLink[];
  parseFailures: DiscoveryFailure[];
  previousParseFailures?: DiscoveryFailure[];
  generatedAt: string;
  country: string;
}

const DEFERRED_CHECKS = [
  'Opening and registration status are not automated; curated future openings are display warnings only.',
  'No public operator feed currently supports centre-specific live dates or seat counts.',
  'IELTS.org is the listing authority; centre existence is not yet corroborated by a second operator directory.',
  'Localized addresses may be retained for matching but are never displayed as trusted directions.',
];

/**
 * Persist unresolved discoveries independently of the centre dataset. A page
 * that never parsed has no centre row, so dataset-only comparison cannot
 * remember that it was already seen.
 */
export function nextQualityState(
  report: CentreQualityReport,
  previous: QualityState | null,
): QualityState | null {
  if (report.country !== 'ALL') return previous;

  return {
    version: 1,
    unresolvedSourceSlugs: [
      ...new Set(
        report.discovery.unresolvedNewSourcePages
          .concat(report.discovery.ongoingUnresolvedSourcePages)
          .map((failure) => failure.slug),
      ),
    ].sort(),
  };
}

export function qualityStateChanged(
  previous: QualityState | null,
  next: QualityState | null,
): boolean {
  return (
    next !== null &&
    JSON.stringify(previous) !== JSON.stringify(next)
  );
}

/**
 * Analyse every centre on every refresh, while retaining a focused one-time
 * report for newly discovered source pages and centre identities.
 *
 * The function applies only two conservative safety actions:
 * - structurally unusable centres are made unpublishable;
 * - coordinates that violate the corroboration contract are downgraded so
 *   `isPinnable` cannot draw a precise-looking marker.
 */
export function analyseCentreQuality(
  centres: Centre[],
  options: QualityOptions,
): QualityRun {
  const priorIds = new Set(options.previous?.centres.map((centre) => centre.id) ?? []);
  const priorSlugs = new Set(
    options.previous?.centres.flatMap((centre) =>
      centre.sources.map((source) => source.externalSlug),
    ) ?? [],
  );
  const currentBySlug = new Map<string, Centre>();
  for (const centre of centres) {
    for (const source of centre.sources) {
      currentBySlug.set(source.externalSlug, centre);
    }
  }

  const newSourceSlugs = [...currentBySlug.keys()]
    .filter((slug) => !priorSlugs.has(slug))
    .sort();
  const newSourceSet = new Set(newSourceSlugs);
  const pendingBySlug = pendingDuplicates(options.pendingLinks);

  const analyses = centres.map((centre) =>
    analyseOne(
      centre,
      !priorIds.has(centre.id),
      centre.sources.flatMap(
        (source) => pendingBySlug.get(source.externalSlug) ?? [],
      ),
    ),
  );

  const newCentres = analyses.filter((analysis) => analysis.isNew);
  const mergedIntoExistingCentres = newSourceSlugs.flatMap((slug) => {
    const centre = currentBySlug.get(slug);
    if (!centre || !priorIds.has(centre.id)) return [];
    return [{ slug, centreId: centre.id, centreName: centre.name }];
  });
  const unresolvedNewSourcePages =
    options.country === 'ALL'
      ? options.parseFailures
          .filter(
            (failure) =>
              !priorSlugs.has(failure.slug) &&
              !(options.previousParseFailures ?? []).some(
                (previousFailure) => previousFailure.slug === failure.slug,
              ),
          )
          .sort((left, right) => left.slug.localeCompare(right.slug))
      : [];
  const previousFailedSlugs = new Set(
    (options.previousParseFailures ?? []).map((failure) => failure.slug),
  );
  const ongoingUnresolvedSourcePages =
    options.country === 'ALL'
      ? options.parseFailures
          .filter(
            (failure) =>
              !priorSlugs.has(failure.slug) &&
              previousFailedSlugs.has(failure.slug),
          )
          .sort((left, right) => left.slug.localeCompare(right.slug))
      : [];
  const failedPreviouslyKnownSourcePages = options.parseFailures
    .filter((failure) => priorSlugs.has(failure.slug))
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const issueCounts: Record<QualitySeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const analysis of analyses) {
    for (const issue of analysis.issues) issueCounts[issue.severity]++;
  }

  const report: CentreQualityReport = {
    generatedAt: options.generatedAt,
    country: options.country,
    summary: {
      centresAnalysed: centres.length,
      newSourcePages: newSourceSet.size + unresolvedNewSourcePages.length,
      newCentres: newCentres.length,
      readyNewCentres: newCentres.filter(
        (analysis) => analysis.decision === 'ready',
      ).length,
      newCentresNeedingReview: newCentres.filter(
        (analysis) => analysis.decision === 'needs_review',
      ).length,
      quarantinedNewCentres:
        newCentres.filter((analysis) => analysis.decision === 'quarantined')
          .length + unresolvedNewSourcePages.length,
      unresolvedNewSourcePages: unresolvedNewSourcePages.length,
      ongoingUnresolvedSourcePages:
        ongoingUnresolvedSourcePages.length,
      failedPreviouslyKnownSourcePages:
        failedPreviouslyKnownSourcePages.length,
      newSourcePagesMergedIntoExistingCentres:
        mergedIntoExistingCentres.length,
      nonPinnableLocationsAcrossDataset: analyses.filter(
        (analysis) => !analysis.signals.location.pinnable,
      ).length,
      issuesAcrossDataset: issueCounts,
    },
    discovery: {
      newSourceSlugs,
      unresolvedNewSourcePages,
      ongoingUnresolvedSourcePages,
      failedPreviouslyKnownSourcePages,
      mergedIntoExistingCentres,
    },
    newCentres,
    deferredChecks: DEFERRED_CHECKS,
  };

  return { analyses, report };
}

function analyseOne(
  centre: Centre,
  isNew: boolean,
  pendingSlugs: string[],
): CentreQualityAnalysis {
  const appleGeoPolicy = geoPolicyFor(centre.geo, 'apple');
  const publishableBefore = centre.isPublishable;
  const issues: QualityIssue[] = [];
  const add = (
    code: string,
    severity: QualitySeverity,
    action: QualityAction,
    message: string,
  ) => issues.push({ code, severity, action, message });

  if (!centre.name.trim()) {
    add('missing_name', 'error', 'quarantine_centre', 'No centre name was parsed.');
  }
  if (
    centre.address.raw.trim().length < 5 ||
    centre.address.lines.length === 0
  ) {
    add(
      'missing_address',
      'error',
      'quarantine_centre',
      'No usable canonical IELTS.org address was parsed.',
    );
  }
  if (!centre.address.country) {
    add(
      'missing_country',
      'error',
      'quarantine_centre',
      'The centre could not be assigned to a country.',
    );
  }
  if (centre.sources.length === 0) {
    add(
      'missing_source',
      'error',
      'quarantine_centre',
      'The centre has no authoritative source page.',
    );
  }

  if (centre.operator === 'unknown') {
    add(
      'unknown_operator',
      'warning',
      'review',
      'The booking link did not identify an operator.',
    );
  } else if (centre.operatorSource !== 'booking_domain') {
    add(
      'operator_not_domain_verified',
      'warning',
      'review',
      `Operator was derived from ${centre.operatorSource}, not a booking domain.`,
    );
  }
  if (!centre.bookingUrl && !centre.oneSkillRetakeOnly) {
    add(
      'missing_booking_url',
      'warning',
      'review',
      'No centre-specific booking link was found.',
    );
  }
  if (!centre.address.city) {
    add(
      'missing_city',
      'warning',
      'review',
      'The global address rules and verified geocoder did not produce a city.',
    );
  } else if (centre.address.citySource === 'legacy') {
    add(
      'legacy_city',
      'warning',
      'review',
      'The city was retained from legacy data rather than current evidence.',
    );
  }

  if (centre.oneSkillRetakeOnly) {
    add(
      'osr_only_centre',
      'info',
      'none',
      'IELTS.org publishes this venue for One Skill Retake without a full IELTS test offering.',
    );
  }
  if (centre.offerings.length === 0 && !centre.oneSkillRetakeOnly) {
    add(
      'no_offerings',
      'error',
      'quarantine_centre',
      'No test offering was parsed.',
    );
  }
  const pricedOfferings = centre.offerings.filter((offering) =>
    Boolean(offering.priceText?.trim()),
  );
  if (pricedOfferings.length === 0 && !centre.oneSkillRetakeOnly) {
    add(
      'no_published_price',
      'error',
      'quarantine_centre',
      'No offering has an authoritative source price string.',
    );
  }

  const malformedDerivedPrices = centre.offerings.filter(
    (offering) => !derivedPriceIsConsistent(offering),
  );
  if (malformedDerivedPrices.length) {
    add(
      'invalid_derived_price',
      'error',
      'review',
      `${malformedDerivedPrices.length} offering(s) violate the derived-price invariant; source strings remain authoritative.`,
    );
  }
  const unparsedPrices = pricedOfferings.filter(
    (offering) => offering.priceParseStatus === 'unparsed',
  );
  if (unparsedPrices.length) {
    add(
      'unparsed_price',
      'warning',
      'review',
      `${unparsedPrices.length} source price string(s) are visible but unavailable for numeric sorting/filtering.`,
    );
  }
  const currencies = [
    ...new Set(
      pricedOfferings
        .map((offering) => offering.parsedCurrency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ].sort();
  if (currencies.length > 1) {
    add(
      'multiple_currencies',
      'warning',
      'review',
      `One physical centre has prices in multiple currencies: ${currencies.join(', ')}.`,
    );
  }
  const unknownModules = centre.offerings.filter(
    (offering) => offeringModule(offering) === 'other',
  );
  if (unknownModules.length) {
    add(
      'unclassified_offering',
      'warning',
      'review',
      `${unknownModules.length} offering label(s) do not map to Academic, General Training, or Life Skills.`,
    );
  }

  let unsafeVerifiedLocation = false;
  if (!centre.geo) {
    add(
      'missing_location',
      'warning',
      'suppress_map_pin',
      'No location candidate survived validation; the centre remains listable by address.',
    );
  } else {
    if (
      !isPlausibleForCountry(
        centre.geo.lat,
        centre.geo.lng,
        centre.address.country,
      )
    ) {
      unsafeVerifiedLocation = true;
      add(
        'location_outside_country',
        'error',
        'suppress_map_pin',
        'The selected coordinate is implausible for the assigned country.',
      );
    }
    const evidence = new Set(centre.geo.evidencePaths);
    const adminVerified =
      centre.geo.source === 'admin' || evidence.has('admin');
    if (
      centre.geo.verification === 'verified' &&
      !adminVerified &&
      (evidence.size < 2 || centre.geo.agreementKm === null)
    ) {
      unsafeVerifiedLocation = true;
      add(
        'location_not_independently_corroborated',
        'error',
        'suppress_map_pin',
        'A non-admin verified point lacks two independent evidence paths with measured agreement.',
      );
    }
    if (centre.geo.verification !== 'verified') {
      add(
        'location_not_verified',
        'warning',
        'suppress_map_pin',
        `Location is ${centre.geo.verification}; precise pin display remains disabled.`,
      );
    } else if (precisionTier(centre.geo.precision) < precisionTier('street')) {
      add(
        'location_too_coarse',
        'warning',
        'suppress_map_pin',
        `Verified location precision is ${centre.geo.precision}, below street level.`,
      );
    }
  }

  if (pendingSlugs.length) {
    add(
      'pending_duplicate_candidate',
      'warning',
      'review',
      `Possible duplicate source page(s) require more identity evidence: ${[
        ...new Set(pendingSlugs),
      ]
        .sort()
        .join(', ')}.`,
    );
  }

  const contactValueCount =
    centre.contact.phones.length +
    centre.contact.emails.length +
    centre.contact.websites.length;
  if (contactValueCount === 0) {
    add(
      'missing_contact_information',
      'info',
      'none',
      'IELTS.org published no phone, email, or website.',
    );
  }

  if (unsafeVerifiedLocation && centre.geo) {
    centre.geo = {
      ...centre.geo,
      precision: 'approximate',
      verification: 'conflicted',
      confidence: Math.min(centre.geo.confidence, 0.2),
    };
  }
  if (issues.some((issue) => issue.action === 'quarantine_centre')) {
    centre.isPublishable = false;
  }

  const automatedActions = [
    ...new Set(
      issues
        .map((issue) => issue.action)
        .filter((action) => action !== 'none'),
    ),
  ];
  const decision: QualityDecision = !centre.isPublishable
    ? 'quarantined'
    : issues.some(
          (issue) =>
            issue.severity === 'error' || issue.severity === 'warning',
        )
      ? 'needs_review'
      : 'ready';

  return {
    id: centre.id,
    name: centre.name,
    isNew,
    decision,
    publishableBefore,
    publishableAfter: centre.isPublishable,
    signals: {
      sourceSlugs: centre.sources
        .map((source) => source.externalSlug)
        .sort(),
      sourceCount: centre.sources.length,
      operator: centre.operator,
      operatorSource: centre.operatorSource,
      country: centre.address.country,
      city: centre.address.city,
      citySource: centre.address.citySource ?? null,
      offeringCount: centre.offerings.length,
      pricedOfferingCount: pricedOfferings.length,
      unparsedPriceCount: unparsedPrices.length,
      currencies,
      contactValueCount,
      location: {
        present: Boolean(centre.geo),
        pinnable: isPinnable(centre.geo),
        precision: centre.geo?.precision ?? null,
        verification: centre.geo?.verification ?? null,
        evidencePaths: centre.geo?.evidencePaths ?? [],
        agreementKm: centre.geo?.agreementKm ?? null,
        origin: appleGeoPolicy.provenance?.origin ?? null,
        displayRights:
          appleGeoPolicy.provenance?.displayRights ?? null,
        appleDisplayable: appleGeoPolicy.status === 'displayable',
      },
      pendingDuplicateSlugs: [...new Set(pendingSlugs)].sort(),
    },
    issues,
    automatedActions,
  };
}

function derivedPriceIsConsistent(offering: TestOffering): boolean {
  if (offering.priceParseStatus === 'verified') {
    return (
      Boolean(offering.priceText?.trim()) &&
      Boolean(offering.parsedCurrency) &&
      offering.parsedPrice !== null &&
      Number.isFinite(offering.parsedPrice) &&
      offering.parsedPrice > 0
    );
  }
  return offering.parsedPrice === null && offering.parsedCurrency === null;
}

function pendingDuplicates(links: MergeLink[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const link of links) {
    const left = result.get(link.a) ?? [];
    left.push(link.b);
    result.set(link.a, left);
    const right = result.get(link.b) ?? [];
    right.push(link.a);
    result.set(link.b, right);
  }
  return result;
}

/** Markdown for both local output and the GitHub Actions job summary. */
export function renderQualityReport(report: CentreQualityReport): string {
  const { summary } = report;
  const lines = [
    '## Automated new-centre analysis',
    '',
    `Scanned ${summary.centresAnalysed} centres and found ${summary.newSourcePages} new source page(s), resolving to ${summary.newCentres} new centre(s).`,
    '',
  ];

  if (report.discovery.unresolvedNewSourcePages.length) {
    lines.push(
      `### Unresolved source pages (${report.discovery.unresolvedNewSourcePages.length})`,
      '',
    );
    for (const failure of report.discovery.unresolvedNewSourcePages) {
      lines.push(`- \`${failure.slug}\` — ${failure.error}`);
    }
    lines.push('');
  }

  if (report.discovery.failedPreviouslyKnownSourcePages.length) {
    lines.push(
      `### Previously known source pages that failed (${report.discovery.failedPreviouslyKnownSourcePages.length})`,
      '',
    );
    for (const failure of report.discovery.failedPreviouslyKnownSourcePages) {
      lines.push(`- \`${failure.slug}\` — ${failure.error}`);
    }
    lines.push(
      '',
      '**Safety action:** dataset writing is blocked so a transient fetch or parser regression cannot remove an existing centre.',
      '',
    );
  }

  if (report.discovery.ongoingUnresolvedSourcePages.length) {
    lines.push(
      `_${report.discovery.ongoingUnresolvedSourcePages.length} source page(s) remain unresolved from an earlier run; they are retained in the artifact but are not counted as new discoveries._`,
      '',
    );
  }

  if (report.newCentres.length) {
    lines.push(
      '| Centre | Decision | Published | Location | Apple pin | Issues |',
      '|---|---|---:|---|---:|---|',
    );
    for (const centre of report.newCentres.slice(0, 50)) {
      const location = centre.signals.location.present
        ? `${centre.signals.location.verification}/${centre.signals.location.precision}`
        : 'missing';
      const issues = centre.issues
        .filter((issue) => issue.severity !== 'info')
        .map((issue) => `\`${issue.code}\``)
        .join(', ') || 'none';
      lines.push(
        `| ${escapeMarkdownTable(centre.name)} | ${centre.decision} | ${centre.publishableAfter ? 'yes' : 'no'} | ${location} | ${centre.signals.location.appleDisplayable ? 'yes' : 'no'} | ${issues} |`,
      );
    }
    if (report.newCentres.length > 50) {
      lines.push(
        `| …and ${report.newCentres.length - 50} more | | | | | See JSON artifact |`,
      );
    }
    lines.push('');
  } else if (!report.discovery.unresolvedNewSourcePages.length) {
    lines.push('_No newly discovered centres or unresolved source pages._', '');
  }

  if (report.discovery.mergedIntoExistingCentres.length) {
    lines.push(
      `_${report.discovery.mergedIntoExistingCentres.length} new source page(s) were safely merged into existing centre identities._`,
      '',
    );
  }
  lines.push(
    `**Outcome:** ${summary.readyNewCentres} ready, ${summary.newCentresNeedingReview} published with warnings, ${summary.quarantinedNewCentres} quarantined/unresolved.`,
    '',
    'Deferred by policy:',
    ...report.deferredChecks.map((item) => `- ${item}`),
  );
  return lines.join('\n');
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}
