import assert from 'node:assert/strict';
import test from 'node:test';
import {
  draftLocationApproval,
  isPinnable,
  locationConfirmationToken,
  locationReviewIssues,
  needsLocationReview,
  type Geo,
} from '../src/index.ts';

function geo(overrides: Partial<Geo> = {}): Geo {
  return {
    lat: 39.945735,
    lng: 116.463221,
    precision: 'approximate',
    source: 'google',
    coordinateSystem: 'WGS84',
    verification: 'conflicted',
    evidencePaths: ['address', 'venue_name'],
    agreementKm: 0,
    confidence: 0.9,
    ...overrides,
  };
}

test('queues only existing coordinates that fail the confident-point rule', () => {
  assert.equal(needsLocationReview(null), false);
  assert.equal(needsLocationReview(geo()), true);
  assert.equal(
    needsLocationReview(geo({ precision: 'street', verification: 'verified' })),
    false,
  );
});

test('describes every condition preventing a confident point', () => {
  assert.deepEqual(locationReviewIssues(geo({ confidence: 0.3 })), [
    'verification is conflicted',
    'precision is approximate',
    'confidence is 0.30',
  ]);
});

test('draft approval records administrator evidence without laundering provenance', () => {
  const original = geo({
    provenance: {
      origin: 'google_maps_platform',
      displayRights: 'google_maps_only',
      license: 'Google Maps Platform Terms',
      attribution: 'Google Maps',
      sourceRecordId: 'place-1',
    },
  });
  const approved = draftLocationApproval(original, 'rooftop');

  assert.equal(isPinnable(approved), true);
  assert.equal(approved.source, 'google');
  assert.equal(approved.provenance?.origin, 'google_maps_platform');
  assert.deepEqual(approved.evidencePaths, ['address', 'venue_name', 'admin']);
  assert.equal(approved.confidence, 0.9);
  assert.equal(original.verification, 'conflicted');
});

test('confirmation identity changes with either coordinate', () => {
  const original = geo();
  assert.equal(locationConfirmationToken(null), null);
  assert.notEqual(
    locationConfirmationToken(original),
    locationConfirmationToken({ ...original, lat: original.lat + 0.0001 }),
  );
  assert.notEqual(
    locationConfirmationToken(original),
    locationConfirmationToken({ ...original, lng: original.lng + 0.0001 }),
  );
});
