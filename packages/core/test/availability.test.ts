import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availabilityGuidance,
  freshAvailability,
  hasPricedOffering,
} from '../src/availability.ts';
import type { CentreAvailability, Operator } from '../src/types.ts';

test('a centre with no available test type is not publishable', () => {
  assert.equal(hasPricedOffering([]), false);
});

test('a centre whose test types are all unpriced is not publishable', () => {
  assert.equal(hasPricedOffering([{ priceText: null }, { priceText: null }]), false);
});

test('one source-published fee makes a centre publishable even when parsing is deferred', () => {
  assert.equal(
    hasPricedOffering([
      { priceText: null },
      { priceText: 'Contact centre for fee' },
      { priceText: 'CAD 325' },
    ]),
    true,
  );
});

const checkedAt = '2026-07-28T12:00:00.000Z';

function centre(
  availability?: CentreAvailability,
  operator: Operator = 'IELTS USA',
) {
  return {
    availability,
    bookingUrl: 'https://example.test/book',
    operator,
  };
}

test('an explicit future-location statement never becomes an open claim', () => {
  const guidance = availabilityGuidance(
    centre({
      status: 'future_location',
      source: 'ielts_usa_network',
      sourceUrl: 'https://go.ieltsusa.org/TestCenterNetwork',
      sourceLabel: 'New Haven, CT',
      checkedAt,
    }),
    new Date('2026-08-01T00:00:00.000Z'),
  );

  assert.equal(guidance.status, 'future_location');
  assert.equal(guidance.operatorVerified, true);
  assert.match(guidance.message, /no scheduled or planned test dates/i);
  assert.match(guidance.actionLabel ?? '', /interest list/i);
});

test('a registration link is presented as a link, not proof of a seat', () => {
  const guidance = availabilityGuidance(
    centre({
      status: 'registration_available',
      source: 'ielts_usa_network',
      sourceUrl: 'https://go.ieltsusa.org/TestCenterNetwork',
      sourceLabel: 'Seattle - Pacific Northwest Testing & Assessment',
      checkedAt,
    }),
    new Date('2026-08-01T00:00:00.000Z'),
  );

  assert.equal(guidance.label, 'Registration link listed');
  assert.match(guidance.message, /still need confirmation/i);
});

test('stale evidence expires to operator-check-required', () => {
  const evidence: CentreAvailability = {
    status: 'not_accepting_registrations',
    source: 'ielts_usa_network',
    sourceUrl: 'https://go.ieltsusa.org/TestCenterNetwork',
    sourceLabel: 'TALK, Davie FL',
    checkedAt,
  };

  assert.equal(
    freshAvailability(evidence, new Date('2026-08-13T12:00:01.000Z')),
    null,
  );
  const guidance = availabilityGuidance(
    centre(evidence, 'IDP'),
    new Date('2026-08-13T12:00:01.000Z'),
  );
  assert.equal(guidance.status, 'operator_check_required');
  assert.match(guidance.actionLabel ?? '', /IDP/);
});

test('small source/client clock skew does not hide fresh evidence', () => {
  const evidence: CentreAvailability = {
    status: 'registration_available',
    source: 'ielts_usa_network',
    sourceUrl: 'https://go.ieltsusa.org/TestCenterNetwork',
    sourceLabel: 'Seattle',
    checkedAt,
  };
  assert.equal(
    freshAvailability(evidence, new Date('2026-07-28T11:55:00.000Z')),
    evidence,
  );
});
