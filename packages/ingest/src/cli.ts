#!/usr/bin/env node --experimental-strip-types
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Centre, CentreDataset, DatasetStats, ParsedCentre } from '@ielts-map/core';
import { dedupe } from '@ielts-map/core';
import {
  CENTRE_URL_PREFIX,
  CENTRE_OVERRIDES_FILE,
  DATA_DIR,
  DEFAULT_AMAP_REQUEST_BUDGET,
  DEFAULT_GOOGLE_REQUEST_BUDGET,
  DEFAULT_MAPPLS_REQUEST_BUDGET,
  FETCH_CONCURRENCY,
  PAGE_CACHE_DIR,
  REPORT_DIR,
  REPO_ROOT,
  RESOLVE_CONCURRENCY,
} from './config.ts';
import { fetchText, mapWithConcurrency } from './fetcher.ts';
import { readSitemap } from './sitemap.ts';
import { ParseError, parseCentrePage } from './parse.ts';
import { fetchCountryIndex } from './country-index.ts';
import { GeocodeCache } from './geocode.ts';
import { clusterId, resolveCluster } from './resolve.ts';
import { applyCentreOverrides, loadCentreOverrides } from './overrides.ts';
import { parseAddress } from './address.ts';
import { localizeCentres } from './localize.ts';
import {
  diffDatasets,
  diffSafetyProblems,
  osrSafetyProblems,
  renderDiff,
  summariseDiff,
  type DatasetDiff,
} from './diff.ts';
import {
  analyseCentreQuality,
  nextQualityState,
  qualityStateChanged,
  renderQualityReport,
  type CentreQualityReport,
  type QualityState,
} from './quality.ts';
import {
  buildQualityBaseline,
  diffQualityBaselines,
  qualityBaselineChanged,
  qualityRegressionProblems,
  renderQualityDelta,
  type QualityBaseline,
  type QualityDelta,
} from './quality-baseline.ts';
import {
  remediateCentres,
  renderRemediationReport,
  type RemediationReport,
} from './remediate.ts';

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
  /** Ceiling on billable AMap requests for this run (geocode + POI search). */
  amapBudget: number;
  /** Ceiling on billable Mappls requests for this run (geocode + Place Details). */
  mapplsBudget: number;
  /** Re-resolve locations even for centres whose address has not changed. */
  regeocode: boolean;
  /** Skip fetching IELTS.org's own country listing; use inference alone. */
  noCountryIndex: boolean;
  /** Try Google before Nominatim — for a deliberate one-time backfill. */
  googleFirst: boolean;
  /** Explicitly accept a systemic-looking addition/removal cliff. */
  allowLargeDiff: boolean;
  /** Explicitly accept a systemic-looking quality regression. */
  allowQualityRegression: boolean;
  /** Run bounded issue-specific repair attempts before the final analysis. */
  remediate: boolean;
  /** Maximum centres whose location/city evidence may be retried per run. */
  remediationLimit: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    country: 'CA',
    force: false,
    limit: null,
    noGeocode: false,
    audit: true,
    googleBudget: DEFAULT_GOOGLE_REQUEST_BUDGET,
    amapBudget: DEFAULT_AMAP_REQUEST_BUDGET,
    mapplsBudget: DEFAULT_MAPPLS_REQUEST_BUDGET,
    regeocode: false,
    noCountryIndex: false,
    googleFirst: false,
    allowLargeDiff: false,
    allowQualityRegression: false,
    remediate: true,
    remediationLimit: 100,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--country') opts.country = (argv[++i] ?? 'CA').toUpperCase();
    else if (arg === '--all') opts.country = 'ALL';
    else if (arg === '--force') opts.force = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--no-geocode') opts.noGeocode = true;
    else if (arg === '--no-audit') opts.audit = false;
    else if (arg === '--google-budget') {
      opts.googleBudget = parseRequestBudget(arg, argv[++i]);
    }
    else if (arg === '--amap-budget') {
      opts.amapBudget = parseRequestBudget(arg, argv[++i]);
    }
    else if (arg === '--mappls-budget') {
      opts.mapplsBudget = parseRequestBudget(arg, argv[++i]);
    }
    else if (arg === '--regeocode') opts.regeocode = true;
    else if (arg === '--no-country-index') opts.noCountryIndex = true;
    else if (arg === '--google-first') opts.googleFirst = true;
    else if (arg === '--allow-large-diff') opts.allowLargeDiff = true;
    else if (arg === '--allow-quality-regression') {
      opts.allowQualityRegression = true;
    }
    else if (arg === '--no-remediate') opts.remediate = false;
    else if (arg === '--remediation-limit') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) {
        console.error('--remediation-limit requires a non-negative integer');
        process.exit(1);
      }
      opts.remediationLimit = value;
    }
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

function parseRequestBudget(flag: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    console.error(`${flag} requires a non-negative integer`);
    process.exit(1);
  }
  return value;
}

const HELP = `ielts-ingest — build the centre dataset from the IELTS.org master

Usage: npm run ingest -- [options]

  --country <ISO>       Country to filter to (default: CA)
  --all                 Keep every country the master lists
  --limit <n>           Only crawl the first n slugs (for a quick smoke run)
  --force               Ignore the HTML cache and refetch every page
  --no-geocode          Page-embedded coordinates only; no geocoder at all
  --google-budget <n>   Max billable Google calls this run (default: 500)
  --amap-budget <n>     Max billable AMap requests this run (default: 300)
  --mappls-budget <n>   Max billable Mappls requests this run (default: 300)
  --regeocode           Re-resolve even unchanged addresses (costs money)
  --google-first        Try Google before Nominatim (fast one-time backfill)
  --no-country-index    Skip IELTS.org's own country listing; infer only
  --no-audit            Don't write the dedup audit file
  --allow-large-diff    Override the systemic-change safety gate
  --allow-quality-regression
                        Override a confirmed systemic quality regression
  --no-remediate        Analyse only; do not attempt location/city repairs
  --remediation-limit n Max centres retried per run (default: 100)
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
  const outFile = path.join(DATA_DIR, `centres.${opts.country.toLowerCase()}.json`);
  const auditFile = path.join(
    DATA_DIR,
    `audit.${opts.country.toLowerCase()}.json`,
  );
  const qualityStateFile = path.join(
    DATA_DIR,
    `quality-state.${opts.country.toLowerCase()}.json`,
  );
  const qualityBaselineFile = path.join(
    DATA_DIR,
    `quality-baseline.${opts.country.toLowerCase()}.json`,
  );
  const previous = await readPrevious(outFile);
  const previousAudit = await readPreviousAudit(auditFile);
  const previousQualityState = await readQualityState(qualityStateFile);
  const previousQualityBaseline = await readQualityBaseline(
    qualityBaselineFile,
    opts.country,
  );

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
    let osrCentres = 0;
    let osrOnlySourcePages = 0;
    for (const centre of parsed) {
      const known = index.bySlug.get(centre.slug);
      if (known) {
        // Country is authoritative here. Re-running the address parser with
        // that context enables dedicated country rules while deliberately
        // disabling the old last-line city guess everywhere else.
        centre.address = parseAddress(centre.address.lines, known);
        centre.offersOneSkillRetake = index.osrSlugs.has(centre.slug);
        centre.oneSkillRetakeOnly = index.osrOnlySlugs.has(centre.slug);
        if (centre.offersOneSkillRetake) osrCentres++;
        if (centre.oneSkillRetakeOnly) osrOnlySourcePages++;
        fromIndex++;
      }
    }
    console.log(`  ${fromIndex}/${parsed.length} centres matched to a country this way`);
    console.log(`  ${osrCentres}/${parsed.length} source pages marked for One Skill Retake`);
    console.log(
      `    ${index.stats.globalOsrSlugs} global IELTS.org badge(s), ` +
        `${index.stats.chinaSupplementalOsrSlugs} official China supplement(s)`,
    );
    console.log(`  ${osrOnlySourcePages}/${parsed.length} source pages marked OSR-only before dedup`);

    // The listing's own dropdown names every country it offers ("Indonesia",
    // not just "ID") — free to keep, since it was already fetched to get the
    // slugs. Persisted once regardless of --country, so a Canada-only run
    // still keeps the UI's country picker readable everywhere it's used.
    const namesFile = path.join(DATA_DIR, 'country-names.json');
    const names = Object.fromEntries([...index.names.entries()].sort());
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(namesFile, `${JSON.stringify(names, null, 2)}\n`, 'utf8');
    console.log(`  Wrote ${path.relative(process.cwd(), namesFile)} (${index.names.size} names)`);
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
  const { clusters, links, pendingLinks } = dedupe(inCountry);
  console.log(
    `  ${inCountry.length} pages → ${clusters.length} centres ` +
      `(${links.length} automatic merges, ${pendingLinks.length} pending proposals)`,
  );
  const byReason = new Map<string, number>();
  for (const l of links) byReason.set(l.reason, (byReason.get(l.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`    ${reason}: ${n}`);

  // Keyed by centre id so an already-resolved address needs no lookup at all.
  const priorById = new Map((previous?.centres ?? []).map((c) => [c.id, c]));

  console.log(`\n▸ Resolving locations${opts.noGeocode ? ' (embedded only)' : ''}`);
  const cache = new GeocodeCache({
    disabled: opts.noGeocode,
    googleBudget: opts.googleBudget,
    amapBudget: opts.amapBudget,
    mapplsBudget: opts.mapplsBudget,
  });
  await cache.load();
  const embedded = clusters.filter((c) => c.some((p) => p.embeddedGeo)).length;
  console.log(
    `  ${embedded} from page embeds, ${clusters.length - embedded} may need lookup` +
      (opts.regeocode ? ' (forced re-geocode)' : '') +
      (opts.googleFirst ? ' (Google first)' : '') +
      `; Google budget ${opts.googleBudget}, AMap budget ${opts.amapBudget}, Mappls budget ${opts.mapplsBudget}`,
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
        reuseLegacyPrior: opts.noGeocode,
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

  console.log(`\n▸ Applying reviewed corrections`);
  const overrides = await loadCentreOverrides(CENTRE_OVERRIDES_FILE);
  const overrideResult = applyCentreOverrides(centres, overrides);
  console.log(`  ${overrideResult.applied.length} applied`);
  for (const id of overrideResult.missing) {
    console.warn(`    ⚠ override target no longer exists: ${id}`);
  }

  const generatedAt = new Date().toISOString();
  const previousParseFailures =
    previousQualityState?.unresolvedSourceSlugs.map((slug) => ({
      slug,
      error: 'unresolved in a previous run',
    })) ??
    previousAudit?.parseFailures ??
    [];
  const qualityOptions = {
    previous,
    pendingLinks,
    parseFailures: failures,
    previousParseFailures,
    generatedAt,
    country: opts.country,
  };

  console.log(`\n▸ Analysing repair candidates`);
  const beforeRemediation = analyseCentreQuality(centres, qualityOptions);
  const remediation = await remediateCentres(centres, {
    analyses: beforeRemediation.analyses,
    clusters,
    cache,
    pendingLinks,
    parseFailures: failures,
    previousUnresolvedSlugs:
      previousQualityState?.unresolvedSourceSlugs ?? [],
    limit: opts.remediationLimit,
    enabled: opts.remediate && !opts.noGeocode && opts.remediationLimit > 0,
  });
  await cache.save();
  console.log(
    `  ${remediation.candidates} eligible; ${remediation.attempted} attempted, ` +
      `${remediation.accepted} accepted, ${remediation.unchanged} unchanged, ` +
      `${remediation.rejected} rejected`,
  );

  // Localizations depend on the final accepted coordinate. Running this after
  // remediation avoids retaining or generating local text for a rejected pin.
  if (!opts.noGeocode) {
    console.log(`\n▸ Adding local-language matching evidence`);
    const localization = await localizeCentres(centres, {
      providerContext: cache,
      onProgress(done, total) {
        if (done % 25 === 0 || done === total) {
          process.stdout.write(`\r  ${done}/${total} checked`);
        }
      },
    });
    process.stdout.write('\n');
    console.log(
      `  ${localization.updated} added, ${localization.alreadyLocalized} retained, ` +
        `${localization.skippedCoarse} coarse skipped, ` +
        `${localization.unmatched} uncorroborated, ` +
        `${localization.skippedNoKey} no-key skipped, ` +
        `${localization.skippedBudget} over-budget skipped, ${localization.failed} failed`,
    );
  }
  console.log(
    `  provider use: ${cache.stats.googleCalls} Google address, ` +
      `${cache.stats.placesCalls} Google Places, ${cache.stats.nominatimCalls} Nominatim, ` +
      `${cache.stats.amapCalls} AMap requests, ${cache.stats.mapplsCalls} Mappls requests, ` +
      `${cache.stats.cacheHits} cached` +
      (cache.stats.budgetSkips ? `, ${cache.stats.budgetSkips} skipped over budget` : ''),
  );

  console.log(`\n▸ Running final automated quality analysis`);
  const quality = analyseCentreQuality(centres, qualityOptions);
  const nextQualityBaseline = buildQualityBaseline(
    quality.analyses,
    quality.report,
  );
  const qualityTrend = diffQualityBaselines(
    previousQualityBaseline,
    nextQualityBaseline,
    quality.analyses,
  );
  const baselineChanged = qualityBaselineChanged(
    previousQualityBaseline,
    nextQualityBaseline,
  );
  const qualityGateProblems = qualityRegressionProblems(
    previousQualityBaseline,
    qualityTrend,
  );
  const qualityFile = path.join(
    REPORT_DIR,
    `centre-quality.${opts.country.toLowerCase()}.json`,
  );
  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(
    qualityFile,
    `${JSON.stringify(
      {
        ...quality.report,
        remediation,
        trend: qualityTrend,
        regressionGate: {
          passed: qualityGateProblems.length === 0,
          problems: qualityGateProblems,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`  ${quality.report.summary.centresAnalysed} centres checked`);
  console.log(
    `  new: ${quality.report.summary.readyNewCentres} ready, ` +
      `${quality.report.summary.newCentresNeedingReview} with warnings, ` +
      `${quality.report.summary.quarantinedNewCentres} quarantined/unresolved`,
  );
  console.log(
    `  trend: ${qualityTrend.summary.newIssues} new existing-centre issue(s), ` +
      `${qualityTrend.summary.resolvedIssues} resolved`,
  );
  console.log(`  report: ${path.relative(REPO_ROOT, qualityFile)}`);

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
    version: 3,
    country: opts.country,
    generatedAt,
    stats,
    centres,
  };

  console.log(`\n▸ Comparing against the committed dataset`);
  const diff = diffDatasets(previous, dataset);
  console.log(`  ${summariseDiff(diff)} (${diff.unchanged} unchanged)`);
  for (const c of diff.added.slice(0, 15)) console.log(`    + ${c.name}`);
  for (const c of diff.removed.slice(0, 15)) console.log(`    - ${c.name}`);
  for (const c of diff.changed.slice(0, 15)) console.log(`    ~ ${c.name} (${c.fields.join(', ')})`);

  const diffProblems = [
    ...diffSafetyProblems(diff, previous?.centres.length ?? 0),
    ...osrSafetyProblems(previous, dataset),
  ];
  const knownSourceProblems: string[] = [];
  if (quality.report.summary.failedPreviouslyKnownSourcePages) {
    knownSourceProblems.push(
      `${quality.report.summary.failedPreviouslyKnownSourcePages} previously known source page(s) failed to fetch or parse`,
    );
  }
  const safetyProblems = [
    ...knownSourceProblems,
    ...diffProblems,
    ...qualityGateProblems,
  ];
  const nextState = nextQualityState(quality.report, previousQualityState);
  const discoveryStateChanged = qualityStateChanged(
    previousQualityState,
    nextState,
  );

  await reportToCi(
    diff,
    quality.report,
    qualityFile,
    safetyProblems,
    discoveryStateChanged,
    baselineChanged,
    qualityTrend,
    remediation,
  );

  const enforcedSafetyProblems = [
    ...knownSourceProblems,
    ...(opts.allowLargeDiff ? [] : diffProblems),
    ...(opts.allowQualityRegression ? [] : qualityGateProblems),
  ];
  if (enforcedSafetyProblems.length) {
    throw new Error(
      `Dataset write blocked by automated safety analysis:\n- ${enforcedSafetyProblems.join('\n- ')}` +
        '\nInspect the quality artifact. Confirmed systemic dataset and quality changes require their separate override flags; known-source failures cannot be overridden.',
    );
  }
  if (discoveryStateChanged && nextState) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      qualityStateFile,
      `${JSON.stringify(nextState, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `▸ Wrote ${path.relative(process.cwd(), qualityStateFile)} (discovery memory)`,
    );
  }
  // Writing an unchanged dataset would still churn `generatedAt` and every
  // `lastSeenAt`, producing a commit a night that says nothing. Skip it, so
  // `generatedAt` reads as "when the data last actually moved".
  if (!diff.meaningful && previous) {
    if (baselineChanged) {
      await writeQualityBaseline(qualityBaselineFile, nextQualityBaseline);
    }
    console.log(`\n▸ No meaningful change — leaving ${path.basename(outFile)} untouched`);
    printSummary(stats);
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  console.log(`\n▸ Wrote ${path.relative(process.cwd(), outFile)}`);

  if (opts.audit) {
    await fs.writeFile(
      auditFile,
      `${JSON.stringify(
        {
          generatedAt: dataset.generatedAt,
          quality: {
            ...quality.report,
            remediation,
            trend: qualityTrend,
          },
          pendingMerges: pendingLinks,
          parseFailures: failures,
          ungeocoded: centres.filter((c) => !c.geo).map((c) => ({ id: c.id, name: c.name })),
          unverifiedLocations: centres
            .filter((c) => c.geo && c.geo.verification !== 'verified')
            .map((c) => ({
              id: c.id,
              name: c.name,
              verification: c.geo!.verification,
              evidencePaths: c.geo!.evidencePaths,
              agreementKm: c.geo!.agreementKm,
            })),
          unparsedPrices: centres.flatMap((centre) =>
            centre.offerings
              .filter((offering) => offering.priceParseStatus === 'unparsed')
              .map((offering) => ({
                id: centre.id,
                name: centre.name,
                offering: offering.label,
                priceText: offering.priceText,
              })),
          ),
          legacyCities: centres
            .filter((centre) => centre.address.citySource === 'legacy')
            .map((centre) => ({
              id: centre.id,
              name: centre.name,
              city: centre.address.city,
              country: centre.address.country,
            })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`▸ Wrote ${path.relative(process.cwd(), auditFile)}`);
  }
  if (baselineChanged) {
    // Keep the baseline behind the dataset write. If a write ever fails, a
    // stale baseline creates a visible delta next run; a baseline describing
    // data that was never committed could hide one.
    await writeQualityBaseline(qualityBaselineFile, nextQualityBaseline);
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

async function readPreviousAudit(
  file: string,
): Promise<{ parseFailures?: { slug: string; error: string }[] } | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as {
      parseFailures?: { slug: string; error: string }[];
    };
  } catch {
    return null;
  }
}

async function readQualityState(file: string): Promise<QualityState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as QualityState;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.unresolvedSourceSlugs)
    ) {
      return null;
    }
    return {
      version: 1,
      unresolvedSourceSlugs: [...new Set(parsed.unresolvedSourceSlugs)].sort(),
    };
  } catch {
    return null;
  }
}

async function readQualityBaseline(
  file: string,
  country: string,
): Promise<QualityBaseline | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(file, 'utf8'),
    ) as QualityBaseline;
    if (
      parsed.version !== 1 ||
      parsed.country !== country ||
      !Number.isInteger(parsed.centreCount) ||
      !Array.isArray(parsed.affected) ||
      !Array.isArray(parsed.unresolvedSourceSlugs) ||
      !parsed.byCountry ||
      typeof parsed.byCountry !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeQualityBaseline(
  file: string,
  baseline: QualityBaseline,
): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `▸ Wrote ${path.relative(process.cwd(), file)} (quality baseline)`,
  );
}

/**
 * Hand the result to GitHub Actions when running there: `changed` gates the
 * commit step, `summary` becomes the commit subject, and the detail lands on
 * the job summary page. Outside CI these variables are unset and this is a
 * no-op.
 */
async function reportToCi(
  diff: DatasetDiff,
  quality: CentreQualityReport,
  qualityFile: string,
  safetyProblems: string[],
  qualityStateChanged: boolean,
  baselineChanged: boolean,
  qualityTrend: QualityDelta,
  remediation: RemediationReport,
): Promise<void> {
  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;

  if (GITHUB_OUTPUT) {
    const changed =
      diff.meaningful || qualityStateChanged || baselineChanged;
    const summary =
      diff.meaningful
        ? summariseDiff(diff)
        : qualityStateChanged
          ? 'Quality discovery state updated'
          : baselineChanged
            ? 'Quality baseline updated'
            : summariseDiff(diff);
    const actionableRegressions = qualityTrend.newIssues.filter(
      (issue) => issue.severity !== 'info',
    ).length;
    await fs.appendFile(
      GITHUB_OUTPUT,
      [
        `changed=${changed}`,
        `summary=${summary}`,
        `quality_report=${path.relative(REPO_ROOT, qualityFile)}`,
        `new_centres=${quality.summary.newCentres}`,
        `new_centres_needing_review=${quality.summary.newCentresNeedingReview}`,
        `quarantined_new_centres=${quality.summary.quarantinedNewCentres}`,
        `quality_regressions=${actionableRegressions}`,
        `quality_improvements=${qualityTrend.summary.resolvedIssues}`,
        `remediations_accepted=${remediation.accepted}`,
        `quality_blocked=${safetyProblems.length > 0}`,
        `quality_state_changed=${qualityStateChanged}`,
        `quality_baseline_changed=${baselineChanged}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }

  if (GITHUB_STEP_SUMMARY) {
    const safety = safetyProblems.length
      ? `\n\n## Dataset safety gate\n\n${safetyProblems.map((problem) => `- ❌ ${problem}`).join('\n')}\n`
      : '\n\n_Dataset safety gate passed._\n';
    await fs.appendFile(
      GITHUB_STEP_SUMMARY,
      `## Centre refresh — ${summariseDiff(diff)}\n\n${renderDiff(diff)}\n\n` +
        `${renderQualityReport(quality)}\n\n${renderRemediationReport(remediation)}\n\n` +
        `${renderQualityDelta(qualityTrend)}${safety}`,
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
    publishable: centres.filter((c) => c.isPublishable).length,
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
  console.log(`  publishable     ${s.publishable}`);
  console.log(`  by operator     ${JSON.stringify(s.byOperator)}`);
  console.log(`  by geo precision ${JSON.stringify(s.byGeoPrecision)}`);
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).stack ?? err}`);
  process.exit(1);
});
