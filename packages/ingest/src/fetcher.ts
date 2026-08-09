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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xml,*/*' },
        redirect: opts.forbidRedirects ? 'error' : 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        // 404s are a permanent answer; retrying wastes the crawl budget.
        if (res.status === 404 || res.status === 410) {
          throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), {
            permanent: true,
            status: res.status,
          });
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const body = await res.text();
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
      return { body, fromCache: false, url };
    } catch (err) {
      lastError = err;
      if ((err as { permanent?: boolean }).permanent) break;
      if (attempt < FETCH_RETRIES) await sleep(FETCH_DELAY_MS * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
