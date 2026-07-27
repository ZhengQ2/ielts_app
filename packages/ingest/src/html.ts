/** Minimal HTML helpers. The pages we parse are server-rendered and use stable
 * BEM class names, so targeted extraction beats pulling in a full DOM. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The chunk of markup starting at `startIndex` and ending at the first closing
 * tag of `tag` at depth zero. Handles nesting, unlike a naive `indexOf`.
 */
export function sliceElement(html: string, startIndex: number, tag: string): string {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0;
  let i = startIndex;
  while (i < html.length) {
    open.lastIndex = i;
    close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.slice(startIndex);
    if (o && o.index < c.index) {
      depth++;
      i = o.index + o[0].length;
      continue;
    }
    depth--;
    i = c.index + c[0].length;
    // Depth reaches 0 exactly when this close matches the element's own
    // opening tag at startIndex (counted as the first "open" above) — stop
    // there. The previous version checked depth===0 *before* decrementing,
    // which only guards malformed HTML, and otherwise kept scanning past the
    // element's real end until it happened to run out of closing tags
    // anywhere later in the document — silently over-including everything in
    // between, including content the caller never intended to see (here, a
    // shared page footer, once nothing else remained to stop it early).
    if (depth <= 0) return html.slice(startIndex, i);
  }
  return html.slice(startIndex);
}

/** Text of every `<p>` in a fragment, blanks removed. */
export function paragraphs(fragment: string): string[] {
  return [...fragment.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter(Boolean);
}

/** All `href` values in a fragment, entity-decoded. */
export function hrefs(fragment: string): string[] {
  return [...fragment.matchAll(/href\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => decodeEntities(m[1] ?? '').trim())
    .filter(Boolean);
}
