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
  RESOLVE_CONCURRENCY,
} from './config.ts';
import { fetchText, mapWithConcurrency } from './fetcher.ts';
import { readSitemap } from './sitemap.ts';
import { ParseError, parseCentrePage } from './parse.ts';
import { fetchCountryIndex } from './country-index.ts';
import { GeocodeCache } from './geocode.ts';
import { clusterId, resolveCluster } from './resolve.ts';
import {
  diffDatasets,
  renderDiff,
  summariseDiff,
  type DatasetDiff,
} from './diff.ts';

interface Options {
  /** ISO code, or 'ALL' to keep every country the master lists. */
  country: string;
  force: boolean;
  limit: number | null;
  /** Skip geocoding and keep only page-embedded coordinates. */
  noGeocode: boolean;
  /** Write a dedup audit file alongside the dataset. */
  audit: boolean;
  /** Ceiling on billable Google requests for this run. */
  googleBudget: number;
  /** Re-resolve locations even for centres whose address has not changed. */
  regeocode: boolean;
  /** Skip fetching IELTS.org's own country listing; use inference alone. */
  noCountryIndex: boolean;
  /** Try Google before Nominatim — for a deliberate one-time backfill. */
  googleFirst: boolean;
}

/**
 * Deliberately finite by default. A run that suddenly needs thousands of
 * lookups is far more likely to be a parser regression than a real change, and
 * the ceiling turns that into a degraded dataset rather than a surprise bill.
 */
const DEFAULT_GOOGLE_BUDGET = 500;

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    country: 'CA',
    force: false,
    limit: null,
    noGeocode: false,
    audit: true,
    googleBudget: DEFAULT_GOOGLE_BUDGET,
    regeocode: false,
    noCountryIndex: false,
    googleFirst: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--country') opts.country = (argv[++i] ?? 'CA').toUpperCase();
    else if (arg === '--all') opts.country = 'ALL';
    else if (arg === '--force') opts.force = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--no-geocode') opts.noGeocode = true;
    else if (arg === '--no-audit') opts.audit = false;
    else if (arg === '--google-budget') opts.googleBudget = Number(argv[++i]);
    else if (arg === '--regeocode') opts.regeocode = true;
    else if (arg === '--no-country-index') opts.noCountryIndex = true;
    else if (arg === '--google-first') opts.googleFirst = true;
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

  --country <ISO>       Country to filter to (default: CA)
  --all                 Keep every country the master lists
  --limit <n>           Only crawl the first n slugs (for a quick smoke run)
  --force               Ignore the HTML cache and refetch every page
  --no-geocode          Page-embedded coordinates only; no geocoder at all
  --google-budget <n>   Max billable Google calls this run (default: 500)
  --regeocode           Re-resolve even unchanged addresses (costs money)
  --google-first        Try Google before Nominatim (fast one-time backfill)
  --no-country-index    Skip IELTS.org's own country listing; infer only
  --no-audit            Don't write the dedup audit file
  -h, --help            Show this help

Raw pages are cached in .cache/ (gitignored) so local re-runs are fast and cost
the source nothing; pass --force to see the site as it is now. Geocode results
are cached in data/geocode-cache.json, which IS committed — it is what stops a
scheduled run re-billing every address on a fresh checkout.

Country comes primarily from IELTS.org's own /test-centres?country=<alpha3>
listing (stated fact, not inferred), which is fetched once per run and cached
under .cache/listings/. Address parsing, the booking link's country=, and the
phone's dialling code are the fallback for the rare slug that listing omits.

The run ends by diffing against the committed dataset and only rewrites it when
something a reader would care about moved. Timestamps alone never count.`;

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

  if (!opts.noCountryIndex) {
    console.log(`\n▸ Reading IELTS.org's own country listing`);
    const index = await fetchCountryIndex(opts.force);
    console.log(
      `  ${index.stats.countries} countries, ${index.stats.slugs} centres attributed` +
        (index.stats.unmappedCodes.length
          ? ` (${index.stats.unmappedCodes.length} territory codes skipped: ${index.stats.unmappedCodes.join(', ')})`
          : ''),
    );

    // Authoritative when it has an answer — the operator's own filing, not an
    // inference from address, currency or phone. Address parsing, the booking
    // link and the phone prefix remain the fallback for whatever this listing
    // does not cover (a slug added between the two fetches, a naming mismatch).
    let fromIndex = 0;
    for (const centre of parsed) {
      const known = index.bySlug.get(centre.slug);
      if (known && known !== centre.address.country) {
        centre.address.country = known;
        fromIndex++;
      } else if (known) {
        fromIndex++;
      }
    }
    console.log(`  ${fromIndex}/${parsed.length} centres matched to a country this way`);
  }

  const global = opts.country === 'ALL';
  console.log(`\n▸ ${global ? 'Keeping every country' : `Filtering to ${opts.country}`}`);
  const inCountry = global ? parsed : parsed.filter((c) => c.address.country === opts.country);
  console.log(`  ${inCountry.length} centres`);
  if (global) {
    const known = inCountry.filter((c) => c.address.country).length;
    console.log(
      `  country identified for ${known}/${inCountry.length} (${Math.round((known / inCountry.length) * 100)}%)`,
    );
  }
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

  const outFile = path.join(DATA_DIR, `centres.${opts.country.toLowerCase()}.json`);
  const previous = await readPrevious(outFile);
  // Keyed by centre id so an already-resolved address needs no lookup at all.
  const priorById = new Map((previous?.centres ?? []).map((c) => [c.id, c]));

  console.log(`\n▸ Resolving locations${opts.noGeocode ? ' (embedded only)' : ''}`);
  const cache = new GeocodeCache({
    disabled: opts.noGeocode,
    googleBudget: opts.googleBudget,
  });
  await cache.load();
  const embedded = clusters.filter((c) => c.some((p) => p.embeddedGeo)).length;
  console.log(
    `  ${embedded} from page embeds, ${clusters.length - embedded} may need lookup` +
      (opts.regeocode ? ' (forced re-geocode)' : '') +
      (opts.googleFirst ? ' (Google first)' : '') +
      `; Google budget ${opts.googleBudget}`,
  );

  // Concurrent, not sequential: resolving one centre at a time made per-call
  // network latency (Google measured ~0.9s round-trip) additive across the
  // whole run. mapWithConcurrency preserves output order despite the
  // out-of-order completion, and cache/budget state stays correct under this
  // (see RESOLVE_CONCURRENCY's doc).
  const centres = await mapWithConcurrency(
    clusters,
    RESOLVE_CONCURRENCY,
    (cluster) => {
      const id = clusterId(cluster);
      return resolveCluster(cluster, cache, {
        previous: id ? priorById.get(id) : undefined,
        regeocode: opts.regeocode,
        preferGoogle: opts.googleFirst,
      });
    },
    (done, total) => {
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r  ${done}/${total} resolved`);
      }
    },
  );
  process.stdout.write('\n');
  await cache.save();
  console.log(
    `  geocoder: ${cache.stats.googleCalls} Google, ${cache.stats.nominatimCalls} Nominatim, ` +
      `${cache.stats.cacheHits} cached` +
      (cache.stats.budgetSkips ? `, ${cache.stats.budgetSkips} skipped over budget` : ''),
  );

  centres.sort((a, b) => a.name.localeCompare(b.name));

  // `firstSeenAt` means what it says: carry it forward rather than stamping
  // "now" on every run, which would make the freshness signal meaningless.
  const firstSeen = new Map((previous?.centres ?? []).map((c) => [c.id, c.firstSeenAt]));
  for (const centre of centres) {
    const original = firstSeen.get(centre.id);
    if (original) centre.firstSeenAt = original;
  }

  const stats = buildStats(sitemap.slugs.length, parsed.length, inCountry.length, centres);
  const dataset: CentreDataset = {
    version: 1,
    country: opts.country,
    generatedAt: new Date().toISOString(),
    stats,
    centres,
  };

  console.log(`\n▸ Comparing against the committed dataset`);
  const diff = diffDatasets(previous, dataset);
  console.log(`  ${summariseDiff(diff)} (${diff.unchanged} unchanged)`);
  for (const c of diff.added.slice(0, 15)) console.log(`    + ${c.name}`);
  for (const c of diff.removed.slice(0, 15)) console.log(`    - ${c.name}`);
  for (const c of diff.changed.slice(0, 15)) console.log(`    ~ ${c.name} (${c.fields.join(', ')})`);

  await reportToCi(diff);

  // Writing an unchanged dataset would still churn `generatedAt` and every
  // `lastSeenAt`, producing a commit a night that says nothing. Skip it, so
  // `generatedAt` reads as "when the data last actually moved".
  if (!diff.meaningful && previous) {
    console.log(`\n▸ No meaningful change — leaving ${path.basename(outFile)} untouched`);
    printSummary(stats);
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    return;
  }

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

async function readPrevious(file: string): Promise<CentreDataset | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as CentreDataset;
  } catch {
    return null;
  }
}

/**
 * Hand the result to GitHub Actions when running there: `changed` gates the
 * commit step, `summary` becomes the commit subject, and the detail lands on
 * the job summary page. Outside CI these variables are unset and this is a
 * no-op.
 */
async function reportToCi(diff: DatasetDiff): Promise<void> {
  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;

  if (GITHUB_OUTPUT) {
    await fs.appendFile(
      GITHUB_OUTPUT,
      `changed=${diff.meaningful}\nsummary=${summariseDiff(diff)}\n`,
      'utf8',
    );
  }

  if (GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      GITHUB_STEP_SUMMARY,
      `## Centre refresh — ${summariseDiff(diff)}\n\n${renderDiff(diff)}\n`,
      'utf8',
    );
  }
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
