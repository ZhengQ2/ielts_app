import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centres,
  dataset,
  getCentreById,
  getCentreBySlug,
  omittedFutureLocationCount,
} from '../src/dataset.ts';

const futureLocationIds = [
  'ielts-usa-davenport-ia',
  'ielts-usa-kansas-city-mo',
  'ielts-usa-lincoln-ne',
  'ielts-usa-new-haven-ct',
  'ielts-usa-new-orleans-la',
];

test('operator-declared future locations are absent from every public dataset lookup', () => {
  assert.equal(omittedFutureLocationCount, futureLocationIds.length);
  assert.equal(dataset.centres, centres);
  assert.equal(
    centres.some((centre) => centre.availability?.status === 'future_location'),
    false,
  );

  for (const id of futureLocationIds) {
    assert.equal(getCentreById(id), undefined);
    assert.equal(getCentreBySlug(id), undefined);
  }
});
