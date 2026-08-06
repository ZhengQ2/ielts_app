import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestOffering } from '@ielts-map/core';
import { resolveOneSkillRetakeStatus } from '../src/resolve.ts';

const academic: TestOffering = {
  label: 'IELTS Academic on computer',
  kind: 'academic',
  format: 'computer_delivered',
  priceText: 'CAD 359',
  parsedCurrency: 'CAD',
  parsedPrice: 359,
  priceParseStatus: 'verified',
};

test('a badge without a format is OSR-only when no full offering exists', () => {
  assert.deepEqual(
    resolveOneSkillRetakeStatus(
      [{ offersOneSkillRetake: true, oneSkillRetakeOnly: true }],
      [],
    ),
    { offersOneSkillRetake: true, oneSkillRetakeOnly: true },
  );
});

test('a merged full-test card prevents an OSR-only classification', () => {
  assert.deepEqual(
    resolveOneSkillRetakeStatus(
      [
        { offersOneSkillRetake: true, oneSkillRetakeOnly: true },
        { offersOneSkillRetake: true, oneSkillRetakeOnly: false },
      ],
      [],
    ),
    { offersOneSkillRetake: true, oneSkillRetakeOnly: false },
  );
});

test('a parsed full IELTS offering prevents an OSR-only classification', () => {
  assert.deepEqual(
    resolveOneSkillRetakeStatus(
      [{ offersOneSkillRetake: true, oneSkillRetakeOnly: true }],
      [academic],
    ),
    { offersOneSkillRetake: true, oneSkillRetakeOnly: false },
  );
});

test('an unavailable country index preserves the previous OSR status', () => {
  assert.deepEqual(
    resolveOneSkillRetakeStatus(
      [{}],
      [],
      { offersOneSkillRetake: true, oneSkillRetakeOnly: true },
    ),
    { offersOneSkillRetake: true, oneSkillRetakeOnly: true },
  );
});
