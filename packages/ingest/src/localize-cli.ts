#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CentreDataset } from '@ielts-map/core';
import {
  CENTRE_OVERRIDES_FILE,
  DATA_DIR,
  DEFAULT_AMAP_REQUEST_BUDGET,
  DEFAULT_MAPPLS_REQUEST_BUDGET,
} from './config.ts';
import { GeocodeCache } from './geocode.ts';
import { localizeCentres } from './localize.ts';
import { applyCentreOverrides, loadCentreOverrides } from './overrides.ts';

const args = process.argv.slice(2);
const refreshAmap = args.includes('--refresh-amap');
const refreshMappls = args.includes('--refresh-mappls');
const requestBudget = (flag: string, fallback: number): number => {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return value;
};
const amapBudget = requestBudget('--amap-budget', DEFAULT_AMAP_REQUEST_BUDGET);
const mapplsBudget = requestBudget('--mappls-budget', DEFAULT_MAPPLS_REQUEST_BUDGET);
const valueFlags = new Set(['--amap-budget', '--mappls-budget']);
const consumedValues = new Set(
  args.flatMap((argument, index) =>
    valueFlags.has(argument) && args[index + 1] ? [index + 1] : [],
  ),
);
const requested =
  args.find((argument, index) => !argument.startsWith('--') && !consumedValues.has(index)) ??
  path.join(DATA_DIR, 'centres.all.json');
const file = path.resolve(requested);
const dataset = JSON.parse(await fs.readFile(file, 'utf8')) as CentreDataset;

const overrides = await loadCentreOverrides(CENTRE_OVERRIDES_FILE);
applyCentreOverrides(dataset.centres, overrides);

if (refreshAmap || refreshMappls) {
  const refreshedSources = new Set<string>([
    ...(refreshAmap ? ['amap' as const] : []),
    ...(refreshMappls ? ['mappls' as const] : []),
  ]);
  for (const centre of dataset.centres) {
    const retained = (centre.localizations ?? []).flatMap((entry) => {
      const next = {
        ...entry,
        name: entry.nameSource && refreshedSources.has(entry.nameSource) ? null : entry.name,
        address:
          entry.addressSource && refreshedSources.has(entry.addressSource) ? null : entry.address,
        nameSource:
          entry.nameSource && refreshedSources.has(entry.nameSource) ? null : entry.nameSource,
        addressSource:
          entry.addressSource && refreshedSources.has(entry.addressSource)
            ? null
            : entry.addressSource,
      };
      return next.name || next.address ? [next] : [];
    });
    if (retained.length) centre.localizations = retained;
    else delete centre.localizations;
  }
}

console.log(`Localizing precise China and India addresses in ${path.relative(process.cwd(), file)}`);
const providerContext = new GeocodeCache({ amapBudget, mapplsBudget });
const stats = await localizeCentres(dataset.centres, {
  providerContext,
  onProgress(done, total) {
    if (done % 25 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
  },
});
process.stdout.write('\n');

if (stats.updated > 0 || refreshAmap || refreshMappls) {
  await fs.writeFile(file, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
}
console.log(
  `  ${stats.updated} added, ${stats.alreadyLocalized} retained, ` +
    `${stats.skippedCoarse} coarse skipped, ${stats.unmatched} uncorroborated, ` +
    `${stats.skippedNoKey} no-key skipped, ${stats.skippedBudget} over-budget skipped, ` +
    `${stats.failed} failed`,
);
console.log(
  `  provider use: ${providerContext.stats.amapCalls}/${amapBudget} AMap requests, ` +
    `${providerContext.stats.mapplsCalls}/${mapplsBudget} Mappls requests`,
);
