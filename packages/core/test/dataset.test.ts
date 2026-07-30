import assert from 'node:assert/strict';
import test from 'node:test';
import {
  centres,
  dataset,
  futureOpeningCount,
  getCentreById,
  getCentreBySlug,
} from '../src/dataset.ts';

const futureLocationIds = [
  'ielts-usa-davenport-ia',
  'ielts-usa-kansas-city-mo',
  'ielts-usa-lincoln-ne',
  'ielts-usa-new-haven-ct',
  'ielts-usa-new-orleans-la',
];

test('operator-declared future openings remain visible with an explicit warning marker', () => {
  assert.equal(futureOpeningCount, futureLocationIds.length);
  assert.equal(dataset.centres, centres);

  for (const id of futureLocationIds) {
    const centre = getCentreById(id);
    assert.ok(centre);
    assert.equal(getCentreBySlug(id), centre);
    assert.equal(centre.isPublishable, false);
    assert.equal(centre.futureOpening?.source, 'ielts_usa_network');
    assert.match(centre.bookingUrl ?? '', /^https:\/\/go\.ieltsusa\.org\//);
  }
});
