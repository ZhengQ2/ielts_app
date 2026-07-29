import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CentreQualityAnalysis,
  CentreQualityReport,
  QualityDecision,
  QualitySeverity,
} from '../src/quality.ts';
import {
  buildQualityBaseline,
  diffQualityBaselines,
  qualityBaselineChanged,
  qualityRegressionProblems,
} from '../src/quality-baseline.ts';

function analysis(
  id: string,
  options: {
    country?: string;
    decision?: QualityDecision;
    isNew?: boolean;
    pinnable?: boolean;
    issues?: Array<{ code: string; severity: QualitySeverity }>;
  } = {},
): CentreQualityAnalysis {
  const issues = options.issues ?? [];
  return {
    id,
    name: `Centre ${id}`,
    isNew: options.isNew ?? false,
    decision: options.decision ?? 'ready',
    publishableBefore: true,
    publishableAfter: options.decision !== 'quarantined',
    signals: {
      sourceSlugs: [id],
      sourceCount: 1,
      operator: 'IDP',
      operatorSource: 'booking_domain',
      country: options.country ?? 'CA',
      city: 'Toronto',
      citySource: 'address_rule',
      offeringCount: 1,
      pricedOfferingCount: 1,
      unparsedPriceCount: 0,
      currencies: ['CAD'],
      contactValueCount: 1,
      location: {
        present: true,
        pinnable: options.pinnable ?? true,
        precision: 'street',
        verification: 'verified',
        evidencePaths: ['address', 'venue_name'],
        agreementKm: 0.05,
      },
      pendingDuplicateSlugs: [],
    },
    issues: issues.map((issue) => ({
      ...issue,
      action: issue.code.startsWith('location_')
        ? 'suppress_map_pin'
        : 'review',
      message: issue.code,
    })),
    automatedActions: [],
  };
}

function report(
  country = 'ALL',
  unresolvedSourceSlugs: string[] = [],
): CentreQualityReport {
  return {
    generatedAt: '2026-07-28T00:00:00.000Z',
    country,
    summary: {
      centresAnalysed: 0,
      newSourcePages: 0,
      newCentres: 0,
      readyNewCentres: 0,
      newCentresNeedingReview: 0,
      quarantinedNewCentres: 0,
      unresolvedNewSourcePages: 0,
      ongoingUnresolvedSourcePages: unresolvedSourceSlugs.length,
      failedPreviouslyKnownSourcePages: 0,
      newSourcePagesMergedIntoExistingCentres: 0,
      nonPinnableLocationsAcrossDataset: 0,
      issuesAcrossDataset: { error: 0, warning: 0, info: 0 },
    },
    discovery: {
      newSourceSlugs: [],
      unresolvedNewSourcePages: [],
      ongoingUnresolvedSourcePages: unresolvedSourceSlugs.map((slug) => ({
        slug,
        error: 'still unresolved',
      })),
      failedPreviouslyKnownSourcePages: [],
      mergedIntoExistingCentres: [],
    },
    newCentres: [],
    deferredChecks: [],
  };
}

test('quality baselines are compact, deterministic and grouped by country', () => {
  const analyses = [
    analysis('healthy'),
    analysis('warning', {
      country: 'GB',
      decision: 'needs_review',
      pinnable: false,
      issues: [{ code: 'location_not_verified', severity: 'warning' }],
    }),
  ];
  const baseline = buildQualityBaseline(
    analyses,
    report('ALL', ['unparsed-new-page']),
  );

  assert.equal(baseline.centreCount, 2);
  assert.deepEqual(baseline.affected.map((entry) => entry.id), ['warning']);
  assert.deepEqual(baseline.unresolvedSourceSlugs, ['unparsed-new-page']);
  assert.equal(baseline.byCountry.CA?.ready, 1);
  assert.equal(baseline.byCountry.GB?.nonPinnable, 1);
  assert.deepEqual(baseline.byCountry.GB?.issues, {
    location_not_verified: 1,
  });
  assert.equal(qualityBaselineChanged(baseline, structuredClone(baseline)), false);
});

test('quality deltas separate new-centre debt from existing regressions', () => {
  const beforeAnalyses = [
    analysis('regressed'),
    analysis('improved', {
      decision: 'needs_review',
      issues: [{ code: 'legacy_city', severity: 'warning' }],
    }),
  ];
  const before = buildQualityBaseline(beforeAnalyses, report());
  const afterAnalyses = [
    analysis('regressed', {
      decision: 'needs_review',
      pinnable: false,
      issues: [{ code: 'location_not_verified', severity: 'warning' }],
    }),
    analysis('improved'),
    analysis('brand-new', {
      isNew: true,
      decision: 'needs_review',
      issues: [{ code: 'missing_city', severity: 'warning' }],
    }),
  ];
  const after = buildQualityBaseline(afterAnalyses, report());
  const delta = diffQualityBaselines(before, after, afterAnalyses);

  assert.deepEqual(delta.newIssues.map((issue) => issue.code), [
    'location_not_verified',
  ]);
  assert.deepEqual(delta.newCentreIssues.map((issue) => issue.code), [
    'missing_city',
  ]);
  assert.deepEqual(delta.resolvedIssues.map((issue) => issue.code), [
    'legacy_city',
  ]);
  assert.equal(delta.summary.newlyNonPinnable, 1);
  assert.equal(delta.summary.decisionRegressions, 1);
  assert.equal(delta.summary.decisionImprovements, 1);
});

test('the first baseline initializes without inventing regressions', () => {
  const analyses = [
    analysis('warning', {
      decision: 'needs_review',
      issues: [{ code: 'legacy_city', severity: 'warning' }],
    }),
  ];
  const current = buildQualityBaseline(analyses, report());
  const delta = diffQualityBaselines(null, current, analyses);

  assert.equal(delta.initialized, true);
  assert.equal(delta.summary.newIssues, 0);
  assert.deepEqual(qualityRegressionProblems(null, delta), []);
});

test('systemic existing-centre regressions trip the quality gate', () => {
  const beforeAnalyses = Array.from({ length: 100 }, (_, index) =>
    analysis(`centre-${index}`),
  );
  const before = buildQualityBaseline(beforeAnalyses, report());
  const afterAnalyses = beforeAnalyses.map((item, index) =>
    index < 30
      ? analysis(item.id, {
          decision: 'needs_review',
          pinnable: false,
          issues: [
            { code: 'location_not_verified', severity: 'warning' },
          ],
        })
      : item,
  );
  const after = buildQualityBaseline(afterAnalyses, report());
  const delta = diffQualityBaselines(before, after, afterAnalyses);
  const problems = qualityRegressionProblems(before, delta);

  assert.ok(
    problems.some((problem) =>
      problem.includes('existing-centre quality issues'),
    ),
  );
  assert.ok(
    problems.some((problem) => problem.includes('map pins became unsafe')),
  );
});

test('a legitimate batch of new non-pinnable centres is reported but not treated as regression', () => {
  const beforeAnalyses = Array.from({ length: 100 }, (_, index) =>
    analysis(`existing-${index}`),
  );
  const before = buildQualityBaseline(beforeAnalyses, report());
  const additions = Array.from({ length: 20 }, (_, index) =>
    analysis(`new-${index}`, {
      isNew: true,
      decision: 'needs_review',
      pinnable: false,
      issues: [{ code: 'location_not_verified', severity: 'warning' }],
    }),
  );
  const afterAnalyses = [...beforeAnalyses, ...additions];
  const after = buildQualityBaseline(afterAnalyses, report());
  const delta = diffQualityBaselines(before, after, afterAnalyses);

  assert.equal(delta.summary.newCentreIssues, 20);
  assert.equal(delta.summary.newlyNonPinnable, 0);
  assert.deepEqual(qualityRegressionProblems(before, delta), []);
});
