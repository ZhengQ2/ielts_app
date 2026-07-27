import type { CentreAddress } from '@ielts-map/core';

/**
 * Turn the page's Address block (a bare list of `<p>` lines) into a structured
 * address. IELTS.org's own city field is broken site-wide ("IELTS test in ?"),
 * so city is always derived from these lines (DEV_PLAN §5.1).
 *
 * The lines are not a fixed schema. Observed shapes include:
 *   ["Suite 1200 - 700 6 Ave SW", "Calgary", "Alberta", "T2P 0T8"]
 *   ["31 Pippy Place, Unit 3006", "3rd Floor", "St Johns (NL)", "A1B3X2"]
 *   ["Unit 210, Bentinck St Level", "500 George St", "Sydney", "B1P 1K6"]
 * so the parser consumes what it can identify (postcode, region, country) and
 * treats the *last* remaining line as the city — city always sits after the
 * street lines and before the region/postcode.
 */

const CA_POSTCODE = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])[ -]?(\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
const US_ZIP = /\b\d{5}(?:-\d{4})?\b/;

const CA_PROVINCES: Record<string, string> = {
  ab: 'AB',
  alberta: 'AB',
  bc: 'BC',
  'british columbia': 'BC',
  mb: 'MB',
  manitoba: 'MB',
  nb: 'NB',
  'new brunswick': 'NB',
  nl: 'NL',
  'newfoundland and labrador': 'NL',
  newfoundland: 'NL',
  ns: 'NS',
  'nova scotia': 'NS',
  nt: 'NT',
  'northwest territories': 'NT',
  nu: 'NU',
  nunavut: 'NU',
  on: 'ON',
  ontario: 'ON',
  pe: 'PE',
  pei: 'PE',
  'prince edward island': 'PE',
  qc: 'QC',
  quebec: 'QC',
  québec: 'QC',
  sk: 'SK',
  saskatchewan: 'SK',
  yt: 'YT',
  yukon: 'YT',
};

/**
 * Only matched against a whole line or a trailing comma-segment, so the codes
 * that double as English words ("in", "or", "la", "me") can't be triggered by
 * ordinary address text.
 */
const US_STATES = new Set(
  ('al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ' +
    'ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc')
    .split(' '),
);

/** Country names that appear as their own address line. */
const COUNTRY_NAMES: Record<string, string> = {
  canada: 'CA',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  us: 'US',
  'united kingdom': 'GB',
  uk: 'GB',
  australia: 'AU',
  india: 'IN',
  china: 'CN',
  'p.r. china': 'CN',
  ireland: 'IE',
  'new zealand': 'NZ',
};

const STREET_RE =
  /\b\d{1,6}\s+[\w'.-]+(?:\s+[\w'.-]+)*\s+(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|hwy|highway|lane|ln|crescent|cres|court|ct|place|pl|terrace|trail|parkway|pkwy)\b\.?/i;

export function parseAddress(lines: string[]): CentreAddress {
  const cleaned = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const raw = cleaned.join(', ');

  const found: { postcode: string | null; region: string | null; country: string | null } = {
    postcode: null,
    region: null,
    country: null,
  };
  const cityCandidates: string[] = [];

  cleaned.forEach((line, index) => {
    let rest = line;

    // Country, either as the whole line or a trailing segment.
    const countryHit = takeCountry(rest);
    if (countryHit) {
      found.country ??= countryHit.code;
      rest = countryHit.rest;
    }

    // Postcode, which may be embedded mid-line.
    const ca = CA_POSTCODE.exec(rest);
    if (ca && !found.postcode) {
      found.postcode = `${ca[1]!.toUpperCase()} ${ca[2]!.toUpperCase()}`;
      found.country ??= 'CA';
      rest = rest.replace(CA_POSTCODE, ' ');
    } else if (!found.postcode) {
      const zip = US_ZIP.exec(rest);
      if (zip && !CA_POSTCODE.test(rest)) {
        found.postcode = zip[0];
        rest = rest.replace(US_ZIP, ' ');
      }
    }

    // Region: "(NL)", a trailing ", ON", or a line that is only "Alberta".
    const regionHit = takeRegion(rest);
    if (regionHit) {
      if (!found.region) {
        found.region = regionHit.code;
        if (regionHit.country) found.country ??= regionHit.country;
      }
      rest = regionHit.rest;
    }

    rest = rest.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rest || index === 0) return;
    if (STREET_RE.test(rest)) return;
    if (/^\d+$/.test(rest) || rest.length > 60) return;
    cityCandidates.push(rest);
  });

  if (!found.country && found.region && US_STATES.has(found.region.toLowerCase())) {
    found.country = 'US';
  }

  // The city is the last line before the region/postcode tail, so later
  // candidates beat earlier ones (which are unit/floor/street lines).
  const city = cityCandidates.length ? cityCandidates[cityCandidates.length - 1]! : null;

  return {
    raw,
    lines: cleaned,
    city,
    region: found.region,
    postcode: found.postcode,
    country: found.country,
  };
}

function takeCountry(line: string): { code: string; rest: string } | null {
  const whole = COUNTRY_NAMES[line.toLowerCase().trim().replace(/[.,]+$/, '')];
  if (whole) return { code: whole, rest: '' };

  const parts = line.split(',');
  if (parts.length > 1) {
    const last = parts[parts.length - 1]!.trim().toLowerCase().replace(/[.]+$/, '');
    const code = COUNTRY_NAMES[last];
    if (code) return { code, rest: parts.slice(0, -1).join(',') };
  }
  return null;
}

function takeRegion(
  line: string,
): { code: string; country: string | null; rest: string } | null {
  // Parenthetical: "St Johns (NL)"
  const paren = /\(([^)]{2,30})\)/.exec(line);
  if (paren) {
    const hit = lookupRegion(paren[1]!);
    if (hit) return { ...hit, rest: line.replace(paren[0], ' ') };
  }

  // Whole line: "Alberta"
  const whole = lookupRegion(line);
  if (whole) return { ...whole, rest: '' };

  // Trailing segment: "Toronto, ON"
  const parts = line.split(',');
  if (parts.length > 1) {
    const hit = lookupRegion(parts[parts.length - 1]!);
    if (hit) return { ...hit, rest: parts.slice(0, -1).join(',') };
  }

  return null;
}

function lookupRegion(s: string): { code: string; country: string | null } | null {
  const key = s.trim().toLowerCase().replace(/[.]+$/, '');
  const ca = CA_PROVINCES[key];
  if (ca) return { code: ca, country: 'CA' };
  if (US_STATES.has(key)) return { code: key.toUpperCase(), country: 'US' };
  return null;
}
