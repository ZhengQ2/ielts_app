import namesJson from '../data/country-names.json' with { type: 'json' };

/**
 * ISO 3166-1 alpha-2 → the country name IELTS.org itself uses in its
 * `/test-centres?country=` dropdown. Captured for free while fetching that
 * listing for country attribution (country-index.ts, ingest-side); shipped
 * here so the UI can show "Indonesia (53)" instead of "ID (53)" without
 * hand-maintaining a second country-name table.
 */
const NAMES: Record<string, string> = namesJson;

/** Falls back to the bare code if a name was never captured for it. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return NAMES[code.toUpperCase()] ?? code.toUpperCase();
}
