import { CENTRE_URL_PREFIX, SITEMAP_CACHE_DIR, SITEMAP_INDEX } from './config.ts';
import { fetchText } from './fetcher.ts';

/**
 * Enumerate every test-centre slug from the IELTS.org XML sitemap.
 *
 * Two failure modes are guarded here because both silently corrupted earlier
 * attempts (DEV_PLAN §5.1):
 *
 *  1. Truncation — these pages are ~95 KB and IDP centres cluster in the *tail*
 *     of each one, so a size-capped fetch drops exactly the operator you most
 *     need. Every download is required to end with `</urlset>`.
 *  2. Double counting — each `<url>` carries `xhtml:link` alternates whose
 *     `href` repeats the same URL. Parsing hrefs yields every slug twice (the
 *     second with a trailing quote). Only `<loc>` is read.
 */

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

function locs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(LOC_RE)) {
    const v = m[1];
    if (v) out.push(v.trim());
  }
  return out;
}

export interface SitemapResult {
  pages: string[];
  slugs: string[];
  /** slug → the sitemap page it appeared on, for debugging coverage. */
  origin: Map<string, string>;
}

export async function readSitemap(force = false): Promise<SitemapResult> {
  const index = await fetchText(SITEMAP_INDEX, {
    cacheDir: SITEMAP_CACHE_DIR,
    force,
    requireSuffix: '</sitemapindex>',
  });

  const pages = locs(index.body)
    .filter((u) => u.toLowerCase().includes('testcentres'))
    .sort((a, b) => pageNo(a) - pageNo(b));

  if (pages.length === 0) {
    throw new Error(
      'No testCentres sub-sitemaps found in the index — the sitemap layout has changed.',
    );
  }

  const seen = new Set<string>();
  const slugs: string[] = [];
  const origin = new Map<string, string>();

  for (const page of pages) {
    const res = await fetchText(page, {
      cacheDir: SITEMAP_CACHE_DIR,
      force,
      requireSuffix: '</urlset>',
    });
    let onPage = 0;
    for (const loc of locs(res.body)) {
      if (!loc.startsWith(CENTRE_URL_PREFIX)) continue;
      const slug = decodeURIComponent(loc.slice(CENTRE_URL_PREFIX.length)).replace(/\/+$/, '');
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
      origin.set(slug, page);
      onPage++;
    }
    console.log(`  ${page.split('/').pop()}: ${onPage} centres`);
  }

  return { pages, slugs, origin };
}

function pageNo(u: string): number {
  const m = /-p(\d+)\.xml/.exec(u);
  return m?.[1] ? Number(m[1]) : 0;
}
