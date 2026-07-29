import type { Centre } from '@ielts-map/core';

const BC_REGISTRATION_HOST = 'ieltsregistration.britishcouncil.org';

export const BC_PILOT_MAX_COUNTRIES_PER_RUN = 8;
export const BC_PILOT_MIN_INTERVAL_MS = 15_000;
export const BC_PILOT_COOLDOWN_MS = 48 * 60 * 60 * 1_000;

export interface BcCountryTarget {
  country: string;
  centreIds: string[];
  externalIds: string[];
}

export type BcPilotFailureKind =
  | 'timeout'
  | 'throttled'
  | 'challenge'
  | 'source_error'
  | 'parse_error';

export type BcPilotOutcome =
  | {
      kind: 'success';
      /**
       * Location ids present in the country-level directory. This is only
       * evidence that registration is listed, never that a date or seat exists.
       */
      listedExternalIds: string[];
    }
  | {
      kind: BcPilotFailureKind;
      detail: string;
    };

export interface BcCountryPilotState {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastOutcome: BcPilotOutcome['kind'];
  listedExternalIds: string[] | null;
}

export interface BcPilotState {
  version: 1;
  nextCountryIndex: number;
  cooldownUntil: string | null;
  consecutiveFailures: number;
  countries: Record<string, BcCountryPilotState>;
}

export interface BcPilotAttempt {
  country: string;
  outcome: BcPilotOutcome;
}

export interface BcPilotRunResult {
  state: BcPilotState;
  attempts: BcPilotAttempt[];
  stoppedBecause:
    | 'budget_exhausted'
    | 'circuit_open'
    | 'provider_failure'
    | 'no_targets';
}

export interface BcPilotRunOptions {
  maxCountries?: number;
  minIntervalMs?: number;
  cooldownMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

type BcCentre = Pick<Centre, 'id' | 'externalId' | 'bookingUrl' | 'address'>;

/**
 * Collapse 729 distinct centre links into a country-level rotation.
 *
 * The public booking flow can enumerate venues after one country selection.
 * We use that only to test whether a centre is still listed; session/date
 * collection remains out of scope for this pilot.
 */
export function buildBcCountryTargets(
  centres: readonly BcCentre[],
): BcCountryTarget[] {
  const countries = new Map<
    string,
    { centreIds: Set<string>; externalIds: Set<string> }
  >();

  for (const centre of centres) {
    if (!isBcRegistrationUrl(centre.bookingUrl)) continue;
    const country = centre.address.country?.trim().toUpperCase();
    if (!country) continue;
    const entry = countries.get(country) ?? {
      centreIds: new Set<string>(),
      externalIds: new Set<string>(),
    };
    entry.centreIds.add(centre.id);
    if (centre.externalId?.trim()) {
      entry.externalIds.add(centre.externalId.trim());
    }
    countries.set(country, entry);
  }

  return [...countries.entries()]
    .map(([country, entry]) => ({
      country,
      centreIds: [...entry.centreIds].sort(),
      externalIds: [...entry.externalIds].sort(),
    }))
    .sort((a, b) => a.country.localeCompare(b.country));
}

export function emptyBcPilotState(): BcPilotState {
  return {
    version: 1,
    nextCountryIndex: 0,
    cooldownUntil: null,
    consecutiveFailures: 0,
    countries: {},
  };
}

/**
 * Run a deliberately small, serial country batch.
 *
 * The caller owns the browser implementation. This coordinator guarantees
 * that the first timeout/throttle/challenge/parser failure stops the run,
 * opens a cooldown and advances the persistent cursor without retrying.
 */
export async function runBcCountryPilot(
  targets: readonly BcCountryTarget[],
  previous: BcPilotState,
  checkCountry: (target: BcCountryTarget) => Promise<BcPilotOutcome>,
  options: BcPilotRunOptions = {},
): Promise<BcPilotRunResult> {
  if (!targets.length) {
    return {
      state: cloneState(previous),
      attempts: [],
      stoppedBecause: 'no_targets',
    };
  }

  const maxCountries = boundedPositiveInteger(
    options.maxCountries ?? BC_PILOT_MAX_COUNTRIES_PER_RUN,
  );
  const minIntervalMs = Math.max(
    0,
    options.minIntervalMs ?? BC_PILOT_MIN_INTERVAL_MS,
  );
  const cooldownMs = Math.max(
    0,
    options.cooldownMs ?? BC_PILOT_COOLDOWN_MS,
  );
  const now = options.now ?? (() => new Date());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const state = normalizeState(previous, targets.length);
  const startedAt = now();

  if (
    state.cooldownUntil &&
    Date.parse(state.cooldownUntil) > startedAt.getTime()
  ) {
    return {
      state,
      attempts: [],
      stoppedBecause: 'circuit_open',
    };
  }

  state.cooldownUntil = null;
  const attempts: BcPilotAttempt[] = [];
  const attemptCount = Math.min(maxCountries, targets.length);

  for (let offset = 0; offset < attemptCount; offset++) {
    if (offset > 0 && minIntervalMs > 0) {
      await sleep(minIntervalMs);
    }

    const index = state.nextCountryIndex % targets.length;
    const target = targets[index]!;
    const attemptedAt = now().toISOString();
    let outcome: BcPilotOutcome;
    try {
      outcome = await checkCountry(target);
    } catch (error) {
      outcome = {
        kind: 'source_error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    attempts.push({ country: target.country, outcome });
    state.nextCountryIndex = (index + 1) % targets.length;

    if (outcome.kind === 'success') {
      const listedExternalIds = uniqueSorted(outcome.listedExternalIds);
      state.countries[target.country] = {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: attemptedAt,
        lastOutcome: outcome.kind,
        listedExternalIds,
      };
      state.consecutiveFailures = 0;
      continue;
    }

    const previousCountry = state.countries[target.country];
    state.countries[target.country] = {
      lastAttemptAt: attemptedAt,
      lastSuccessAt: previousCountry?.lastSuccessAt ?? null,
      lastOutcome: outcome.kind,
      // A failed refresh cannot erase the last good observation.
      listedExternalIds: previousCountry?.listedExternalIds ?? null,
    };
    state.consecutiveFailures += 1;
    state.cooldownUntil = new Date(now().getTime() + cooldownMs).toISOString();
    return {
      state,
      attempts,
      stoppedBecause: 'provider_failure',
    };
  }

  return {
    state,
    attempts,
    stoppedBecause: 'budget_exhausted',
  };
}

function isBcRegistrationUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase() === BC_REGISTRATION_HOST;
  } catch {
    return false;
  }
}

function normalizeState(
  state: BcPilotState,
  targetCount: number,
): BcPilotState {
  const copy = cloneState(state);
  copy.nextCountryIndex =
    Number.isSafeInteger(copy.nextCountryIndex) && copy.nextCountryIndex >= 0
      ? copy.nextCountryIndex % targetCount
      : 0;
  return copy;
}

function cloneState(state: BcPilotState): BcPilotState {
  return {
    ...state,
    countries: Object.fromEntries(
      Object.entries(state.countries).map(([country, value]) => [
        country,
        {
          ...value,
          listedExternalIds: value.listedExternalIds
            ? [...value.listedExternalIds]
            : null,
        },
      ]),
    ),
  };
}

function boundedPositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
