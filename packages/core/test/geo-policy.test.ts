import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  centreForMap,
  geoPolicyFor,
  mapExportSummary,
} from '../src/geo-policy.ts';
import type { Centre, Geo, GeoSource } from '../src/types.ts';

function geo(source: GeoSource): Geo {
  return {
    lat: 43.65,
    lng: -79.38,
    precision: 'rooftop',
    source,
    coordinateSystem: 'WGS84',
    verification: 'verified',
    evidencePaths: ['address', 'venue_name'],
    agreementKm: 0.01,
    confidence: 0.9,
  };
}

function centre(source: GeoSource | null): Centre {
  return {
    id: `centre-${source ?? 'missing'}`,
    name: 'Test Centre',
    operator: 'unknown',
    operatorSource: 'unknown',
    externalId: null,
    ieltsOrgSlug: 'test-centre',
    mergedSlugs: [],
    address: {
      raw: '1 Test Street, Toronto',
      lines: ['1 Test Street', 'Toronto'],
      city: 'Toronto',
      region: 'Ontario',
      postcode: null,
      country: 'CA',
    },
    contact: { phones: [], emails: [], websites: [] },
    phone: null,
    geo: source ? geo(source) : null,
    googlePlaceId: source?.startsWith('google') ? 'place-id' : null,
    formats: [],
    offerings: [],
    priceFromText: null,
    parsedPriceFrom: null,
    parsedCurrency: null,
    bookingUrl: null,
    isPublishable: true,
    confidence: 0.8,
    sources: [],
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  };
}

test('Google coordinates render only on Google maps', () => {
  assert.equal(geoPolicyFor(geo('google'), 'google').status, 'displayable');
  assert.equal(geoPolicyFor(geo('google'), 'apple').status, 'suppressed');
  assert.equal(geoPolicyFor(geo('google_places'), 'neutral').status, 'suppressed');
});

test('portable coordinates render on Apple and neutral maps', () => {
  const overture = geo('overture');
  overture.provenance = {
    origin: 'overture_maps',
    displayRights: 'any_basemap',
    license: 'CDLA-Permissive-2.0',
    attribution: 'Overture Maps Foundation',
    sourceRecordId: 'overture-id',
  };
  assert.equal(geoPolicyFor(overture, 'apple').status, 'displayable');
  assert.equal(geoPolicyFor(geo('nominatim'), 'neutral').status, 'displayable');
  assert.equal(geoPolicyFor(geo('admin'), 'apple').status, 'displayable');
});

test('Overture without record-level licence provenance fails closed', () => {
  assert.equal(geoPolicyFor(geo('overture'), 'apple').status, 'suppressed');
});

test('unaudited providers and page embeds fail closed', () => {
  for (const source of [
    'page_embed',
    'amap',
    'amap_places',
    'mapbox',
    'mappls',
    'kakao',
    'naver',
    'crowd',
  ] satisfies GeoSource[]) {
    assert.equal(geoPolicyFor(geo(source), 'apple').status, 'suppressed');
  }
});

test('Apple export removes restricted coordinates and provider identifiers', () => {
  const exported = centreForMap(centre('google_places'), 'apple');
  assert.equal(exported.geo, null);
  assert.equal(exported.geoPolicy.status, 'suppressed');
  assert.equal('googlePlaceId' in exported, false);
});

test('export summary accounts for every record', () => {
  const exported = [
    centreForMap(centre('google'), 'apple'),
    centreForMap(centre('admin'), 'apple'),
    centreForMap(centre(null), 'apple'),
  ];
  assert.deepEqual(mapExportSummary(exported, 'apple'), {
    target: 'apple',
    total: 3,
    displayable: 1,
    suppressed: 1,
    missing: 1,
  });
});
