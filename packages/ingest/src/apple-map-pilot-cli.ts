#!/usr/bin/env node
import { dataset } from '@ielts-map/core/dataset';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assessAppleSearch,
  selectApplePilotSample,
  wilsonInterval,
  type AppleCentreSearchResult,
} from './apple-map-pilot.ts';
import { REPO_ROOT } from './config.ts';

const execFile = promisify(execFileCallback);
const args = parseArgs(process.argv.slice(2));
const limit = positiveInteger(args.limit ?? '50', '--limit');
const delayMilliseconds = nonnegativeInteger(
  args.delayMs ?? '750',
  '--delay-ms',
);
const artifactDirectory = path.resolve(
  args.artifactDirectory ?? path.join(REPO_ROOT, '.artifacts'),
);
const runtime = args.runtime ?? 'ios-simulator';
if (!['ios-simulator', 'macos'].includes(runtime)) {
  throw new Error('--runtime must be ios-simulator or macos.');
}
const inputFile = path.join(artifactDirectory, 'apple-map-pilot-input.json');
const rawFile = path.join(
  artifactDirectory,
  runtime === 'ios-simulator'
    ? 'apple-map-pilot-raw-ios.json'
    : 'apple-map-pilot-raw-macos.json',
);
const reportFile = path.resolve(
  args.output ?? path.join(artifactDirectory, 'apple-map-pilot.json'),
);

const sample = selectApplePilotSample(dataset.centres, limit);
if (sample.length !== limit) {
  throw new Error(`Requested ${limit} centres but selected ${sample.length}.`);
}
await fs.mkdir(artifactDirectory, { recursive: true });
await fs.writeFile(
  inputFile,
  `${JSON.stringify(
    {
      version: 1,
      delayMilliseconds,
      maximumCandidates: 5,
      records: sample,
    },
    null,
    2,
  )}\n`,
);

process.stderr.write(
  `Querying Apple MapKit on ${runtime} for ${sample.length} diagnostic controls...\n`,
);
if (runtime === 'ios-simulator') {
  await runIosSimulatorSearch();
} else {
  await runMacOSSearch();
}

async function runMacOSSearch(): Promise<void> {
  const swiftSource = path.join(
    REPO_ROOT,
    'packages/ingest/src/apple-map-search.swift',
  );
  const swiftBinary = path.join(artifactDirectory, 'apple-map-search');
  const swiftEnvironment = {
    ...process.env,
    SWIFT_MODULECACHE_PATH: path.join(
      artifactDirectory,
      'swift-module-cache',
    ),
    CLANG_MODULE_CACHE_PATH: path.join(
      artifactDirectory,
      'clang-module-cache',
    ),
  };
  await execFile(
    'xcrun',
    [
      'swiftc',
      '-parse-as-library',
      swiftSource,
      '-o',
      swiftBinary,
    ],
    {
      cwd: REPO_ROOT,
      env: swiftEnvironment,
      maxBuffer: 10_000_000,
    },
  );
  await execFile(
    swiftBinary,
    [
      '--input',
      inputFile,
      '--output',
      rawFile,
      '--delay-ms',
      String(delayMilliseconds),
      '--max-candidates',
      '5',
    ],
    {
      cwd: REPO_ROOT,
      env: swiftEnvironment,
      maxBuffer: 10_000_000,
    },
  );
}

async function runIosSimulatorSearch(): Promise<void> {
  const developerDirectory = '/Applications/Xcode.app/Contents/Developer';
  const environment = {
    ...process.env,
    DEVELOPER_DIR: developerDirectory,
  };
  const deviceList = JSON.parse(
    (
      await execFile(
        'xcrun',
        ['simctl', 'list', 'devices', 'available', '-j'],
        { env: environment, maxBuffer: 10_000_000 },
      )
    ).stdout,
  ) as {
    devices: Record<
      string,
      Array<{ name: string; udid: string; state: string; isAvailable: boolean }>
    >;
  };
  const requestedDevice = args.device ?? 'iPhone 15 Pro';
  const device = Object.values(deviceList.devices)
    .flat()
    .find(
      (candidate) =>
        candidate.isAvailable && candidate.name === requestedDevice,
    );
  if (!device) {
    throw new Error(`No available iOS Simulator named ${requestedDevice}.`);
  }

  const appBundle = path.join(artifactDirectory, 'AppleMapAudit.app');
  const executable = path.join(appBundle, 'AppleMapAudit');
  await fs.rm(appBundle, { recursive: true, force: true });
  await fs.mkdir(appBundle, { recursive: true });
  await Promise.all([
    fs.copyFile(
      path.join(
        REPO_ROOT,
        'packages/ingest/src/AppleMapAudit-Info.plist',
      ),
      path.join(appBundle, 'Info.plist'),
    ),
    fs.copyFile(
      inputFile,
      path.join(appBundle, 'apple-map-pilot-input.json'),
    ),
  ]);

  const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  await execFile(
    'xcrun',
    [
      '--sdk',
      'iphonesimulator',
      'swiftc',
      '-target',
      `${architecture}-apple-ios17.0-simulator`,
      '-parse-as-library',
      path.join(
        REPO_ROOT,
        'packages/ingest/src/apple-map-search-ios.swift',
      ),
      '-o',
      executable,
      '-framework',
      'SwiftUI',
      '-framework',
      'MapKit',
    ],
    { env: environment, maxBuffer: 10_000_000 },
  );
  await execFile(
    'codesign',
    ['--force', '--sign', '-', appBundle],
    { env: environment, maxBuffer: 10_000_000 },
  );

  if (device.state !== 'Booted') {
    await execFile('xcrun', ['simctl', 'boot', device.udid], {
      env: environment,
      maxBuffer: 10_000_000,
    });
  }
  await execFile(
    'xcrun',
    ['simctl', 'bootstatus', device.udid, '-b'],
    { env: environment, maxBuffer: 10_000_000 },
  );
  try {
    await execFile(
      'xcrun',
      [
        'simctl',
        'uninstall',
        device.udid,
        'net.zhengqiu.ielts.apple-map-audit',
      ],
      { env: environment, maxBuffer: 10_000_000 },
    );
  } catch {
    // A clean simulator has no previous audit bundle.
  }
  await execFile(
    'xcrun',
    ['simctl', 'install', device.udid, appBundle],
    { env: environment, maxBuffer: 10_000_000 },
  );
  const container = (
    await execFile(
      'xcrun',
      [
        'simctl',
        'get_app_container',
        device.udid,
        'net.zhengqiu.ielts.apple-map-audit',
        'data',
      ],
      { env: environment, maxBuffer: 10_000_000 },
    )
  ).stdout.trim();
  const simulatorRawFile = path.join(
    container,
    'Documents/apple-map-pilot-raw-ios.json',
  );
  await fs.mkdir(path.dirname(simulatorRawFile), { recursive: true });
  try {
    // Uninstalling keeps the simulator run deterministic, then this restores
    // the portable artifact so fingerprint-matched searches can be reused.
    await fs.copyFile(rawFile, simulatorRawFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await execFile(
    'xcrun',
    [
      'simctl',
      'launch',
      '--console',
      device.udid,
      'net.zhengqiu.ielts.apple-map-audit',
    ],
    { env: environment, maxBuffer: 20_000_000 },
  );
  await fs.copyFile(simulatorRawFile, rawFile);
}

const raw = JSON.parse(await fs.readFile(rawFile, 'utf8')) as {
  version: number;
  generatedAt: string;
  records: AppleCentreSearchResult[];
};
const byId = new Map(raw.records.map((record) => [record.centreId, record]));
const records = sample.map((centre) =>
  assessAppleSearch(centre, byId.get(centre.id)),
);
const exact = records.filter((record) => record.agreement === 'exact').length;
const campus = records.filter((record) => record.agreement === 'campus').length;
const disagrees = records.filter(
  (record) => record.agreement === 'disagrees',
).length;
const noResult = records.filter(
  (record) => record.agreement === 'no_result',
).length;
const searched = records.length - noResult;
const queryAttempts = sample.reduce(
  (count, centre) => count + centre.queries.length,
  0,
);
const queryErrors = records.reduce(
  (count, record) => count + record.transportErrors.length,
  0,
);
const currentRawRecords = sample.flatMap((centre) => {
  const record = byId.get(centre.id);
  return record ? [record] : [];
});
const candidateCount = currentRawRecords.reduce(
  (count, record) =>
    count +
    record.searches.reduce(
      (searchCount, search) => searchCount + search.candidates.length,
      0,
    ),
  0,
);
const outsideCountryCandidates = records.reduce(
  (count, record) => count + record.outsideCountryCandidates,
  0,
);
const invalidEnvironmentReasons: string[] = [];
if (queryErrors / queryAttempts > 0.25) {
  invalidEnvironmentReasons.push('more_than_25_percent_query_errors');
}
if (
  candidateCount > 0 &&
  outsideCountryCandidates / candidateCount > 0.25
) {
  invalidEnvironmentReasons.push(
    'more_than_25_percent_candidates_outside_required_country',
  );
}
const environmentValid = invalidEnvironmentReasons.length === 0;
const summary = {
  status: environmentValid ? 'measured' : 'invalid_environment',
  sampleSize: records.length,
  countries: new Set(records.map((record) => record.centre.country)).size,
  exactAgreement: exact,
  campusAgreement: campus,
  disagreement: disagrees,
  noResult,
  selectionCoverageRate: Number((searched / records.length).toFixed(4)),
  exactCoverageRate: Number((exact / records.length).toFixed(4)),
  usableCoverageRate: Number(
    ((exact + campus) / records.length).toFixed(4),
  ),
  exactCoverage95PercentInterval: wilsonInterval(exact, records.length),
  usableCoverage95PercentInterval: wilsonInterval(
    exact + campus,
    records.length,
  ),
  exactAgreementRate: environmentValid && searched
    ? Number((exact / searched).toFixed(4))
    : null,
  usableAgreementRate: environmentValid && searched
    ? Number(((exact + campus) / searched).toFixed(4))
    : null,
  exactAgreement95PercentInterval: environmentValid
    ? wilsonInterval(exact, searched)
    : null,
  queryAttempts,
  queryErrors,
  candidateCount,
  outsideCountryCandidates,
  invalidEnvironmentReasons,
};
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  methodology: {
    sample:
      'Deterministic controls from each of the 25 largest countries with internally verified street/rooftop coordinates.',
    queries:
      'Canonical venue plus address, canonical address alone, and one reviewed localization where available. Every request is constrained to a coarse, provider-neutral country region.',
    ranking:
      'Apple candidates are ranked without the reference coordinate, using venue name, address, postcode, city and street-number agreement.',
    measurement:
      'The selected Apple result is compared diagnostically with the existing verified control only after ranking. <=250 m is exact agreement; 250-750 m is campus agreement. Coverage rates use the full sample, including no-results.',
    limitation:
      'Provider agreement is not independent ground truth. Disagreements and a stratified set of agreements require human evidence review before launch.',
    environmentGate:
      'Rates fail closed when more than 25% of requests error or more than 25% of candidates fall outside the required country.',
  },
  summary,
  records,
};
await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.stderr.write(`Wrote ${reportFile}\n`);

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --flag value, received ${values.slice(index).join(' ')}`);
    }
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    parsed[key] = value;
  }
  return parsed;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonnegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}
