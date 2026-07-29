#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_DIR, REPO_ROOT } from './config.ts';

const SESSION_SEARCH_URL =
  'https://api.session-search.prod.ielts.com/v2/sessions/search';
const COUNTRY_CITY_URL =
  'https://api.session-search.prod.ielts.com/v1/sessions/countryCity' +
  '?languageSkills=LISTENING&languageSkills=READING&languageSkills=WRITING' +
  '&page=0&pageSize=0&testDeliveryFormat=CD&testModules=ACADEMIC' +
  '&testCategory=IELTS';

interface ProbeResponse {
  requestLabel: string;
  status: number;
  contentType: string | null;
  challengeSignals: string[];
  body: unknown;
}

async function main(): Promise<void> {
  requireGitHubExperiment();
  const today = new Date();
  const through = new Date(today);
  through.setUTCDate(through.getUTCDate() + 180);
  const requestBody = {
    order: 'A',
    page: 1,
    // The public search API enforces a maximum of 25. Production collection
    // must page serially rather than attempting one oversized request.
    pageSize: 25,
    sortBy: 'TEST_START_DATE',
    fromTestStartDateLocal: isoDate(today),
    toTestStartDateLocal: isoDate(through),
    countryCode: process.env.IDP_GLOBAL_COUNTRY_CODE?.trim() || 'AUS',
    city: process.env.IDP_GLOBAL_CITY?.trim() || 'Melbourne',
  };
  const countryCity = await requestJson(
    'country-city-academic-computer',
    COUNTRY_CITY_URL,
  );
  assertHealthy(countryCity);
  await delay(2_000);
  const broad = await requestJson('broad-search', SESSION_SEARCH_URL, requestBody);
  assertHealthy(broad);
  const firstLocationId = firstTestLocationId(broad.body);
  const locationFilterAttempts: ProbeResponse[] = [];
  for (const [label, locationFilter] of [
    ['testLocationIds', { testLocationIds: [firstLocationId] }],
    ['testLocations', { testLocations: [firstLocationId] }],
    ['testLocationId', { testLocationId: firstLocationId }],
    ['locationIds', { locationIds: [firstLocationId] }],
  ] as const) {
    await delay(2_000);
    const attempt = await requestJson(
      `location-filter-${label}`,
      SESSION_SEARCH_URL,
      { ...requestBody, ...locationFilter },
    );
    locationFilterAttempts.push(attempt);
    if (attempt.challengeSignals.length > 0) break;
  }
  const report = {
    version: 1,
    checkedAt: new Date().toISOString(),
    request: {
      url: SESSION_SEARCH_URL,
      body: requestBody,
    },
    countryCity,
    broad,
    firstLocationId,
    locationFilterAttempts,
  };
  const reportFile = path.join(REPORT_DIR, 'idp-global-api-probe.json');
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    reportFile,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(`Report: ${path.relative(REPO_ROOT, reportFile)}`);
  console.log(
    `IDP Global broad query: status=${broad.status}, ` +
      `challengeSignals=${broad.challengeSignals.length}, ` +
      `firstLocationId=${firstLocationId}`,
  );
  for (const attempt of locationFilterAttempts) {
    console.log(
      `${attempt.requestLabel}: status=${attempt.status}, ` +
        `totalCount=${totalCount(attempt.body) ?? 'unknown'}, ` +
        `challengeSignals=${attempt.challengeSignals.length}`,
    );
    assertHealthy(attempt);
  }
}

async function requestJson(
  requestLabel: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<ProbeResponse> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      'user-agent':
        'ielts-map/0.1 availability pilot (+https://github.com/ZhengQ2/ielts_app)',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  const responseText = await response.text();
  return {
    requestLabel,
    status: response.status,
    contentType: response.headers.get('content-type'),
    challengeSignals: challengeSignalsFor(responseText),
    body: parseJson(responseText),
  };
}

function assertHealthy(response: ProbeResponse): void {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    response.challengeSignals.length > 0
  ) {
    throw new Error(
      `${response.requestLabel} failed: HTTP ${response.status}, ` +
        `challengeSignals=${response.challengeSignals.join(', ') || 'none'}`,
    );
  }
}

function firstTestLocationId(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('Broad search response was not an object');
  }
  const locations = (body as Record<string, unknown>).testLocations;
  if (!Array.isArray(locations) || locations.length < 1) {
    throw new Error('Broad search response did not contain test locations');
  }
  const id = (locations[0] as Record<string, unknown> | undefined)?.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('First broad-search test location had no id');
  }
  return id;
}

function totalCount(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).totalCount;
  return typeof value === 'number' ? value : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(0, 100_000);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function requireGitHubExperiment(): void {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.M2_7_LIVE_EXPERIMENT !== 'true'
  ) {
    throw new Error(
      'IDP Global API probes may run only in GitHub Actions with M2_7_LIVE_EXPERIMENT=true',
    );
  }
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
