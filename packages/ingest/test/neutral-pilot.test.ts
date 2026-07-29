import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import type { Centre } from '@ielts-map/core';
import {
  distinctiveNameTokens,
  matchOvertureCandidate,
  rankOvertureCandidates,
  selectNeutralPilotSample,
} from '../src/neutral-pilot.ts';
import type {
  NeutralPilotCentre,
  OverturePlaceCandidate,
} from '../src/neutral-pilot.ts';

function centre(id: string, country: string, source = 'google'): Centre {
  return {
    id,
    name: `IELTS ${id}`,
    operator: 'unknown',
    operatorSource: 'unknown',
    externalId: null,
    ieltsOrgSlug: id,
    mergedSlugs: [],
    address: {
      raw: `1 ${id} Street`,
      lines: [`1 ${id} Street`],
      city: 'Toronto',
      region: null,
      postcode: 'M5V 2T6',
      country,
    },
    contact: { phones: [], emails: [], websites: [] },
    phone: null,
    geo: {
      lat: 43.65,
      lng: -79.38,
      precision: 'rooftop',
      source: source as 'google',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['address', 'venue_name'],
      agreementKm: 0.01,
      confidence: 0.9,
    },
    googlePlaceId: 'place-id',
    formats: [],
    offerings: [],
    priceFromText: null,
    parsedPriceFrom: null,
    parsedCurrency: null,
    bookingUrl: null,
    isPublishable: true,
    confidence: 0.9,
    sources: [],
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  };
}

test('pilot sample covers the largest strata deterministically', () => {
  const centres = [
    ...Array.from({ length: 4 }, (_, index) => centre(`ca-${index}`, 'CA')),
    ...Array.from({ length: 3 }, (_, index) => centre(`in-${index}`, 'IN')),
    ...Array.from({ length: 2 }, (_, index) => centre(`gb-${index}`, 'GB')),
    centre('open', 'US', 'nominatim'),
  ];
  const first = selectNeutralPilotSample(centres, 6);
  const second = selectNeutralPilotSample(centres, 6);
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first.map((row) => row.country)), new Set(['CA', 'IN', 'GB']));
  assert.equal(first.some((row) => row.id === 'open'), false);
});

test('distinctive tokens discard generic directory words', () => {
  assert.deepEqual(distinctiveNameTokens('AEO IELTS Test Centre Lahore'), [
    'aeo',
    'lahore',
  ]);
});

test('matching venue name and postcode produce a strong candidate', () => {
  const source: NeutralPilotCentre = {
    id: 'aeo-lahore',
    name: 'AEO Lahore (Gulberg)',
    address: '50 C III, Gulberg III, Lahore, Punjab, 54660',
    city: 'Lahore',
    region: 'Punjab',
    postcode: '54660',
    country: 'PK',
    phones: [],
    websites: [],
    restrictedCoordinate: { lat: 31.50619, lng: 74.34548 },
    restrictedSource: 'google_places',
  };
  const candidate: OverturePlaceCandidate = {
    id: 'overture-id',
    name: 'AEO Pakistan',
    address: '50, Block C3 Block C 3 Gulberg III',
    locality: 'Lahore',
    postcode: '54660',
    region: 'Punjab',
    country: 'PK',
    lat: 31.50635,
    lng: 74.34576,
    confidence: 0.89,
    websites: [],
    phones: [],
    sourceLicenses: ['CDLA-Permissive-2.0'],
  };
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.status, 'strong_candidate');
  assert.equal(match.postcodeMatches, true);
  assert.deepEqual(match.evidencePaths, ['venue_name', 'address']);
});

test('a nearby but unrelated place is rejected', () => {
  const source: NeutralPilotCentre = {
    id: 'aeo-lahore',
    name: 'AEO Lahore (Gulberg)',
    address: '50 C III, Gulberg III, Lahore, Punjab, 54660',
    city: 'Lahore',
    region: 'Punjab',
    postcode: '54660',
    country: 'PK',
    phones: [],
    websites: [],
    restrictedCoordinate: { lat: 31.50619, lng: 74.34548 },
    restrictedSource: 'google_places',
  };
  const candidate: OverturePlaceCandidate = {
    id: 'pizza',
    name: "Domino's Pizza",
    address: 'Block 96 B2 MM Alam Road',
    locality: 'Lahore',
    postcode: '54660',
    region: 'Punjab',
    country: 'PK',
    lat: 31.50863,
    lng: 74.35058,
    confidence: 0.99,
    websites: [],
    phones: [],
    sourceLicenses: ['CDLA-Permissive-2.0'],
  };
  assert.equal(matchOvertureCandidate(source, candidate).status, 'no_candidate');
});

test('postcode and city are context, not independent address evidence', () => {
  const source = pilotCentre();
  const candidate = overtureCandidate({
    name: 'Unrelated Language School',
    address: '99 Other Road',
    locality: source.city,
    postcode: source.postcode,
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.evidencePaths.includes('address'), false);
  assert.equal(match.decision, 'reject');
});

test('distance is diagnostic and cannot turn evidence into acceptance', () => {
  const source = pilotCentre();
  const nearby = overtureCandidate({
    id: 'nearby',
    name: 'Completely Unrelated Shop',
    address: '99 Other Road',
    lat: source.restrictedCoordinate.lat,
    lng: source.restrictedCoordinate.lng,
  });
  const distant = overtureCandidate({
    id: 'distant',
    name: source.name,
    address: source.address,
    locality: source.city,
    postcode: source.postcode,
    lat: 0,
    lng: 0,
  });

  assert.equal(matchOvertureCandidate(source, nearby).decision, 'reject');
  assert.equal(matchOvertureCandidate(source, distant).decision, 'accept');
});

test('same operator at a conflicting street number is rejected explicitly', () => {
  const source = pilotCentre({
    name: 'IDP Education India - Amritsar',
    address: 'SCO-57, Ranjit Avenue, Amritsar, Punjab, 143001',
    city: 'Amritsar',
    postcode: '143001',
    country: 'IN',
  });
  const candidate = overtureCandidate({
    name: 'IDP Education',
    address: 'SCO 54, VK Tower, Ranjit Avenue',
    locality: 'Amritsar',
    postcode: '143001',
    country: 'IN',
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.addressConflict, true);
  assert.equal(match.decision, 'reject');
  assert.deepEqual(match.decisionReasons, [
    'same_operator_different_address',
  ]);
});

test('an institution-level result is retained as a campus review, not an exact point', () => {
  const source = pilotCentre({
    name: 'British Council, Tecnologico de Monterrey - Puebla',
    address: 'Building 2, Street 14, Puebla, 72453',
    city: 'Puebla',
    postcode: '72453',
    country: 'MX',
  });
  const candidate = overtureCandidate({
    name: 'Tecnologico de Monterrey Campus Puebla',
    address: 'Atlixcayotl 5718',
    locality: 'Puebla',
    postcode: '72453',
    country: 'MX',
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.decision, 'review');
  assert.equal(match.recommendedPrecision, 'campus');
  assert.deepEqual(match.decisionReasons, ['campus_level_candidate']);
});

test('a different business in the same named building is not venue-name evidence', () => {
  const source = pilotCentre({
    name: 'British Council, Westminster International Siam MBK',
    address: '4th FL, Zone D MBK Center, Bangkok, 10330',
    city: 'Bangkok',
    postcode: '10330',
    country: 'TH',
  });
  const candidate = overtureCandidate({
    name: 'Royal Boss MBK',
    address: 'MBK Center, 4A-25 4th Floor, Zone A',
    locality: 'Bangkok',
    postcode: '10330',
    country: 'TH',
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.evidencePaths.includes('venue_name'), false);
  assert.equal(match.decision, 'reject');
});

test('a shared generic English-school word is not venue identity', () => {
  const source = pilotCentre({
    name: 'IDP IELTS Malaysia - Global English Centre Kota Kinabalu',
    address: 'Lot 24, Lorong Plaza, Kota Kinabalu, 88400',
    city: 'Kota Kinabalu',
    postcode: '88400',
    country: 'MY',
  });
  const candidate = overtureCandidate({
    name: 'SIB Likas English',
    address: 'Other Road',
    locality: 'Kota Kinabalu',
    postcode: '88400',
    country: 'MY',
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.evidencePaths.includes('venue_name'), false);
  assert.equal(match.decision, 'reject');
});

test('the same organization in a different city is rejected despite a shared website', () => {
  const source = pilotCentre({
    name: 'British Council, Berkeley House Nagoya',
    address: '1-10-19 Marunouchi, Naka-ku, Nagoya, 460-0002',
    city: 'Nagoya',
    postcode: '460-0002',
    country: 'JP',
    websites: ['https://berkeleyhouse.co.jp/ieltstestcentre/'],
  });
  const candidate = overtureCandidate({
    name: 'Berkeley House Language Ctr',
    address: 'Gobancho 5-1',
    locality: 'Chiyoda',
    postcode: '102-0076',
    region: 'Tokyo',
    country: 'JP',
    websites: ['http://berkeleyhouse.co.jp'],
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.addressConflict, true);
  assert.equal(match.contactMatches, true);
  assert.equal(match.decision, 'reject');
});

test('a campus main point cannot replace a published room-level location', () => {
  const source = pilotCentre({
    name: 'Mt. San Antonio College (SAC), Walnut, CA',
    address: '1100 N Grand Ave, Bldg 40, Room 102, Walnut, CA, 91789',
    city: 'Walnut',
    postcode: '91789',
    country: 'US',
    websites: ['https://www.mtsac.edu/sce/ielts/'],
  });
  const candidate = overtureCandidate({
    name: 'Mt. San Antonio College',
    address: '1100 N Grand Ave',
    locality: 'Walnut',
    postcode: '91789',
    country: 'US',
    websites: ['http://www.mtsac.edu'],
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.decision, 'review');
  assert.equal(match.recommendedPrecision, 'campus');
});

test('a different campus service can never become an exact centre point', () => {
  const source = pilotCentre({
    name: 'Mt. San Antonio College (SAC), Walnut, CA',
    address: '1100 N Grand Ave, Bldg 40, Room 102, Walnut, CA, 91789',
    city: 'Walnut',
    postcode: '91789',
    country: 'US',
  });
  const candidate = overtureCandidate({
    name: 'Mt SAC Printing Services',
    address: '1100 N Grand Ave, Building 26',
    locality: 'Walnut',
    postcode: '91789',
    country: 'US',
  });
  const match = matchOvertureCandidate(source, candidate);
  assert.equal(match.decision, 'review');
  assert.equal(match.recommendedPrecision, 'campus');
});

test('ranking retains five rejected alternatives with their reasons', () => {
  const source = pilotCentre();
  const candidates = Array.from({ length: 7 }, (_, index) =>
    overtureCandidate({
      id: `unrelated-${index}`,
      name: `Unrelated Shop ${index}`,
      address: `${90 + index} Other Road`,
    }),
  );
  const ranked = rankOvertureCandidates(source, candidates);
  assert.equal(ranked.length, 5);
  assert.ok(ranked.every((match) => match.decision === 'reject'));
  assert.ok(ranked.every((match) => match.decisionReasons.length > 0));
});

test('the reviewed 50-point pilot remains a complete regression fixture', () => {
  const fixtureUrl = new URL(
    './fixtures/neutral-pilot-review.json',
    import.meta.url,
  );
  const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8')) as {
    sampleSize: number;
    outcomes: Array<{ id: string; review: string }>;
  };
  assert.equal(fixture.sampleSize, 50);
  assert.equal(fixture.outcomes.length, 50);
  assert.equal(new Set(fixture.outcomes.map((row) => row.id)).size, 50);
  assert.equal(
    fixture.outcomes.filter((row) => row.review === 'provisional_exact')
      .length,
    16,
  );
  assert.equal(
    fixture.outcomes.filter((row) => row.review === 'campus_only').length,
    4,
  );
  assert.equal(
    fixture.outcomes.filter((row) => row.review.startsWith('reject_')).length,
    5,
  );
  assert.equal(
    fixture.outcomes.filter((row) => row.review === 'unresolved').length,
    24,
  );
});

function pilotCentre(
  overrides: Partial<NeutralPilotCentre> = {},
): NeutralPilotCentre {
  return {
    id: 'sample-centre',
    name: 'AEO IELTS Test Centre Lahore',
    address: '50 C III, Gulberg III, Lahore, Punjab, 54660',
    city: 'Lahore',
    region: 'Punjab',
    postcode: '54660',
    country: 'PK',
    phones: [],
    websites: [],
    restrictedCoordinate: { lat: 31.50619, lng: 74.34548 },
    restrictedSource: 'google_places',
    ...overrides,
  };
}

function overtureCandidate(
  overrides: Partial<OverturePlaceCandidate> = {},
): OverturePlaceCandidate {
  return {
    id: 'overture-candidate',
    name: 'AEO Pakistan',
    address: '50 C III, Gulberg III',
    locality: 'Lahore',
    postcode: '54660',
    region: 'Punjab',
    country: 'PK',
    lat: 31.50635,
    lng: 74.34576,
    confidence: 0.8,
    websites: [],
    phones: [],
    sourceLicenses: ['CDLA-Permissive-2.0'],
    ...overrides,
  };
}
