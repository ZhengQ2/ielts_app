import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre } from '@ielts-map/core';
import {
  availabilitySafetyProblems,
  buildIeltsUsaAvailabilitySnapshot,
  parseIeltsUsaAvailability,
} from '../src/ielts-usa-availability.ts';

const sourceUrl = 'https://go.ieltsusa.org/TestCenterNetwork';
const fixture = `
  <div class="text_block" id="open-list">
    <strong>Arizona</strong><br>
    <a href="https://ieltsregistration.registration-ieltsusa.org/?organization=OxfordIntl_Tucson">
      Phoenix - Oxford International
    </a><br>
    <a href="https://ieltsregistration.registration-ieltsusa.org/?organization=OxfordIntl_Tucson">
      Salt Lake City - Oxford International
    </a><br>
    Miami, TALK, Davie FL (not accepting registrations)
  </div>
  <div class="text_block" id="future-list">
    IELTS USA is considering additional locations.
    Please note there are no scheduled or planned test dates at these potential future locations.
    <a href="https://go.ieltsusa.org/interest/new-haven">New Haven, CT</a>
  </div>
`;

function centre(
  id: string,
  name: string,
  bookingUrl: string,
): Pick<Centre, 'id' | 'name' | 'bookingUrl' | 'operator' | 'address'> {
  return {
    id,
    name,
    bookingUrl,
    operator: 'IELTS USA',
    address: {
      raw: name,
      lines: [name],
      city: null,
      region: null,
      postcode: null,
      country: 'US',
    },
  };
}

test('parses registration, unavailable and future statements separately', () => {
  const parsed = parseIeltsUsaAvailability(fixture);
  assert.equal(parsed.foundRegistrationList, true);
  assert.equal(parsed.foundFutureSection, true);
  assert.deepEqual(
    parsed.records.map(({ status, label }) => ({ status, label })),
    [
      {
        status: 'registration_available',
        label: 'Phoenix - Oxford International',
      },
      {
        status: 'registration_available',
        label: 'Salt Lake City - Oxford International',
      },
      {
        status: 'not_accepting_registrations',
        label: 'Miami, TALK, Davie FL',
      },
      { status: 'future_location', label: 'New Haven, CT' },
    ],
  );
});

test('colliding registration ids are assigned by name and future links win exactly', () => {
  const centres = [
    centre(
      'phoenix',
      'Oxford International Phoenix',
      'https://ieltsregistration.registration-ieltsusa.org/?organisation=OxfordIntl_Tucson',
    ),
    centre(
      'salt-lake',
      'Oxford International Salt Lake City',
      'https://ieltsregistration.registration-ieltsusa.org/?organization=OxfordIntl_Tucson',
    ),
    centre(
      'new-haven',
      'IELTS USA New Haven, CT',
      'https://go.ieltsusa.org/interest/new-haven',
    ),
  ];

  const snapshot = buildIeltsUsaAvailabilitySnapshot(
    fixture,
    centres,
    '2026-07-28T12:00:00.000Z',
    sourceUrl,
  );
  assert.equal(snapshot.records.phoenix?.status, 'registration_available');
  assert.equal(snapshot.records['salt-lake']?.status, 'registration_available');
  assert.equal(snapshot.records['new-haven']?.status, 'future_location');
});

test('source and matching cliffs block a replacement snapshot', () => {
  const centres = [
    centre(
      'phoenix',
      'Oxford International Phoenix',
      'https://ieltsregistration.registration-ieltsusa.org/?organisation=OxfordIntl_Tucson',
    ),
  ];
  const next = buildIeltsUsaAvailabilitySnapshot(
    fixture,
    centres,
    '2026-07-28T12:00:00.000Z',
    sourceUrl,
  );
  const problems = availabilitySafetyProblems(null, next);
  assert.match(problems[0] ?? '', /only 2 .* registration links/i);

  const previous = {
    ...next,
    records: Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `centre-${index}`,
        {
          status: 'registration_available' as const,
          sourceLabel: `Centre ${index}`,
        },
      ]),
    ),
  };
  assert.match(
    availabilitySafetyProblems(previous, next)[1] ?? '',
    /fell from 20 to 1/i,
  );
});
