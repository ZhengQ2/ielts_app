import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre } from '@ielts-map/core';
import { applyCentreOverrides, type CentreOverride } from '../src/overrides.ts';

function centre(): Centre {
  return {
    id: 'example-centre',
    name: 'Example Centre',
    operator: 'IDP',
    operatorSource: 'booking_domain',
    externalId: null,
    ieltsOrgSlug: 'example-centre',
    mergedSlugs: [],
    address: {
      raw: 'Wrong address',
      lines: ['Wrong address'],
      city: 'Wrong city',
      region: null,
      postcode: null,
      country: 'US',
    },
    contact: { phones: [], emails: [], websites: [] },
    phone: null,
    geo: null,
    googlePlaceId: null,
    formats: [],
    offerings: [],
    priceFromText: null,
    parsedPriceFrom: null,
    parsedCurrency: null,
    bookingUrl: null,
    isPublishable: true,
    confidence: 0.5,
    sources: [],
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  };
}

test('reviewed corrections replace only the approved fields', () => {
  const centres = [centre()];
  const overrides: CentreOverride[] = [
    {
      id: 'example-centre',
      reviewedAt: '2026-07-27',
      reason: 'Evidence confirms the source is wrong.',
      evidence: ['https://example.com/evidence'],
      patch: {
        isPublishable: false,
        geo: {
          lat: 43.1,
          lng: -79.1,
          precision: 'rooftop',
          source: 'admin',
          coordinateSystem: 'WGS84',
          verification: 'verified',
          evidencePaths: ['admin'],
          agreementKm: null,
          confidence: 0.95,
        },
      },
    },
  ];

  assert.deepEqual(applyCentreOverrides(centres, overrides), {
    applied: ['example-centre'],
    missing: [],
  });
  assert.equal(centres[0]?.isPublishable, false);
  assert.equal(centres[0]?.geo?.source, 'admin');
  assert.equal(centres[0]?.name, 'Example Centre');
});

test('missing and duplicate override targets are surfaced', () => {
  const centres = [centre()];
  const missing: CentreOverride = {
    id: 'removed-centre',
    reviewedAt: '2026-07-27',
    reason: 'Example',
    evidence: [],
    patch: { isPublishable: false },
  };

  assert.deepEqual(applyCentreOverrides(centres, [missing]), {
    applied: [],
    missing: ['removed-centre'],
  });
  assert.throws(() => applyCentreOverrides(centres, [missing, missing]), /Duplicate/);
});
