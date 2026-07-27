import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this file so the CLI works from any cwd. */
export const REPO_ROOT = path.resolve(here, '../../..');

/**
 * Load repo-root `.env.local` if present, so credentials can live in a
 * gitignored file rather than being exported by hand. Values already in the
 * environment win, and a missing file is not an error — the whole pipeline runs
 * without any key.
 */
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env.local'));
} catch {
  // No .env.local; environment variables (if any) are used as-is.
}

/** Raw fetched HTML lives here. Gitignored: ~300 MB and fully regenerable. */
export const CACHE_DIR = path.join(REPO_ROOT, '.cache');
export const PAGE_CACHE_DIR = path.join(CACHE_DIR, 'pages');
export const SITEMAP_CACHE_DIR = path.join(CACHE_DIR, 'sitemaps');

/**
 * The geocode cache IS committed, unlike the HTML cache. It is small, and it is
 * what stops a scheduled re-crawl from re-billing every address to Google on
 * every run — a fresh CI checkout has no other memory of past lookups.
 */
export const GEOCODE_CACHE = path.join(REPO_ROOT, 'data/geocode-cache.json');

export const DATA_DIR = path.join(REPO_ROOT, 'packages/core/data');

export const SITEMAP_INDEX = 'https://ielts.org/sitemap.xml';
export const CENTRE_URL_PREFIX = 'https://ielts.org/test-centres/';

/**
 * The country-filtered listing (`?country=<alpha3>&city=all`) is server-
 * rendered and authoritative — IELTS.org's own country assignment, rather than
 * an inference from address, currency or phone prefix.
 */
export const COUNTRY_LISTING_URL = 'https://ielts.org/test-centres';
export const LISTING_CACHE_DIR = path.join(CACHE_DIR, 'listings');

/**
 * Identify ourselves honestly. robots.txt permits /test-centres/; we stay well
 * under any reasonable rate and cache aggressively so a re-run costs nothing.
 */
export const USER_AGENT =
  'ielts-map/0.1 (test-centre directory; +https://github.com/ZhengQ2/ielts_app)';

/** Concurrent page fetches. Deliberately modest. */
export const FETCH_CONCURRENCY = 4;

/**
 * Concurrent centre *resolutions* (geocoding), separate from FETCH_CONCURRENCY
 * because it gates a different bottleneck: each Google Geocoding call measured
 * ~0.9s round-trip, and resolving centres one at a time made that additive —
 * 565 lookups at ~1-3 sequential calls each took the better part of an hour
 * doing nothing concurrently. Safe to raise: Nominatim serialises itself
 * internally regardless of outer concurrency (its own 1 req/s policy is
 * enforced inside `geocode.ts`, not here), and the Google budget counter is
 * checked-then-incremented synchronously with no `await` in between, so it
 * stays correct under concurrent callers despite JS having no real threads.
 */
export const RESOLVE_CONCURRENCY = 8;
/** Minimum delay between requests per worker, milliseconds. */
export const FETCH_DELAY_MS = 250;
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_RETRIES = 3;

/**
 * Google Geocoding, used only when GOOGLE_MAPS_API_KEY is set. The key lives in
 * the environment — never in the repo, the dataset or the cache.
 */
export const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Nominatim's usage policy is a hard 1 request/second. */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_DELAY_MS = 1100;
