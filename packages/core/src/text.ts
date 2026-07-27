/** Shared string normalisation used by dedup and search. */

/** Words that carry no identifying signal in a centre name. */
const STOPWORDS = new Set([
  'ielts',
  'test',
  'tests',
  'testing',
  'centre',
  'center',
  'centres',
  'centers',
  'the',
  'of',
  'and',
  'ltd',
  'limited',
  'inc',
  'llc',
  'campus',
  'location',
  'british',
  'council',
  'idp',
  'education',
]);

export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Name reduced to its identifying tokens, for fuzzy matching. */
export function nameKey(name: string): string {
  return normaliseText(name)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .join(' ');
}

/**
 * Strip the trailing disambiguator IELTS.org appends to duplicate pages
 * (`…-ns` vs `…-ns-2`). This is the single highest-signal dedup key.
 */
export function slugBase(slug: string): string {
  return slug.replace(/-\d+$/, '');
}

export function normalisePostcode(pc: string | null | undefined): string {
  return (pc ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance, iterative with a single row buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length]!;
}

/** 0..1 similarity. 1 means identical. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Token-overlap similarity, which handles reordering better than edit distance.
 *
 * Divided by the *larger* token set, not the smaller: dividing by the smaller
 * one scores any strict subset as a perfect match, which merged genuinely
 * different centres ("Canada College Mississauga" vs "Anderson College
 * Mississauga", both reduced to a subset relationship).
 */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

/** Best of edit-distance and token-overlap similarity. */
export function nameSimilarity(a: string, b: string): number {
  return Math.max(similarity(a, b), tokenSimilarity(a, b));
}
