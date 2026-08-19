import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  FETCH_DELAY_MS,
  FETCH_RETRIES,
  FETCH_TIMEOUT_MS,
  USER_AGENT,
} from './config.ts';

export interface FetchOptions {
  /** Directory to cache the response body in. Omit to skip caching. */
  cacheDir?: string;
  /** Refetch even if a cached copy exists. */
  force?: boolean;
  /**
   * Reject the response unless the body ends with this string. Guards against
   * the silent-truncation failure that made IDP centres disappear from the
   * sitemap during the feasibility work (DEV_PLAN §5.1).
   */
  requireSuffix?: string;
  /** Reject every redirect. Used for trusted sitemap URLs so a compromised
   * index cannot make the crawler contact a different host. */
  forbidRedirects?: boolean;
  /**
   * Follow a redirect only when this predicate accepts its resolved target.
   * Redirects are handled manually so an untrusted target is rejected before
   * any request is sent to it.
   */
  isAllowedRedirect?: (url: string) => boolean;
  /** Hard deadline for receiving headers and consuming the complete body. */
  timeoutMs?: number;
}

export interface FetchResult {
  body: string;
  fromCache: boolean;
  url: string;
}

function cachePath(dir: string, url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const slug =
    url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .slice(-80) || 'page';
  return path.join(dir, `${slug}.${hash}.html`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 10_000;
const RATE_LIMIT_BUFFER_MS = 1_000;

type Clock = () => number;
type Sleeper = (ms: number) => Promise<void>;

/**
 * Stagger request starts and share server-directed cooldowns across concurrent
 * workers. The queue protects only admission; admitted HTTP requests may still
 * overlap, preserving the crawler's bounded concurrency.
 */
export class RequestGate {
  private queue = Promise.resolve();
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private readonly intervalMs: number;
  private readonly clock: Clock;
  private readonly sleeper: Sleeper;

  constructor(
    intervalMs: number,
    clock: Clock = Date.now,
    sleeper: Sleeper = sleep,
  ) {
    this.intervalMs = intervalMs;
    this.clock = clock;
    this.sleeper = sleeper;
  }

  cooldown(ms: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, this.clock() + Math.max(0, ms));
  }

  async waitTurn(): Promise<void> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      while (true) {
        const waitMs = Math.max(
          0,
          Math.max(this.nextStartAt, this.cooldownUntil) - this.clock(),
        );
        if (waitMs === 0) break;
        await this.sleeper(waitMs);
      }
      this.nextStartAt = this.clock() + this.intervalMs;
    } finally {
      release();
    }
  }
}

const ieltsOrgRequestGate = new RequestGate(FETCH_DELAY_MS);

function isIeltsOrgUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'ielts.org';
  } catch {
    return false;
  }
}

/** Add a quiet recovery window before retrying sparse failed source pages. */
export function cooldownIeltsOrgRequests(ms: number): void {
  ieltsOrgRequestGate.cooldown(ms);
}

/** Parse an HTTP Retry-After value, bounding untrusted server input. */
export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds * 1_000), MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

async function fetchWithRedirectPolicy(
  initialUrl: string,
  opts: FetchOptions,
): Promise<{ response: Response; url: string; body: string | null }> {
  let currentUrl = initialUrl;

  for (let redirects = 0; ; redirects++) {
    if (isIeltsOrgUrl(currentUrl)) await ieltsOrgRequestGate.waitTurn();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,*/*' },
        redirect: opts.isAllowedRedirect
          ? 'manual'
          : opts.forbidRedirects
            ? 'error'
            : 'follow',
        signal: controller.signal,
      });

      if (!opts.isAllowedRedirect || !REDIRECT_STATUSES.has(response.status)) {
        // fetch() resolves after headers. Consume the successful response while
        // the same abort timer remains active so a stalled body cannot hang a
        // crawler worker indefinitely.
        const body = response.ok ? await response.text() : null;
        return { response, url: currentUrl, body };
      }

      const location = response.headers.get('location');
      if (!location) {
        throw Object.assign(new Error(`Redirect without Location header for ${currentUrl}`), {
          permanent: true,
        });
      }
      if (redirects >= MAX_REDIRECTS) {
        throw Object.assign(new Error(`Too many redirects for ${initialUrl}`), {
          permanent: true,
        });
      }

      const nextUrl = new URL(location, currentUrl).href;
      if (!opts.isAllowedRedirect(nextUrl)) {
        throw Object.assign(
          new Error(`Rejected untrusted redirect from ${currentUrl} to ${nextUrl}`),
          { permanent: true },
        );
      }
      currentUrl = nextUrl;
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return error.message;
  const code = (cause as Error & { code?: string }).code;
  return `${error.message}: ${code ? `${code} ` : ''}${cause.message}`;
}

/**
 * Fetch a URL with retries, a hard timeout, an optional completeness check and
 * on-disk caching. Always reads the *entire* body — never a size-capped prefix.
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let file: string | null = null;
  if (opts.cacheDir) {
    file = cachePath(opts.cacheDir, url);
    if (!opts.force) {
      try {
        const cached = await fs.readFile(file, 'utf8');
        if (!opts.requireSuffix || cached.trimEnd().endsWith(opts.requireSuffix)) {
          return { body: cached, fromCache: true, url };
        }
        // A truncated cache entry is worse than none — fall through and refetch.
      } catch {
        // Not cached yet.
      }
    }
  }

  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    attempts = attempt;
    try {
      const fetched = await fetchWithRedirectPolicy(url, opts);
      const res = fetched.response;
      if (!res.ok) {
        // 404s are a permanent answer; retrying wastes the crawl budget.
        if (res.status === 404 || res.status === 410) {
          throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), {
            permanent: true,
            status: res.status,
          });
        }
        const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
        if (isIeltsOrgUrl(fetched.url) && res.status === 429) {
          ieltsOrgRequestGate.cooldown(
            (retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS) + RATE_LIMIT_BUFFER_MS,
          );
        }
        throw Object.assign(new Error(`HTTP ${res.status} for ${fetched.url}`), {
          retryAfterMs,
          status: res.status,
        });
      }
      const body = fetched.body!;
      if (opts.requireSuffix && !body.trimEnd().endsWith(opts.requireSuffix)) {
        throw new Error(
          `Truncated response for ${url}: expected it to end with ${opts.requireSuffix}`,
        );
      }
      if (file) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, body, 'utf8');
      }
      await sleep(FETCH_DELAY_MS);
      return { body, fromCache: false, url: fetched.url };
    } catch (err) {
      lastError = err;
      if ((err as { permanent?: boolean }).permanent) break;
      if (attempt < FETCH_RETRIES) {
        const retryAfterMs = (err as { retryAfterMs?: number | null }).retryAfterMs;
        await sleep(Math.max(FETCH_DELAY_MS * 2 ** attempt, retryAfterMs ?? 0));
      }
    }
  }
  throw Object.assign(
    new Error(
      `Failed to fetch ${url} after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${describeError(lastError)}`,
      { cause: lastError },
    ),
    { status: (lastError as { status?: number } | undefined)?.status },
  );
}

/** Run `worker` over `items` with bounded concurrency, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;

  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
      done++;
      onProgress?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
