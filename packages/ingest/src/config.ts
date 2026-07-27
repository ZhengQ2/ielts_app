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

/** Raw fetched HTML lives here. Gitignored: large and fully regenerable. */
export const CACHE_DIR = path.join(REPO_ROOT, '.cache');
export const PAGE_CACHE_DIR = path.join(CACHE_DIR, 'pages');
export const SITEMAP_CACHE_DIR = path.join(CACHE_DIR, 'sitemaps');
export const GEOCODE_CACHE = path.join(CACHE_DIR, 'geocode.json');

export const DATA_DIR = path.join(REPO_ROOT, 'packages/core/data');

export const SITEMAP_INDEX = 'https://ielts.org/sitemap.xml';
export const CENTRE_URL_PREFIX = 'https://ielts.org/test-centres/';

/**
 * Identify ourselves honestly. robots.txt permits /test-centres/; we stay well
 * under any reasonable rate and cache aggressively so a re-run costs nothing.
 */
export const USER_AGENT =
  'ielts-map/0.1 (test-centre directory; +https://github.com/ZhengQ2/ielts_app)';

/** Concurrent page fetches. Deliberately modest. */
export const FETCH_CONCURRENCY = 4;
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
