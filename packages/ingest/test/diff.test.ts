import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Centre, CentreDataset } from '@ielts-map/core';
import {
  diffDatasets,
  diffSafetyProblems,
  summariseDiff,
} from '../src/diff.ts';

function centre(over: Partial<Centre> & { id: string }): Centre {
  return {
    name: 'Test Centre',
    operator: 'IDP',
    operatorSource: 'booking_domain',
    externalId: null,
    ieltsOrgSlug: over.id,
    mergedSlugs: [],
    address: {
      raw: '1 Main St, Calgary, AB, T2P 0T8',
      lines: ['1 Main St', 'Calgary', 'AB', 'T2P 0T8'],
      city: 'Calgary',
      region: 'AB',
      postcode: 'T2P 0T8',
      country: 'CA',
    },
    contact: { phones: [], emails: [], websites: [] },
    phone: null,
    geo: {
      lat: 51.048,
      lng: -114.077,
      precision: 'rooftop',
      source: 'google',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['address', 'venue_name'],
      agreementKm: 0.05,
      confidence: 1,
    },
    googlePlaceId: 'abc',
    formats: ['computer_delivered'],
    offerings: [
      {
        label: 'IELTS Academic on computer',
        kind: 'academic',
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
        seenAt: '2026-07-01T00:00:00.000Z',
        stillPresent: true,
      },
    ],
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

const wrap = (centres: Centre[], generatedAt = '2026-07-01T00:00:00.000Z'): CentreDataset => ({
  version: 2,
  country: 'CA',
  generatedAt,
  stats: {
    sitemapSlugs: 0,
    pagesParsed: 0,
    matchedCountry: 0,
    afterDedup: centres.length,
    publishable: centres.length,
    byOperator: {},
    byGeoPrecision: {},
    ungeocoded: 0,
  },
  centres,
});

/**
 * The property the whole scheduled job depends on. Every record carries three
 * timestamps that move on every crawl; if those counted as changes, the job
 * would commit every night and the history would be worthless.
 */
test('timestamps moving is not a change', () => {
  const before = wrap([centre({ id: 'a' })]);
  const after = wrap(
    [
      centre({
        id: 'a',
        lastSeenAt: '2026-08-01T00:00:00.000Z',
        firstSeenAt: '2026-08-01T00:00:00.000Z',
        sources: [
          {
            source: 'IELTS.org',
            externalSlug: 'a',
            url: 'https://ielts.org/test-centres/a',
            seenAt: '2026-08-01T00:00:00.000Z',
            stillPresent: true,
          },
        ],
      }),
    ],
    '2026-08-01T00:00:00.000Z',
  );

  const diff = diffDatasets(before, after);
  assert.equal(diff.meaningful, false);
  assert.equal(diff.unchanged, 1);
  assert.equal(summariseDiff(diff), 'No centre changes');
});

test('a price change is reported, with the field named', () => {
  const diff = diffDatasets(
    wrap([centre({ id: 'a' })]),
    wrap([centre({ id: 'a', priceFromText: 'CAD 399', parsedPriceFrom: 399 })]),
  );
  assert.equal(diff.meaningful, true);
  assert.deepEqual(diff.changed[0]?.fields, ['priceText', 'parsedPrice']);
});

test('a new centre is an addition, a vanished one a removal', () => {
  const diff = diffDatasets(wrap([centre({ id: 'a' })]), wrap([centre({ id: 'b' })]));
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.added[0]?.id, 'b');
  assert.equal(diff.removed[0]?.id, 'a');
});

test('a centre moving is reported', () => {
  const moved = centre({ id: 'a' });
  moved.geo = { ...moved.geo!, lat: 45.5, lng: -73.6 };
  const diff = diffDatasets(wrap([centre({ id: 'a' })]), wrap([moved]));
  assert.deepEqual(diff.changed[0]?.fields, ['location']);
});

test('sub-metre coordinate jitter is not a move', () => {
  const jittered = centre({ id: 'a' });
  jittered.geo = { ...jittered.geo!, lat: 51.0480000004 };
  assert.equal(diffDatasets(wrap([centre({ id: 'a' })]), wrap([jittered])).meaningful, false);
});

test('a centre becoming unpublishable is reported', () => {
  const diff = diffDatasets(
    wrap([centre({ id: 'a' })]),
    wrap([centre({ id: 'a', isPublishable: false })]),
  );
  assert.deepEqual(diff.changed[0]?.fields, ['isPublishable']);
});

test('the first run has no previous dataset and is all additions', () => {
  const diff = diffDatasets(null, wrap([centre({ id: 'a' }), centre({ id: 'b' })]));
  assert.equal(diff.added.length, 2);
  assert.equal(diff.meaningful, true);
});

test('ordinary additions remain automatic while systemic churn is blocked', () => {
  const ordinary = {
    added: Array.from({ length: 20 }, (_, index) => ({
      id: `new-${index}`,
      name: `New ${index}`,
      city: null,
    })),
    removed: [],
    changed: [],
    unchanged: 980,
    meaningful: true,
  };
  assert.deepEqual(diffSafetyProblems(ordinary, 1000), []);

  const suspicious = {
    ...ordinary,
    added: Array.from({ length: 101 }, (_, index) => ({
      id: `new-${index}`,
      name: `New ${index}`,
      city: null,
    })),
    removed: Array.from({ length: 51 }, (_, index) => ({
      id: `old-${index}`,
      name: `Old ${index}`,
      city: null,
    })),
  };
  assert.deepEqual(diffSafetyProblems(suspicious, 1000), [
    '51 removals exceed the automatic limit of 50',
    '101 additions exceed the automatic limit of 100',
  ]);
});

test('the first complete import is not mistaken for a change cliff', () => {
  const initial = {
    added: Array.from({ length: 1500 }, (_, index) => ({
      id: `new-${index}`,
      name: `New ${index}`,
      city: null,
    })),
    removed: [],
    changed: [],
    unchanged: 0,
    meaningful: true,
  };
  assert.deepEqual(diffSafetyProblems(initial, 0), []);
});
