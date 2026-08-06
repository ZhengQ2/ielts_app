import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Centre, CentreDataset, MergeLink } from '@ielts-map/core';
import {
  analyseCentreQuality,
  nextQualityState,
  qualityStateChanged,
  renderQualityReport,
} from '../src/quality.ts';

const generatedAt = '2026-07-28T00:00:00.000Z';

function centre(over: Partial<Centre> & { id: string }): Centre {
  return {
    id: over.id,
    name: 'Healthy IELTS Centre',
    operator: 'IDP',
    operatorSource: 'booking_domain',
    externalId: null,
    ieltsOrgSlug: over.id,
    mergedSlugs: [],
    address: {
      raw: '1 Main Street, Toronto, ON, M5V 1A1',
      lines: ['1 Main Street', 'Toronto', 'ON', 'M5V 1A1'],
      city: 'Toronto',
      citySource: 'address_rule',
      region: 'ON',
      postcode: 'M5V 1A1',
      country: 'CA',
    },
    contact: {
      phones: ['+1 416 555 0100'],
      emails: ['ielts@example.test'],
      websites: ['https://example.test/ielts'],
    },
    phone: '+1 416 555 0100',
    geo: {
      lat: 43.65,
      lng: -79.38,
      precision: 'rooftop',
      source: 'google',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['address', 'venue_name'],
      agreementKm: 0.04,
      confidence: 0.9,
    },
    googlePlaceId: 'place-id',
    formats: ['computer_delivered'],
    offerings: [
      {
        label: 'IELTS Academic on computer',
        kind: 'academic',
        module: 'academic',
        category: 'standard',
        format: 'computer_delivered',
        priceText: 'CAD 359',
        parsedCurrency: 'CAD',
        parsedPrice: 359,
        priceParseStatus: 'verified',
      },
    ],
    priceFromText: 'CAD 359',
    parsedPriceFrom: 359,
    parsedCurrency: 'CAD',
    bookingUrl: 'https://bxsearch.ielts.idp.com/wizard',
    isPublishable: true,
    confidence: 0.9,
    sources: [
      {
        source: 'IELTS.org',
        externalSlug: over.id,
        url: `https://ielts.org/test-centres/${over.id}`,
        seenAt: generatedAt,
        stillPresent: true,
      },
    ],
    firstSeenAt: generatedAt,
    lastSeenAt: generatedAt,
    ...over,
  };
}

function dataset(centres: Centre[]): CentreDataset {
  return {
    version: 3,
    country: 'ALL',
    generatedAt,
    stats: {
      sitemapSlugs: centres.length,
      pagesParsed: centres.length,
      matchedCountry: centres.length,
      afterDedup: centres.length,
      publishable: centres.filter((item) => item.isPublishable).length,
      byOperator: {},
      byGeoPrecision: {},
      ungeocoded: 0,
    },
    centres,
  };
}

function analyse(
  centres: Centre[],
  previous: CentreDataset | null = null,
  pendingLinks: MergeLink[] = [],
  parseFailures: { slug: string; error: string }[] = [],
  previousParseFailures: { slug: string; error: string }[] = [],
) {
  return analyseCentreQuality(centres, {
    previous,
    pendingLinks,
    parseFailures,
    previousParseFailures,
    generatedAt,
    country: 'ALL',
  });
}

test('a healthy newly discovered centre is accepted automatically', () => {
  const run = analyse([centre({ id: 'new-centre' })]);
  assert.equal(run.report.summary.newCentres, 1);
  assert.equal(run.report.summary.readyNewCentres, 1);
  assert.equal(run.analyses[0]?.decision, 'ready');
  assert.equal(run.analyses[0]?.publishableAfter, true);
  assert.deepEqual(run.analyses[0]?.issues, []);
});

test('an explicitly OSR-only discovery is not quarantined for missing offerings or price', () => {
  const run = analyse([
    centre({
      id: 'osr-only',
      offerings: [],
      formats: [],
      priceFromText: null,
      parsedPriceFrom: null,
      parsedCurrency: null,
      bookingUrl: null,
      offersOneSkillRetake: true,
      oneSkillRetakeOnly: true,
      isPublishable: true,
    }),
  ]);
  assert.equal(run.analyses[0]?.decision, 'ready');
  assert.deepEqual(
    run.analyses[0]?.issues.map((issue) => issue.code),
    ['osr_only_centre'],
  );
});

test('source price text survives an unparsed derived value', () => {
  const item = centre({ id: 'unparsed' });
  item.offerings[0] = {
    ...item.offerings[0]!,
    priceText: 'Fee available locally',
    parsedCurrency: null,
    parsedPrice: null,
    priceParseStatus: 'unparsed',
  };

  const run = analyse([item]);
  assert.equal(item.offerings[0]?.priceText, 'Fee available locally');
  assert.equal(run.analyses[0]?.decision, 'needs_review');
  assert.equal(run.analyses[0]?.publishableAfter, true);
  assert.ok(
    run.analyses[0]?.issues.some((issue) => issue.code === 'unparsed_price'),
  );
});

test('a new centre without offerings or prices is quarantined', () => {
  const item = centre({
    id: 'empty',
    offerings: [],
    formats: [],
    priceFromText: null,
    parsedPriceFrom: null,
    parsedCurrency: null,
  });

  const run = analyse([item]);
  assert.equal(run.analyses[0]?.decision, 'quarantined');
  assert.equal(item.isPublishable, false);
  assert.equal(run.report.summary.quarantinedNewCentres, 1);
  assert.deepEqual(
    run.analyses[0]?.issues
      .filter((issue) => issue.action === 'quarantine_centre')
      .map((issue) => issue.code),
    ['no_offerings', 'no_published_price'],
  );
});

test('a falsely verified one-path coordinate is downgraded and cannot pin', () => {
  const item = centre({ id: 'unsafe-location' });
  item.geo = {
    ...item.geo!,
    evidencePaths: ['address'],
    agreementKm: null,
  };

  const run = analyse([item]);
  assert.equal(item.geo?.verification, 'conflicted');
  assert.equal(item.geo?.precision, 'approximate');
  assert.equal(run.analyses[0]?.signals.location.pinnable, false);
  assert.ok(
    run.analyses[0]?.issues.some(
      (issue) => issue.code === 'location_not_independently_corroborated',
    ),
  );
});

test('new failed slugs are quarantined while new duplicate pages are explained', () => {
  const existing = centre({ id: 'existing' });
  const next = centre({
    id: 'existing',
    sources: [
      ...existing.sources,
      {
        source: 'IELTS.org',
        externalSlug: 'existing-2',
        url: 'https://ielts.org/test-centres/existing-2',
        seenAt: generatedAt,
        stillPresent: true,
      },
    ],
  });
  const run = analyse(
    [next],
    dataset([existing]),
    [],
    [{ slug: 'broken-new-centre', error: 'parse: no title' }],
  );

  assert.equal(run.report.summary.newCentres, 0);
  assert.equal(run.report.summary.newSourcePages, 2);
  assert.equal(run.report.summary.quarantinedNewCentres, 1);
  assert.deepEqual(run.report.discovery.mergedIntoExistingCentres, [
    {
      slug: 'existing-2',
      centreId: 'existing',
      centreName: 'Healthy IELTS Centre',
    },
  ]);
  assert.match(renderQualityReport(run.report), /broken-new-centre/);
  assert.match(renderQualityReport(run.report), /safely merged/);
});

test('a failure of a previously known source page is called out as a write blocker', () => {
  const existing = centre({ id: 'existing' });
  const run = analyse(
    [],
    dataset([existing]),
    [],
    [{ slug: 'existing', error: 'fetch failed' }],
  );

  assert.equal(run.report.summary.failedPreviouslyKnownSourcePages, 1);
  assert.match(renderQualityReport(run.report), /dataset writing is blocked/);
});

test('a repeatedly failing never-parsed source is not announced as new every week', () => {
  const failure = { slug: 'stale-sitemap-page', error: 'fetch failed' };
  const run = analyse([], dataset([]), [], [failure], [failure]);

  assert.equal(run.report.summary.unresolvedNewSourcePages, 0);
  assert.equal(run.report.summary.ongoingUnresolvedSourcePages, 1);
  assert.equal(run.report.summary.quarantinedNewCentres, 0);
  assert.match(renderQualityReport(run.report), /not counted as new discoveries/);
});

test('unresolved discoveries persist until a later run resolves them', () => {
  const failure = { slug: 'new-unparseable-centre', error: 'no centre title' };
  const firstRun = analyse([], dataset([]), [], [failure]);
  const firstState = nextQualityState(firstRun.report, null);

  assert.deepEqual(firstState, {
    version: 1,
    unresolvedSourceSlugs: ['new-unparseable-centre'],
  });
  assert.equal(qualityStateChanged(null, firstState), true);

  const secondRun = analyse(
    [],
    dataset([]),
    [],
    [failure],
    firstState?.unresolvedSourceSlugs.map((slug) => ({
      slug,
      error: 'unresolved in a previous run',
    })),
  );
  const secondState = nextQualityState(secondRun.report, firstState);

  assert.equal(secondRun.report.summary.unresolvedNewSourcePages, 0);
  assert.equal(secondRun.report.summary.ongoingUnresolvedSourcePages, 1);
  assert.equal(qualityStateChanged(firstState, secondState), false);

  const resolvedRun = analyse(
    [centre({ id: 'new-unparseable-centre' })],
    dataset([]),
    [],
    [],
    [failure],
  );
  const resolvedState = nextQualityState(resolvedRun.report, secondState);

  assert.deepEqual(resolvedState, {
    version: 1,
    unresolvedSourceSlugs: [],
  });
  assert.equal(qualityStateChanged(secondState, resolvedState), true);
});
