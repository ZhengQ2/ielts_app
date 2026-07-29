#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import {
  DATA_DIR,
  REPORT_DIR,
  REPO_ROOT,
} from './config.ts';
import {
  buildIdpIndiaAvailabilitySnapshot,
  idpIndiaAvailabilitySafetyProblems,
} from './idp-india-availability.ts';
import { collectIdpIndiaCapture } from './idp-india-browser.ts';

const reportFile = path.join(
  REPORT_DIR,
  'provider-availability.idp-india.json',
);

async function main(): Promise<void> {
  requireIsolatedExperiment();
  const target = {
    testId: requiredEnv('IDP_INDIA_TEST_ID'),
    moduleLabel: requiredEnv('IDP_INDIA_MODULE_LABEL'),
    cityId: requiredEnv('IDP_INDIA_CITY_ID'),
    testDate: requiredEnv('IDP_INDIA_TEST_DATE'),
  };
  const dataset = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, 'centres.all.json'), 'utf8'),
  ) as CentreDataset;
  const capture = await collectIdpIndiaCapture(target, {
    executablePath: process.env.CHROME_PATH,
  });
  const snapshot = buildIdpIndiaAvailabilitySnapshot(
    [capture],
    dataset.centres,
    new Date().toISOString(),
  );
  const problems = idpIndiaAvailabilitySafetyProblems(null, snapshot);

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    reportFile,
    `${JSON.stringify(
      {
        ...snapshot,
        pilot: {
          livePublicationEnabled: false,
          safetyGate: {
            passed: problems.length === 0,
            problems,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `IDP India pilot: ${snapshot.records.length} session(s), ` +
      `${snapshot.diagnostics.matchedSessions} matched, ` +
      `${snapshot.diagnostics.ambiguousSessions} ambiguous, ` +
      `${snapshot.diagnostics.unmatchedSessions} unmatched`,
  );
  console.log(`Report: ${path.relative(REPO_ROOT, reportFile)}`);
  if (problems.length) {
    throw new Error(
      `IDP India pilot failed safety analysis:\n- ${problems.join('\n- ')}`,
    );
  }
}

function requireIsolatedExperiment(): void {
  if (process.env.M2_7_LIVE_EXPERIMENT !== 'true') {
    throw new Error('Set M2_7_LIVE_EXPERIMENT=true to enable the live pilot');
  }
  if (
    process.env.GITHUB_ACTIONS !== 'true' &&
    process.env.M2_7_ISOLATED_WORKER !== 'true'
  ) {
    throw new Error(
      'The live pilot may run only in GitHub Actions or an explicitly isolated worker',
    );
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
