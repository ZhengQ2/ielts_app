const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * True only for http(s) URLs. Booking links, websites and evidence URLs
 * ultimately trace back to scraped pages or manually-entered corrections, so
 * this is the gate before any of them becomes a clickable `href` — a
 * `javascript:`/`data:` URI must never reach the DOM this way. `mailto:`
 * links are a separate, explicitly permitted case handled at their call site.
 */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
