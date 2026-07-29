#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import {
  DATA_DIR,
  IELTS_USA_NETWORK_URL,
  REPORT_DIR,
  REPO_ROOT,
} from './config.ts';
import { fetchText } from './fetcher.ts';
import {
  availabilitySafetyProblems,
  buildIeltsUsaAvailabilitySnapshot,
  type AvailabilitySnapshot,
} from './ielts-usa-availability.ts';

const snapshotFile = path.join(DATA_DIR, 'availability.all.json');
const datasetFile = path.join(DATA_DIR, 'centres.all.json');
const reportFile = path.join(REPORT_DIR, 'operator-availability.all.json');

async function main(): Promise<void> {
  const dataset = JSON.parse(
    await fs.readFile(datasetFile, 'utf8'),
  ) as CentreDataset;
  const previous = await readPrevious();
  const response = await fetchText(IELTS_USA_NETWORK_URL, { force: true });
  const snapshot = buildIeltsUsaAvailabilitySnapshot(
    response.body,
    dataset.centres,
    new Date().toISOString(),
    IELTS_USA_NETWORK_URL,
  );
  const problems = availabilitySafetyProblems(previous, snapshot);
  const previousUnmatched = new Set(
    previous?.diagnostics.unmatchedCentres.map((centre) => centre.id) ?? [],
  );
  const newlyUnmatchedCentres = snapshot.diagnostics.unmatchedCentres.filter(
    (centre) => !previousUnmatched.has(centre.id),
  ).length;

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    reportFile,
    `${JSON.stringify({ ...snapshot, safetyGate: { passed: !problems.length, problems } }, null, 2)}\n`,
    'utf8',
  );

  console.log(
    `IELTS USA: ${snapshot.diagnostics.matchedCentres} centres matched; ` +
      `${snapshot.diagnostics.sourceRecords.registrationAvailable} registration links, ` +
      `${snapshot.diagnostics.sourceRecords.futureLocations} future, ` +
      `${snapshot.diagnostics.sourceRecords.notAcceptingRegistrations} not accepting`,
  );
  console.log(
    `Unmatched: ${snapshot.diagnostics.unmatchedSourceRecords.length} source records, ` +
      `${snapshot.diagnostics.unmatchedCentres.length} dataset centres`,
  );
  console.log(`Report: ${path.relative(REPO_ROOT, reportFile)}`);

  if (problems.length) {
    throw new Error(
      `Availability snapshot blocked by safety analysis:\n- ${problems.join('\n- ')}`,
    );
  }

  await fs.writeFile(
    snapshotFile,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );
  await reportToCi(snapshot, newlyUnmatchedCentres);
  console.log(`Wrote ${path.relative(REPO_ROOT, snapshotFile)}`);
}

async function readPrevious(): Promise<AvailabilitySnapshot | null> {
  try {
    const value = JSON.parse(
      await fs.readFile(snapshotFile, 'utf8'),
    ) as AvailabilitySnapshot;
    return value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

async function reportToCi(
  snapshot: AvailabilitySnapshot,
  newlyUnmatchedCentres: number,
): Promise<void> {
  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) {
    await fs.appendFile(
      GITHUB_OUTPUT,
      [
        // Unlike ingest's `changed`, this is not a content-diff flag: every
        // successful run stamps a fresh `checkedAt` so operator-verified
        // status keeps resetting its 15-day staleness clock, even when the
        // status itself did not move. `refreshed` records that the snapshot
        // ran, not that its content differs from what is committed.
        'refreshed=true',
        `matched_centres=${snapshot.diagnostics.matchedCentres}`,
        `new_unmatched_centres=${newlyUnmatchedCentres}`,
        `unmatched_centres=${snapshot.diagnostics.unmatchedCentres.length}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
  if (GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      GITHUB_STEP_SUMMARY,
      [
        '## Operator-supported availability',
        '',
        `- IELTS USA centres matched: ${snapshot.diagnostics.matchedCentres}`,
        `- Registration links: ${snapshot.diagnostics.sourceRecords.registrationAvailable}`,
        `- Future locations: ${snapshot.diagnostics.sourceRecords.futureLocations}`,
        `- Explicitly not accepting: ${snapshot.diagnostics.sourceRecords.notAcceptingRegistrations}`,
        `- Unmatched source records: ${snapshot.diagnostics.unmatchedSourceRecords.length}`,
        `- Dataset centres without a supported status: ${snapshot.diagnostics.unmatchedCentres.length}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).stack ?? error}`);
  process.exit(1);
});
