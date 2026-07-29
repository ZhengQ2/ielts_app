import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre } from '@ielts-map/core';
import {
  assessAppleSearch,
  selectApplePilotSample,
  wilsonInterval,
  type ApplePilotCentre,
} from '../src/apple-map-pilot.ts';

const control: ApplePilotCentre = {
  id: 'control',
  name: 'IDP IELTS China Guangzhou Tianhe',
  address:
    '19/F, East Tower, Fortune Plaza, 116 Tiyu East Road, Tianhe District, Guangzhou, Guangdong, 510620',
  city: 'Guangzhou',
  postcode: '510620',
  country: 'CN',
  referenceCoordinate: { lat: 23.1363553, lng: 113.3290018 },
  referenceSource: 'admin',
  searchRegion: {
    centerLatitude: 35,
    centerLongitude: 103,
    latitudeDelta: 35,
    longitudeDelta: 62,
  },
  queries: [],
};

test('Apple candidates are ranked by identity before measuring coordinate agreement', () => {
  const assessed = assessAppleSearch(control, {
    centreId: control.id,
    searches: [
      {
        kind: 'canonical',
        query: control.address,
        error: null,
        candidates: [
          {
            rank: 1,
            name: 'Unrelated Tianhe business',
            address: '383 Tianhe Road, Guangzhou, Guangdong China',
            latitude: 23.134,
            longitude: 113.332,
            phone: null,
            url: null,
          },
          {
            rank: 2,
            name: 'Fortune Plaza East Tower',
            address:
              '116 Tiyu East Road, Tianhe, Guangzhou, Guangdong China',
            latitude: 23.136101,
            longitude: 113.329148,
            phone: null,
            url: null,
          },
        ],
      },
    ],
  });
  assert.equal(assessed.best?.candidate.rank, 2);
  assert.equal(assessed.agreement, 'exact');
});

test('far Apple results are disagreements even when search returned something', () => {
  const assessed = assessAppleSearch(control, {
    centreId: control.id,
    searches: [
      {
        kind: 'canonical',
        query: control.address,
        error: null,
        candidates: [
          {
            rank: 1,
            name: 'Fortune Plaza',
            address: '116 Other Road, Shenzhen, Guangdong China',
            latitude: 22.5431,
            longitude: 114.0579,
            phone: null,
            url: null,
          },
        ],
      },
    ],
  });
  assert.equal(assessed.agreement, 'disagrees');
});

test('Apple candidates outside the required country fail closed', () => {
  const assessed = assessAppleSearch(control, {
    centreId: control.id,
    searches: [
      {
        kind: 'canonical',
        query: control.address,
        error: null,
        candidates: [
          {
            rank: 1,
            name: 'Oxford International Vancouver',
            address: '815 West Hastings Street, Vancouver, Canada',
            latitude: 49.2864,
            longitude: -123.1153,
            phone: null,
            url: null,
          },
        ],
      },
    ],
  });
  assert.equal(assessed.agreement, 'no_result');
  assert.equal(assessed.best, null);
  assert.equal(assessed.outsideCountryCandidates, 1);
});

test('pilot sampling is deterministic and excludes unverified controls', () => {
  const make = (id: string, country: string, verification: string): Centre =>
    ({
      id,
      name: id,
      address: {
        raw: `${id} address`,
        lines: [],
        city: 'City',
        citySource: 'source',
        region: null,
        postcode: '12345',
        country,
      },
      geo: {
        lat: 1,
        lng: 1,
        precision: 'street',
        source: 'google',
        coordinateSystem: 'WGS84',
        verification,
        evidencePaths: ['address', 'venue_name'],
        agreementKm: 0.1,
        confidence: 0.9,
      },
      localizations: [],
    }) as unknown as Centre;
  const centres = [
    make('a', 'CA', 'verified'),
    make('b', 'GB', 'verified'),
    make('c', 'US', 'unverified'),
  ];
  assert.deepEqual(
    selectApplePilotSample(centres, 2).map((centre) => centre.id),
    selectApplePilotSample(centres, 2).map((centre) => centre.id),
  );
  assert.equal(
    selectApplePilotSample(centres, 2).some((centre) => centre.id === 'c'),
    false,
  );
});

test('Wilson interval is bounded and contains the observed proportion', () => {
  const interval = wilsonInterval(40, 50)!;
  assert.ok(interval.low < 0.8);
  assert.ok(interval.high > 0.8);
  assert.ok(interval.low >= 0);
  assert.ok(interval.high <= 1);
});
