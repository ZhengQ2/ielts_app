#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_DIR, REPO_ROOT } from './config.ts';

const SESSION_SEARCH_URL =
  'https://api.session-search.prod.ielts.com/v2/sessions/search';

async function main(): Promise<void> {
  requireGitHubExperiment();
  const today = new Date();
  const through = new Date(today);
  through.setUTCDate(through.getUTCDate() + 180);
  const requestBody = {
    order: 'A',
    page: 1,
    pageSize: 1_000,
    sortBy: 'TEST_START_DATE',
    fromTestStartDateLocal: isoDate(today),
    toTestStartDateLocal: isoDate(through),
    countryCode: process.env.IDP_GLOBAL_COUNTRY_CODE?.trim() || 'AUS',
    city: process.env.IDP_GLOBAL_CITY?.trim() || 'Melbourne',
  };
  const response = await fetch(SESSION_SEARCH_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent':
        'ielts-map/0.1 availability pilot (+https://github.com/ZhengQ2/ielts_app)',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(45_000),
  });
  const responseText = await response.text();
  const challengeSignals = challengeSignalsFor(responseText);
  const report = {
    version: 1,
    checkedAt: new Date().toISOString(),
    request: {
      url: SESSION_SEARCH_URL,
      body: requestBody,
    },
    response: {
      status: response.status,
      contentType: response.headers.get('content-type'),
      challengeSignals,
      body: parseJson(responseText),
    },
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
    `IDP Global broad query: status=${response.status}, ` +
      `challengeSignals=${challengeSignals.length}`,
  );
  if (!response.ok || challengeSignals.length > 0) {
    throw new Error(
      `IDP Global broad query failed: HTTP ${response.status}, ` +
        `challengeSignals=${challengeSignals.join(', ') || 'none'}`,
    );
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(0, 100_000);
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
