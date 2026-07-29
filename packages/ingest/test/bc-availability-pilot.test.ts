import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre } from '@ielts-map/core';
import {
  buildBcCountryTargets,
  emptyBcPilotState,
  runBcCountryPilot,
  type BcPilotOutcome,
} from '../src/bc-availability-pilot.ts';

function centre(
  id: string,
  country: string | null,
  externalId: string | null,
  bookingUrl = `https://ieltsregistration.britishcouncil.org/ors/find-test?location=${externalId}`,
): Pick<Centre, 'id' | 'externalId' | 'bookingUrl' | 'address'> {
  return {
    id,
    externalId,
    bookingUrl,
    address: {
      raw: id,
      lines: [id],
      city: null,
      region: null,
      postcode: null,
      country,
    },
  };
}

test('groups British Council centres into a deterministic country rotation', () => {
  const targets = buildBcCountryTargets([
    centre('ca-2', 'ca', '102'),
    centre('ca-1', 'CA', '101'),
    centre('gb-1', 'GB', '201'),
    centre(
      'idp',
      'CA',
      null,
      'https://bxsearch.ielts.idp.com/wizard',
    ),
    centre('missing-country', null, '999'),
  ]);

  assert.deepEqual(targets, [
    {
      country: 'CA',
      centreIds: ['ca-1', 'ca-2'],
      externalIds: ['101', '102'],
    },
    {
      country: 'GB',
      centreIds: ['gb-1'],
      externalIds: ['201'],
    },
  ]);
});

test('runs serially, observes the country budget and advances the cursor', async () => {
  const targets = buildBcCountryTargets([
    centre('ca', 'CA', '101'),
    centre('gb', 'GB', '201'),
    centre('us', 'US', '301'),
  ]);
  const calls: string[] = [];
  const sleeps: number[] = [];

  const result = await runBcCountryPilot(
    targets,
    emptyBcPilotState(),
    async (target): Promise<BcPilotOutcome> => {
      calls.push(target.country);
      return {
        kind: 'success',
        listedExternalIds: [...target.externalIds, ...target.externalIds],
      };
    },
    {
      maxCountries: 2,
      minIntervalMs: 15_000,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    },
  );

  assert.deepEqual(calls, ['CA', 'GB']);
  assert.deepEqual(sleeps, [15_000]);
  assert.equal(result.stoppedBecause, 'budget_exhausted');
  assert.equal(result.state.nextCountryIndex, 2);
  assert.deepEqual(result.state.countries.CA?.listedExternalIds, ['101']);
  assert.equal(result.state.cooldownUntil, null);
});

test('the first provider failure stops the run and opens a cooldown', async () => {
  const targets = buildBcCountryTargets([
    centre('ca', 'CA', '101'),
    centre('gb', 'GB', '201'),
  ]);
  const calls: string[] = [];
  let clock = Date.parse('2026-07-29T12:00:00.000Z');

  const result = await runBcCountryPilot(
    targets,
    emptyBcPilotState(),
    async (target): Promise<BcPilotOutcome> => {
      calls.push(target.country);
      return {
        kind: 'timeout',
        detail: 'booking page did not respond',
      };
    },
    {
      maxCountries: 8,
      minIntervalMs: 0,
      cooldownMs: 48 * 60 * 60 * 1_000,
      now: () => new Date(clock++),
      sleep: async () => undefined,
    },
  );

  assert.deepEqual(calls, ['CA']);
  assert.equal(result.stoppedBecause, 'provider_failure');
  assert.equal(result.state.nextCountryIndex, 1);
  assert.equal(
    result.state.cooldownUntil,
    '2026-07-31T12:00:00.002Z',
  );
});

test('an open circuit makes no provider calls', async () => {
  const state = emptyBcPilotState();
  state.cooldownUntil = '2026-07-31T12:00:00.000Z';
  const targets = buildBcCountryTargets([centre('ca', 'CA', '101')]);
  let calls = 0;

  const result = await runBcCountryPilot(
    targets,
    state,
    async () => {
      calls += 1;
      return { kind: 'success', listedExternalIds: ['101'] };
    },
    {
      now: () => new Date('2026-07-30T12:00:00.000Z'),
      sleep: async () => undefined,
    },
  );

  assert.equal(calls, 0);
  assert.equal(result.stoppedBecause, 'circuit_open');
});

test('a failed refresh retains the last successful country observation', async () => {
  const state = emptyBcPilotState();
  state.countries.CA = {
    lastAttemptAt: '2026-07-28T12:00:00.000Z',
    lastSuccessAt: '2026-07-28T12:00:00.000Z',
    lastOutcome: 'success',
    listedExternalIds: ['101'],
  };
  const targets = buildBcCountryTargets([centre('ca', 'CA', '101')]);

  const result = await runBcCountryPilot(
    targets,
    state,
    async () => ({
      kind: 'challenge',
      detail: 'browser challenge displayed',
    }),
    {
      minIntervalMs: 0,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      sleep: async () => undefined,
    },
  );

  assert.deepEqual(result.state.countries.CA?.listedExternalIds, ['101']);
  assert.equal(
    result.state.countries.CA?.lastSuccessAt,
    '2026-07-28T12:00:00.000Z',
  );
  assert.equal(result.state.countries.CA?.lastOutcome, 'challenge');
});
