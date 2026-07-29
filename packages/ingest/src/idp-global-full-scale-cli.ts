#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import {
  buildIdpGlobalAvailabilitySnapshot,
  idpGlobalAvailabilitySafetyProblems,
  parseIdpGlobalSearchCapture,
  type IdpGlobalSearchCapture,
} from './idp-global-availability.ts';
import { DATA_DIR, REPORT_DIR, REPO_ROOT } from './config.ts';

const API_HOST = 'api.session-search.prod.ielts.com';
const SESSION_SEARCH_URL = `https://${API_HOST}/v2/sessions/search`;
const COUNTRY_CITY_URL =
  `https://${API_HOST}/v1/sessions/countryCity` +
  '?languageSkills=LISTENING&languageSkills=READING&languageSkills=WRITING' +
  '&page=0&pageSize=0&testDeliveryFormat=CD&testModules=ACADEMIC' +
  '&testCategory=IELTS';
const REPORT_FILE = path.join(
  REPORT_DIR,
  'provider-availability.idp-global.full-scale.json',
);

interface CountryCity {
  countryCode: string;
  countryName: string;
  city: string;
}

interface RequestDiagnostic {
  label: string;
  status: number | null;
  elapsedMs: number;
  challengeSignals: string[];
  error: string | null;
}

class ProviderBoundaryError extends Error {}

async function main(): Promise<void> {
  requireGitHubExperiment();
  const startedAt = new Date().toISOString();
  const intervalMs = minimumInterval(
    process.env.IDP_GLOBAL_MIN_INTERVAL_MS ?? '1500',
  );
  const horizonDays = boundedInteger(
    process.env.IDP_GLOBAL_HORIZON_DAYS ?? '45',
    1,
    365,
    'IDP_GLOBAL_HORIZON_DAYS',
  );
  const request = createSerialRequester(intervalMs);
  const diagnostics: RequestDiagnostic[] = [];
  let report: Record<string, unknown>;

  try {
    const countryCityRaw = await request.getJson(
      'country-city-discovery',
      COUNTRY_CITY_URL,
      diagnostics,
    );
    const discovered = parseCountryCities(countryCityRaw);
    const maxCities = optionalPositiveInteger(
      process.env.IDP_GLOBAL_MAX_CITIES,
      'IDP_GLOBAL_MAX_CITIES',
    );
    const countryCities =
      maxCities === null ? discovered : discovered.slice(0, maxCities);
    const dataset = JSON.parse(
      await fs.readFile(path.join(DATA_DIR, 'centres.all.json'), 'utf8'),
    ) as CentreDataset;
    const captures: IdpGlobalSearchCapture[] = [];
    const discoveredLocationIds = new Set<string>();
    const today = new Date();
    const through = new Date(today);
    through.setUTCDate(through.getUTCDate() + horizonDays);

    for (const [cityIndex, target] of countryCities.entries()) {
      console.log(
        `[${cityIndex + 1}/${countryCities.length}] ` +
          `${target.countryCode} / ${target.city}`,
      );
      const baseBody = {
        order: 'A',
        page: 1,
        pageSize: 25,
        sortBy: 'TEST_START_DATE',
        fromTestStartDateLocal: isoDate(today),
        toTestStartDateLocal: isoDate(through),
        countryCode: target.countryCode,
        city: target.city,
        languageSkills: ['L', 'R', 'W'],
        testDeliveryFormats: ['CD'],
        testCategories: ['IELTS'],
        testModules: ['ACADEMIC'],
      };
      const broadRaw = await request.postJson(
        `city:${target.countryCode}:${target.city}`,
        SESSION_SEARCH_URL,
        baseBody,
        diagnostics,
      );
      const locationIds = parseLocationIds(broadRaw);

      for (const locationId of locationIds) {
        if (discoveredLocationIds.has(locationId)) continue;
        discoveredLocationIds.add(locationId);
        const scopedRaw = await request.postJson(
          `location:${locationId}`,
          SESSION_SEARCH_URL,
          { ...baseBody, testLocationIds: [locationId] },
          diagnostics,
        );
        const capture = parseIdpGlobalSearchCapture(scopedRaw, {
          sourceUrl: SESSION_SEARCH_URL,
          countryCode: target.countryCode,
          countryName: target.countryName,
          city: target.city,
        });
        if (
          capture.locations.length !== 1 ||
          capture.locations[0]?.id !== locationId ||
          capture.sessions.some(
            (session) => session.location.id !== locationId,
          )
        ) {
          throw new ProviderBoundaryError(
            `Location filter ${locationId} returned data for another location`,
          );
        }
        captures.push(capture);
      }
    }

    const checkedAt = new Date().toISOString();
    const snapshot = buildIdpGlobalAvailabilitySnapshot(
      captures,
      dataset.centres,
      checkedAt,
    );
    const problems = idpGlobalAvailabilitySafetyProblems(
      snapshot,
      countryCities.length,
      discoveredLocationIds.size,
    );
    report = {
      version: 1,
      source: 'idp_global',
      startedAt,
      checkedAt,
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      coverage: {
        discovery:
          'All country/city values exposed for standard IELTS Academic on ' +
          'computer; city and venue searches retain that exact offering scope.',
        discoveredCountries: new Set(
          countryCities.map((target) => target.countryCode),
        ).size,
        discoveredCities: discovered.length,
        scannedCities: countryCities.length,
        discoveredLocations: discoveredLocationIds.size,
        scannedLocations: captures.length,
        horizonDays,
        truncatedByEnvironment: maxCities !== null,
      },
      safetyGate: {
        passed: problems.length === 0,
        problems,
        stoppedOnProviderBoundary: false,
      },
      requestSummary: request.summary(),
      requestDiagnostics: diagnostics,
      snapshot,
    };
    await writeReport(report);
    if (problems.length) {
      throw new Error(
        `IDP Global full-scale safety gate failed:\n- ${problems.join('\n- ')}`,
      );
    }
  } catch (cause) {
    const error = errorMessage(cause);
    report = {
      version: 1,
      source: 'idp_global',
      startedAt,
      checkedAt: new Date().toISOString(),
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      safetyGate: {
        passed: false,
        problems: [error],
        stoppedOnProviderBoundary: cause instanceof ProviderBoundaryError,
      },
      requestSummary: request.summary(),
      requestDiagnostics: diagnostics,
    };
    await writeReport(report);
    throw cause;
  }

  console.log(`Report: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
  console.log(
    `IDP Global full-scale scan passed: ${request.summary().successful} ` +
      `serial request(s), no provider boundary detected.`,
  );
}

function createSerialRequester(intervalMs: number) {
  let lastStartedAt = 0;
  let attempted = 0;
  let successful = 0;

  async function json(
    label: string,
    url: string,
    diagnostics: RequestDiagnostic[],
    init?: RequestInit,
  ): Promise<unknown> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== API_HOST) {
      throw new Error(`Refusing unapproved provider URL ${url}`);
    }
    const waitMs = Math.max(0, lastStartedAt + intervalMs - Date.now());
    if (waitMs > 0) await delay(waitMs);
    lastStartedAt = Date.now();
    attempted++;
    const diagnostic: RequestDiagnostic = {
      label,
      status: null,
      elapsedMs: 0,
      challengeSignals: [],
      error: null,
    };
    diagnostics.push(diagnostic);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/json',
          'user-agent':
            'ielts-map/0.1 full-scale availability validation ' +
            '(+https://github.com/ZhengQ2/ielts_app)',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      diagnostic.status = response.status;
      const text = await response.text();
      diagnostic.elapsedMs = Date.now() - started;
      diagnostic.challengeSignals = challengeSignalsFor(text);
      if (
        response.status === 403 ||
        response.status === 429 ||
        diagnostic.challengeSignals.length > 0
      ) {
        throw new ProviderBoundaryError(
          `${label} hit provider boundary: HTTP ${response.status}; ` +
            `${diagnostic.challengeSignals.join(', ') || 'no text signal'}`,
        );
      }
      if (!response.ok) {
        throw new ProviderBoundaryError(`${label} failed with HTTP ${response.status}`);
      }
      const parsedBody = parseJson(text, label);
      successful++;
      return parsedBody;
    } catch (cause) {
      diagnostic.elapsedMs = Date.now() - started;
      diagnostic.error = errorMessage(cause);
      if (cause instanceof ProviderBoundaryError) throw cause;
      throw new ProviderBoundaryError(
        `${label} request failed without retry: ${errorMessage(cause)}`,
      );
    }
  }

  return {
    getJson(
      label: string,
      url: string,
      diagnostics: RequestDiagnostic[],
    ): Promise<unknown> {
      return json(label, url, diagnostics);
    },
    postJson(
      label: string,
      url: string,
      body: Record<string, unknown>,
      diagnostics: RequestDiagnostic[],
    ): Promise<unknown> {
      return json(label, url, diagnostics, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    summary() {
      return { attempted, successful, minimumIntervalMs: intervalMs };
    },
  };
}

function parseCountryCities(value: unknown): CountryCity[] {
  const root = asRecord(value, 'country/city response');
  const countries = asArray(root.countryCities, 'countryCities');
  const result: CountryCity[] = [];
  for (const [countryIndex, rawCountry] of countries.entries()) {
    const country = asRecord(rawCountry, `countryCities[${countryIndex}]`);
    const countryCode = requiredText(
      country.countryCode,
      `countryCities[${countryIndex}].countryCode`,
    );
    const countryName = requiredText(
      country.countryName,
      `countryCities[${countryIndex}].countryName`,
    );
    for (const [cityIndex, rawCity] of asArray(
      country.cities,
      `countryCities[${countryIndex}].cities`,
    ).entries()) {
      const city = asRecord(
        rawCity,
        `countryCities[${countryIndex}].cities[${cityIndex}]`,
      );
      result.push({
        countryCode,
        countryName,
        city: requiredText(
          city.city,
          `countryCities[${countryIndex}].cities[${cityIndex}].city`,
        ),
      });
    }
  }
  if (!result.length) {
    throw new ProviderBoundaryError('Country/city discovery returned no cities');
  }
  return result.sort(
    (a, b) =>
      a.countryCode.localeCompare(b.countryCode) ||
      a.city.localeCompare(b.city),
  );
}

function parseLocationIds(value: unknown): string[] {
  const root = asRecord(value, 'session search response');
  const locations = asArray(root.testLocations, 'testLocations');
  const ids = locations.map((raw, index) =>
    requiredText(
      asRecord(raw, `testLocations[${index}]`).id,
      `testLocations[${index}].id`,
    ),
  );
  return [...new Set(ids)].sort();
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ProviderBoundaryError(`${label} returned non-JSON content`);
  }
}

function challengeSignalsFor(value: string): string[] {
  const patterns = [
    /\bcaptcha\b/i,
    /\brecaptcha\b/i,
    /verify (?:that )?you are human/i,
    /unusual traffic/i,
    /access denied/i,
    /security check/i,
    /temporarily blocked/i,
    /too many requests/i,
  ];
  return patterns
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderBoundaryError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderBoundaryError(`${label} is not an array`);
  }
  return value;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderBoundaryError(`${label} is missing`);
  }
  return value.trim();
}

function minimumInterval(value: string): number {
  const parsed = boundedInteger(
    value,
    1_500,
    60_000,
    'IDP_GLOBAL_MIN_INTERVAL_MS',
  );
  return parsed;
}

function optionalPositiveInteger(
  value: string | undefined,
  label: string,
): number | null {
  if (!value?.trim()) return null;
  return boundedInteger(value, 1, 100_000, label);
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function writeReport(report: unknown): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    REPORT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_LIVE_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'Full-scale provider scans may run only in GitHub Actions with ' +
        'M2_7_LIVE_EXPERIMENT=true',
    );
  }
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
