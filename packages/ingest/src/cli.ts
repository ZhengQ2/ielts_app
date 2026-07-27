#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Centre, CentreDataset, DatasetStats, ParsedCentre } from '@ielts-map/core';
import { dedupe } from '@ielts-map/core';
import {
  CENTRE_URL_PREFIX,
  DATA_DIR,
  FETCH_CONCURRENCY,
  PAGE_CACHE_DIR,
} from './config.ts';
import { fetchText, mapWithConcurrency } from './fetcher.ts';
import { readSitemap } from './sitemap.ts';
import { ParseError, parseCentrePage } from './parse.ts';
import { GeocodeCache } from './geocode.ts';
import { resolveCluster } from './resolve.ts';

interface Options {
  country: string;
  force: boolean;
  limit: number | null;
  /** Skip geocoding and keep only page-embedded coordinates. */
  noGeocode: boolean;
  /** Write a dedup audit file alongside the dataset. */
  audit: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { country: 'CA', force: false, limit: null, noGeocode: false, audit: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--country') opts.country = (argv[++i] ?? 'CA').toUpperCase();
    else if (arg === '--force') opts.force = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--no-geocode') opts.noGeocode = true;
    else if (arg === '--no-audit') opts.audit = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }
  return opts;
}

const HELP = `ielts-ingest — build the centre dataset from the IELTS.org master

Usage: npm run ingest -- [options]

  --country <ISO>   Country to filter to (default: CA)
  --limit <n>       Only crawl the first n slugs (for a quick smoke run)
  --force           Ignore the HTML cache and refetch every page
  --no-geocode      Use page-embedded coordinates only; skip Nominatim
  --no-audit        Don't write the dedup audit file
  -h, --help        Show this help

Raw pages are cached in .cache/ so re-runs are fast and cost the source nothing.`;

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const started = Date.now();

  console.log(`\n▸ Reading sitemap`);
  const sitemap = await readSitemap(opts.force);
  let slugs = sitemap.slugs;
  console.log(`  ${slugs.length} unique centre slugs across ${sitemap.pages.length} pages`);
  if (opts.limit) {
    slugs = slugs.slice(0, opts.limit);
    console.log(`  limited to ${slugs.length}`);
  }

  console.log(`\n▸ Fetching centre pages (concurrency ${FETCH_CONCURRENCY})`);
  const failures: { slug: string; error: string }[] = [];
  const parsed: ParsedCentre[] = [];

  await mapWithConcurrency(
    slugs,
    FETCH_CONCURRENCY,
    async (slug) => {
      try {
        const res = await fetchText(`${CENTRE_URL_PREFIX}${slug}`, {
          cacheDir: PAGE_CACHE_DIR,
          force: opts.force,
        });
        parsed.push(parseCentrePage(slug, res.body, new Date().toISOString()));
      } catch (err) {
        failures.push({
          slug,
          error: err instanceof ParseError ? `parse: ${err.message}` : (err as Error).message,
        });
      }
    },
    (done, total) => {
      if (done % 100 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total} pages`);
      }
    },
  );
  process.stdout.write('\n');
  console.log(`  parsed ${parsed.length}, failed ${failures.length}`);
  if (failures.length) {
    for (const f of failures.slice(0, 10)) console.log(`    ✗ ${f.slug}: ${f.error}`);
    if (failures.length > 10) console.log(`    … and ${failures.length - 10} more`);
  }

  console.log(`\n▸ Filtering to ${opts.country}`);
  const inCountry = parsed.filter((c) => c.address.country === opts.country);
  console.log(`  ${inCountry.length} centres`);
  if (inCountry.length === 0) {
    throw new Error(
      `No centres matched country ${opts.country}. Check address parsing before writing a dataset.`,
    );
  }

  console.log(`\n▸ Deduplicating`);
  const { clusters, links } = dedupe(inCountry);
  console.log(`  ${inCountry.length} pages → ${clusters.length} centres (${links.length} merges)`);
  const byReason = new Map<string, number>();
  for (const l of links) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`    ${reason}: ${n}`);

  console.log(`\n▸ Resolving locations${opts.noGeocode ? ' (embedded only)' : ''}`);
  const cache = new GeocodeCache({ disabled: opts.noGeocode });
  await cache.load();
  const needsGeocode = clusters.filter((c) => !c.some((p) => p.embeddedGeo)).length;
  console.log(`  ${clusters.length - needsGeocode} from page embeds, ${needsGeocode} need lookup`);

  const centres: Centre[] = [];
  for (const [i, cluster] of clusters.entries()) {
    centres.push(await resolveCluster(cluster, cache));
    if ((i + 1) % 25 === 0 || i === clusters.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${clusters.length} resolved`);
    }
  }
  process.stdout.write('\n');
  await cache.save();

  centres.sort((a, b) => a.name.localeCompare(b.name));

  const stats = buildStats(sitemap.slugs.length, parsed.length, inCountry.length, centres);
  const dataset: CentreDataset = {
    version: 1,
    country: opts.country,
    generatedAt: new Date().toISOString(),
    stats,
    centres,
  };

  const outFile = path.join(DATA_DIR, `centres.${opts.country.toLowerCase()}.json`);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(`\n▸ Wrote ${path.relative(process.cwd(), outFile)}`);

  if (opts.audit) {
    const auditFile = path.join(DATA_DIR, `audit.${opts.country.toLowerCase()}.json`);
    await fs.writeFile(
      auditFile,
      `${JSON.stringify(
        {
          generatedAt: dataset.generatedAt,
          // Exact-id and slug-base merges are safe; the fuzzy ones are what a
          // human should spot-check.
          fuzzyMerges: links.filter((l) => l.reason.startsWith('name_')),
          parseFailures: failures,
          ungeocoded: centres.filter((c) => !c.geo).map((c) => ({ id: c.id, name: c.name })),
          lowConfidence: centres
            .filter((c) => c.confidence < 0.5)
            .map((c) => ({ id: c.id, name: c.name, confidence: c.confidence })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`▸ Wrote ${path.relative(process.cwd(), auditFile)}`);
  }

  printSummary(stats);
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

function buildStats(
  sitemapSlugs: number,
  pagesParsed: number,
  matchedCountry: number,
  centres: Centre[],
): DatasetStats {
  const byOperator: Record<string, number> = {};
  const byGeoPrecision: Record<string, number> = {};
  for (const c of centres) {
    byOperator[c.operator] = (byOperator[c.operator] ?? 0) + 1;
    const key = c.geo?.precision ?? 'none';
    byGeoPrecision[key] = (byGeoPrecision[key] ?? 0) + 1;
  }
  return {
    sitemapSlugs,
    pagesParsed,
    matchedCountry,
    afterDedup: centres.length,
    active: centres.filter((c) => c.isActive).length,
    byOperator,
    byGeoPrecision,
    ungeocoded: centres.filter((c) => !c.geo).length,
  };
}

function printSummary(s: DatasetStats): void {
  console.log(`\n  sitemap slugs   ${s.sitemapSlugs}`);
  console.log(`  pages parsed    ${s.pagesParsed}`);
  console.log(`  in country      ${s.matchedCountry}`);
  console.log(`  after dedup     ${s.afterDedup}`);
  console.log(`  active          ${s.active}`);
  console.log(`  by operator     ${JSON.stringify(s.byOperator)}`);
  console.log(`  by geo precision ${JSON.stringify(s.byGeoPrecision)}`);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).stack ?? err}`);
  process.exit(1);
});
