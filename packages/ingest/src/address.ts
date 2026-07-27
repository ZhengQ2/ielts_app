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
/** Anchored to end-of-line so a five-digit street number can't pose as a ZIP. */
const US_ZIP_AT_END = /\b\d{5}(?:-\d{4})?\s*$/;

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
/**
 * Subdivision codes that are not unique to Canada. "NT" is both Northwest
 * Territories and Australia's Northern Territory, which put a Darwin centre in
 * the Canadian dataset. These still set `region`, but never imply a country.
 */
const AMBIGUOUS_CA_CODES = new Set(['nt']);

/** A bare 3–6 digit line is a postal code from a country that isn't CA or US. */
const FOREIGN_NUMERIC_POSTCODE = /^\d{3,6}$/;

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

  const found: {
    postcode: string | null;
    region: string | null;
    country: string | null;
    /** Country implied by a subdivision code — applied only if nothing contradicts it. */
    regionCountryHint: string | null;
    /** A postal code in a format neither Canada nor the US uses. */
    foreignPostcode: boolean;
  } = {
    postcode: null,
    region: null,
    country: null,
    regionCountryHint: null,
    foreignPostcode: false,
  };
  const cityCandidates: string[] = [];

  // Decided up front: if the address carries a Canadian postcode anywhere, no
  // line may be interpreted as a US ZIP.
  const hasCanadianPostcode = cleaned.some((l) => CA_POSTCODE.test(l));

  cleaned.forEach((line, index) => {
    let rest = line;

    // Country, either as the whole line or a trailing segment.
    const countryHit = takeCountry(rest);
    if (countryHit) {
      found.country ??= countryHit.code;
      rest = countryHit.rest;
    }

    // Postcodes are stripped from every line, not just the one we store. A
    // postcode is never part of a city name, and addresses routinely repeat it
    // — leaving a later repeat in place made it the city.
    const ca = CA_POSTCODE.exec(rest);
    if (ca) {
      found.postcode ??= `${ca[1]!.toUpperCase()} ${ca[2]!.toUpperCase()}`;
      found.country ??= 'CA';
      rest = rest.replace(CA_POSTCODE, ' ');
    } else if (!hasCanadianPostcode) {
      // A ZIP is only believable at the end of a line. Canadian civic numbers
      // are commonly five digits ("14505 Bannister Rd SE"), and reading those
      // as a US ZIP stole the slot from the real postcode further down.
      const zip = US_ZIP_AT_END.exec(rest);
      if (zip) {
        found.postcode ??= zip[0].trim();
        rest = rest.replace(US_ZIP_AT_END, ' ');
      }
    }

    // Region: "(NL)", a trailing ", ON", or a line that is only "Alberta".
    const regionHit = takeRegion(rest);
    if (regionHit) {
      if (!found.region) {
        found.region = regionHit.code;
        // Held back rather than applied: a subdivision code is only weak
        // evidence of a country, and a foreign postcode later in the address
        // must be able to override it.
        if (regionHit.country) found.regionCountryHint ??= regionHit.country;
      }
      rest = regionHit.rest;
    }

    rest = rest.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rest || index === 0) return;
    if (FOREIGN_NUMERIC_POSTCODE.test(rest)) {
      found.foreignPostcode = true;
      found.postcode ??= rest;
      return;
    }
    if (STREET_RE.test(rest)) return;
    if (/^\d+$/.test(rest) || rest.length > 60) return;
    // A single alphanumeric token is a postcode, not a place. Real city names
    // containing digits ("100 Mile House") always have spaces, so this rejects
    // malformed postcodes like "M2N063" without discarding genuine names.
    if (/\d/.test(rest) && !/\s/.test(rest)) return;
    cityCandidates.push(rest);
  });

  // A postal code the address actually carries beats a subdivision abbreviation.
  if (!found.country && found.regionCountryHint && !found.foreignPostcode) {
    found.country = found.regionCountryHint;
  }

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
  // The full province name is unambiguous; a colliding two-letter code is not.
  if (ca) return { code: ca, country: AMBIGUOUS_CA_CODES.has(key) ? null : 'CA' };
  if (US_STATES.has(key)) return { code: key.toUpperCase(), country: 'US' };
  return null;
}
