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
 * Transitional geocode cache. Google response content in this legacy file is
 * not portable or indefinitely retainable; neutral migration replaces it with
 * record-level open provenance, while a follow-up must add an at-most-30-day
 * Google cache (or retain Place IDs only).
 */
export const GEOCODE_CACHE = path.join(REPO_ROOT, 'data/geocode-cache.json');

export const DATA_DIR = path.join(REPO_ROOT, 'packages/core/data');
/** Ephemeral machine-readable diagnostics uploaded by CI, never committed. */
export const REPORT_DIR = path.join(REPO_ROOT, '.artifacts');
/** Reviewed corrections that must survive a fresh IELTS.org crawl. */
export const CENTRE_OVERRIDES_FILE = path.join(DATA_DIR, 'centre-overrides.json');

export const SITEMAP_INDEX = 'https://ielts.org/sitemap.xml';
export const CENTRE_URL_PREFIX = 'https://ielts.org/test-centres/';

/**
 * The country-filtered listing (`?country=<alpha3>&city=all`) is server-
 * rendered and authoritative — IELTS.org's own country assignment, rather than
 * an inference from address, currency or phone prefix.
 */
export const COUNTRY_LISTING_URL = 'https://ielts.org/test-centres';
export const LISTING_CACHE_DIR = path.join(CACHE_DIR, 'listings');
/** Official mainland-China OSR venue list, used because the global finder omits BC's badges. */
export const CHINA_OSR_LISTING_URL =
  'https://www.chinaielts.org/book-ielts/one-skill-retake';

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
 * doing nothing concurrently. Nominatim and AMap serialise themselves
 * internally regardless of outer concurrency, and the Google budget counter is
 * checked-then-incremented synchronously with no `await` in between, so it
 * stays correct under concurrent callers despite JS having no real threads.
 */
export const RESOLVE_CONCURRENCY = 8;
/** Minimum delay between requests per worker, milliseconds. */
export const FETCH_DELAY_MS = 250;
export const FETCH_TIMEOUT_MS = 30_000;
export const FETCH_RETRIES = 3;
/** Per-attempt deadline for geocoders other than AMap, which has its own setting. */
export const PROVIDER_REQUEST_TIMEOUT_MS = Number(
  process.env.PROVIDER_REQUEST_TIMEOUT_MS ?? 8_000,
);

/**
 * Google Geocoding, used only when GOOGLE_MAPS_API_KEY is set. The key lives in
 * the environment — never in the repo, the dataset or the cache.
 */
export const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
/** Google Places Text Search (New), used as independent venue-name evidence. */
export const GOOGLE_PLACES_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';
/** Place Details (New) base URL; Place IDs are appended as encoded path segments. */
export const GOOGLE_PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

/**
 * Finite by default: an unexpectedly cold cache is more likely to indicate a
 * parser/cache regression than hundreds of genuinely new centres.
 */
export const DEFAULT_GOOGLE_REQUEST_BUDGET = 500;
export const DEFAULT_AMAP_REQUEST_BUDGET = 300;
export const DEFAULT_MAPPLS_REQUEST_BUDGET = 300;

/** AMap/Gaode geocoding, used only for coarse mainland-China locations. */
export const AMAP_GEOCODE_URL = 'https://restapi.amap.com/v3/geocode/geo';
/** AMap/Gaode local-language POI text search for Chinese venue corroboration. */
export const AMAP_POI_TEXT_URL = 'https://restapi.amap.com/v5/place/text';
/** AMap/Gaode coordinate-biased POI search, used for Chinese matching evidence. */
export const AMAP_POI_AROUND_URL = 'https://restapi.amap.com/v5/place/around';
/**
 * Keep calls under the basic-service QPS window and fail before a provider
 * timeout can stall the whole ingest. Both remain configurable for accounts
 * whose AMap console shows a different quota.
 */
export const AMAP_MIN_INTERVAL_MS = Number(process.env.AMAP_MIN_INTERVAL_MS ?? 350);
export const AMAP_REQUEST_TIMEOUT_MS = Number(process.env.AMAP_REQUEST_TIMEOUT_MS ?? 8_000);

/** Mappls address lookup and eLoc detail endpoints, used only for coarse Indian locations. */
export const MAPPLS_GEOCODE_URL = 'https://search.mappls.com/search/address/geocode';
export const MAPPLS_PLACE_URL = 'https://place.mappls.com/O2O/entity/place-details';
/** Mappls reverse geocoding, used for Hindi matching evidence. */
export const MAPPLS_REVERSE_GEOCODE_URL =
  'https://search.mappls.com/search/address/rev-geocode';
/** Keep calls under Mappls' free-tier QPS window. Configurable per account. */
export const MAPPLS_MIN_INTERVAL_MS = Number(process.env.MAPPLS_MIN_INTERVAL_MS ?? 250);

/** Nominatim's usage policy is a hard 1 request/second. */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_DELAY_MS = 1100;
