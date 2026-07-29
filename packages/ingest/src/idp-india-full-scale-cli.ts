#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import { DATA_DIR, REPORT_DIR, REPO_ROOT } from './config.ts';
import {
  buildIdpIndiaAvailabilitySnapshot,
  idpIndiaAvailabilitySafetyProblems,
} from './idp-india-availability.ts';
import { collectIdpIndiaFullScale } from './idp-india-browser.ts';

const REPORT_FILE = path.join(
  REPORT_DIR,
  'provider-availability.idp-india.full-scale.json',
);

async function main(): Promise<void> {
  requireGitHubExperiment();
  const startedAt = new Date().toISOString();
  const maximumTargets = optionalPositiveInteger(
    process.env.IDP_INDIA_MAX_TARGETS,
    'IDP_INDIA_MAX_TARGETS',
  );
  let progress = { completed: 0, total: 0, label: '' };
  try {
    const result = await collectIdpIndiaFullScale({
      executablePath: requiredEnv('CHROME_PATH'),
      minimumIntervalMs: boundedInteger(
        process.env.IDP_INDIA_MIN_INTERVAL_MS ?? '3000',
        3_000,
        60_000,
        'IDP_INDIA_MIN_INTERVAL_MS',
      ),
      maximumTargets,
      onProgress(completed, total, label) {
        progress = { completed, total, label };
        console.log(`[${completed}/${total}] ${label}`);
      },
    });
    const dataset = JSON.parse(
      await fs.readFile(path.join(DATA_DIR, 'centres.all.json'), 'utf8'),
    ) as CentreDataset;
    const checkedAt = new Date().toISOString();
    const snapshot = buildIdpIndiaAvailabilitySnapshot(
      result.captures,
      dataset.centres,
      checkedAt,
    );
    const problems = idpIndiaAvailabilitySafetyProblems(null, snapshot);
    const scannedTargets =
      result.captures.length + result.targetsWithoutSessions.length;
    if (scannedTargets !== (maximumTargets ?? result.discoveredTargets.length)) {
      problems.push(
        `scanned ${scannedTargets} of ` +
          `${maximumTargets ?? result.discoveredTargets.length} requested targets`,
      );
    }
    if (
      maximumTargets === null &&
      scannedTargets !== result.discoveredTargets.length
    ) {
      problems.push(
        `full-scale scan covered ${scannedTargets} of ` +
          `${result.discoveredTargets.length} discovered targets`,
      );
    }
    const report = {
      version: 1,
      source: 'idp_india',
      startedAt,
      checkedAt,
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      coverage: {
        discoveredTargets: result.discoveredTargets.length,
        scannedTargets,
        targetsWithSessions: result.captures.length,
        targetsWithoutSessions: result.targetsWithoutSessions.length,
        truncatedByEnvironment: maximumTargets !== null,
      },
      safetyGate: {
        passed: problems.length === 0,
        problems,
        stoppedOnProviderBoundary: false,
      },
      targetsWithoutSessions: result.targetsWithoutSessions,
      snapshot,
    };
    await writeReport(report);
    if (problems.length) {
      throw new Error(
        `IDP India full-scale safety gate failed:\n- ${problems.join('\n- ')}`,
      );
    }
    console.log(`Report: ${path.relative(REPO_ROOT, REPORT_FILE)}`);
    console.log(
      `IDP India full-scale scan passed: ${scannedTargets} public ` +
        `test/module/city target(s), no provider boundary detected.`,
    );
  } catch (cause) {
    const message = errorMessage(cause);
    await writeReport({
      version: 1,
      source: 'idp_india',
      startedAt,
      checkedAt: new Date().toISOString(),
      mode: 'full_scale_github_actions',
      publicationEnabled: false,
      progress,
      safetyGate: {
        passed: false,
        problems: [message],
        stoppedOnProviderBoundary: /provider boundary|captcha|recaptcha/i.test(
          message,
        ),
      },
    });
    throw cause;
  }
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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
