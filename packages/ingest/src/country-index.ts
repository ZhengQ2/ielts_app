import {
  CENTRE_URL_PREFIX,
  CHINA_OSR_LISTING_URL,
  COUNTRY_LISTING_URL,
  LISTING_CACHE_DIR,
} from './config.ts';
import { fetchText } from './fetcher.ts';
import { hrefs, sliceElement, stripTags } from './html.ts';

export type OnlineTestOperator = 'British Council' | 'IDP';

export interface OnlineTestAvailability {
  version: 1;
  source: typeof COUNTRY_LISTING_URL;
  updatedAt: string;
  operators: Record<OnlineTestOperator, string[]>;
}

/**
 * Authoritative slug → country mapping, taken from IELTS.org itself.
 *
 * `/test-centres?country=<alpha3>&city=all` is server-rendered and lists every
 * centre IELTS.org files under that country, and the page carries a `<select>`
 * naming all ~173 countries it knows about. Walking that list gives the country
 * for every centre as *stated fact*.
 *
 * This replaces inferring the country from the address, the currency or the
 * phone prefix. Those were guesses — currency in particular cannot separate the
 * many countries sharing USD or EUR — and they identified the country for only
 * 9% of the worldwide master on their own.
 */

export interface CountryIndex {
  /** Centre slug → ISO 3166-1 alpha-2. */
  bySlug: Map<string, string>;
  /** alpha-2 → the country name IELTS.org uses. */
  names: Map<string, string>;
  /** Centre slugs whose IELTS.org result card publishes One Skill Retake. */
  osrSlugs: Set<string>;
  /** OSR-badged source cards that publish no full-test delivery format. */
  osrOnlySlugs: Set<string>;
  /** Current IELTS Online booking cards published by IELTS.org, by operator. */
  onlineCountries: Map<OnlineTestOperator, Set<string>>;
  /** Countries enumerated, and slugs attributed. */
  stats: {
    countries: number;
    slugs: number;
    globalOsrSlugs: number;
    chinaSupplementalOsrSlugs: number;
    onlineCountries: Record<OnlineTestOperator, number>;
    unmappedCodes: string[];
  };
}

const ONLINE_BOOKING_HOSTS: Record<string, OnlineTestOperator> = {
  'ieltsregistration.britishcouncil.org': 'British Council',
  'book.ielts.idp.com': 'IDP',
};

/** Parse only the distinct IELTS Online booking card in a country result. */
export function parseOnlineTestOperators(html: string): OnlineTestOperator[] {
  const operators = new Set<OnlineTestOperator>();
  const cardRe = /<div\b[^>]*class="[^"]*\bbooking-card\b[^"]*"[^>]*>/gi;
  for (const match of html.matchAll(cardRe)) {
    const card = sliceElement(html, match.index ?? 0, 'div');
    if (!/<h5\b[^>]*>\s*IELTS Online\s*<\/h5>/i.test(card)) continue;
    let recognized = false;
    for (const href of hrefs(card)) {
      try {
        const operator = ONLINE_BOOKING_HOSTS[new URL(href).hostname.toLowerCase()];
        if (operator) {
          operators.add(operator);
          recognized = true;
        }
      } catch {
        // An invalid or unrecognized URL is not operator evidence.
      }
    }
    if (!recognized) {
      throw new Error(
        'IELTS.org published an IELTS Online card with an unrecognized booking destination; ' +
          'review the operator before updating availability.',
      );
    }
  }
  return [...operators];
}

export function assertOnlineListingCoverage(
  next: Map<OnlineTestOperator, Set<string>>,
  previous?: OnlineTestAvailability | null,
): void {
  const total = [...next.values()].reduce((sum, countries) => sum + countries.size, 0);
  if (total < 50) {
    throw new Error(
      `IELTS.org Online parser found ${total} operator-country records; expected at least 50. ` +
        'The listing markup may have changed, so the availability write is blocked.',
    );
  }
  if (!previous) return;
  for (const operator of ['British Council', 'IDP'] as const) {
    const before = new Set(previous.operators[operator] ?? []);
    const removed = [...before].filter((country) => !next.get(operator)?.has(country));
    const threshold = Math.max(3, Math.ceil(before.size * 0.2));
    if (removed.length >= threshold) {
      throw new Error(
        `IELTS.org Online availability removed ${removed.length}/${before.size} ${operator} markets ` +
          `(${removed.join(', ')}); the guarded write is blocked pending review.`,
      );
    }
  }
}

const OPTION_RE = /<option[^>]*value="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/option>/g;
const SELECT_RE = /<select[^>]*>([\s\S]*?)<\/select>/g;

/**
 * The page carries two `<select>` elements — country and city. Country's
 * options are all three-letter codes; city's are place names, so more than 20
 * three-letter matches is what distinguishes them without depending on markup
 * order or attributes that could change.
 */
export function parseCountryOptions(html: string): { code3: string; name: string }[] {
  for (const sel of html.matchAll(SELECT_RE)) {
    const options = [...(sel[1] ?? '').matchAll(OPTION_RE)]
      .map((m) => ({ code3: (m[1] ?? '').toLowerCase(), name: m[2] ?? '' }))
      .filter((o) => /^[a-z]{3}$/.test(o.code3));
    if (options.length > 20) return options;
  }
  return [];
}

/**
 * Every `/test-centres/<slug>` href on the page. `/test-centres/` requires the
 * trailing slash, so the listing page's own URL (`/test-centres?country=…`,
 * no slash before the query) and a bare breadcrumb link to `/test-centres`
 * cannot be mistaken for a centre.
 */
export function parseCentreSlugs(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href="([^"]*\/test-centres\/[^"?#]+)"/g)) {
    const href = m[1] ?? '';
    const idx = href.indexOf('/test-centres/');
    const slug = href.slice(idx + '/test-centres/'.length).replace(/\/+$/, '');
    if (slug) out.add(decodeURIComponent(slug));
  }
  return [...out];
}

/**
 * OSR is a centre-level badge on IELTS.org's country result cards; it is not
 * present on the individual centre page. Read each complete card so the
 * generic explanatory copy elsewhere on the page cannot create false matches.
 */
export function parseOsrCentreSlugs(html: string): string[] {
  const out = new Set<string>();
  const cardRe = /<a\b[^>]*class="[^"]*\btest-centre-card\b[^"]*"[^>]*>/gi;
  for (const match of html.matchAll(cardRe)) {
    const card = sliceElement(html, match.index ?? 0, 'a');
    if (!/\btest-centre-card__osr(?:-box)?\b/i.test(card)) continue;
    for (const slug of parseCentreSlugs(match[0] ?? '')) out.add(slug);
  }
  return [...out];
}

/**
 * A source listing is OSR-only when its card has the OSR badge but no
 * Computer/Paper format box. This remains source-level evidence until dedup:
 * another page for the same physical centre may publish ordinary full tests.
 */
export function parseOsrOnlyCentreSlugs(html: string): string[] {
  const out = new Set<string>();
  const cardRe = /<a\b[^>]*class="[^"]*\btest-centre-card\b[^"]*"[^>]*>/gi;
  for (const match of html.matchAll(cardRe)) {
    const card = sliceElement(html, match.index ?? 0, 'a');
    if (!/\btest-centre-card__osr(?:-box)?\b/i.test(card)) continue;
    if (/\btest-centre-card__formats-box\b/i.test(card)) continue;
    for (const slug of parseCentreSlugs(match[0] ?? '')) out.add(slug);
  }
  return [...out];
}

/**
 * China IELTS publishes six British Council OSR venues on its own official
 * page, while the global IELTS.org finder currently omits the OSR badge from
 * those same venue cards. The page has no IELTS.org slugs, so this reviewed
 * crosswalk joins its stable official labels to records already discovered
 * from IELTS.org. Unknown labels block the crawl instead of being guessed.
 */
export const CHINA_OSR_SLUG_BY_LABEL: Readonly<Record<string, string>> = {
  'British Council 北京雅思机考考点': 'british-council-beijing',
  'British Council 北京国贸商圈雅思机考考点': 'british-council-beijing-cbd-venue',
  'British Council 北京嘉华世达(崇文门)雅思机考考点':
    'british-council-beijing-chivast-education-international-chongwenmen',
  'British Council 上海雅思机考考点': 'british-council-shanghai',
  'British Council 广州雅思机考考点': 'british-council-guangzhou',
  'British Council 重庆雅思机考考点': 'british-council-chongqing',
};

export function parseChinaOsrVenueLabels(html: string): string[] {
  const labels = new Set<string>();
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const label = stripTags(match[1] ?? '').replace(/\s+/g, ' ').trim();
    if (/^British Council .+雅思机考考点$/.test(label)) labels.add(label);
  }
  return [...labels];
}

export function chinaOsrVenueSlugs(html: string): string[] {
  const labels = parseChinaOsrVenueLabels(html);
  const expectedLabels = Object.keys(CHINA_OSR_SLUG_BY_LABEL).length;
  if (labels.length !== expectedLabels) {
    throw new Error(
      `China IELTS OSR venue list looks wrong (${labels.length} labels; expected ${expectedLabels}) — ` +
        'refusing to clear or invent availability until the official list and crosswalk are reviewed.',
    );
  }
  const unknown = labels.filter((label) => !CHINA_OSR_SLUG_BY_LABEL[label]);
  if (unknown.length) {
    throw new Error(
      `China IELTS published unmapped OSR venue(s): ${unknown.join(', ')}. Review the official venue before updating the crosswalk.`,
    );
  }
  return labels.map((label) => CHINA_OSR_SLUG_BY_LABEL[label]!);
}

/** Catch a renamed/removed OSR badge class before it can clear the dataset. */
export function assertOsrListingCoverage(osrSlugs: number, centreSlugs: number): void {
  const minimum = Math.max(100, Math.ceil(centreSlugs * 0.1));
  if (osrSlugs < minimum) {
    throw new Error(
      `IELTS.org OSR parser found ${osrSlugs}/${centreSlugs} source cards; expected at least ${minimum}. ` +
        'The listing markup may have changed, so the dataset write is blocked.',
    );
  }
}

export async function fetchCountryIndex(force = false): Promise<CountryIndex> {
  // Any country page carries the full dropdown; 'all' lists every centre, which
  // is a much larger download for the same option list.
  const seed = await fetchText(`${COUNTRY_LISTING_URL}?country=alb&city=all&expanded=false`, {
    cacheDir: LISTING_CACHE_DIR,
    force,
  });

  const options = parseCountryOptions(seed.body);
  if (options.length < 50) {
    throw new Error(
      `Country dropdown looks wrong (${options.length} options) — the listing page layout has changed.`,
    );
  }

  const bySlug = new Map<string, string>();
  const names = new Map<string, string>();
  const osrSlugs = new Set<string>();
  const osrOnlySlugs = new Set<string>();
  const onlineCountries = new Map<OnlineTestOperator, Set<string>>([
    ['British Council', new Set()],
    ['IDP', new Set()],
  ]);
  const unmappedCodes: string[] = [];

  for (const [i, { code3, name }] of options.entries()) {
    const alpha2 = ALPHA3_TO_ALPHA2[code3];
    if (!alpha2) {
      unmappedCodes.push(`${code3} (${name})`);
      continue;
    }
    names.set(alpha2, name);

    const res = await fetchText(
      `${COUNTRY_LISTING_URL}?country=${code3}&city=all&expanded=false`,
      { cacheDir: LISTING_CACHE_DIR, force },
    );
    for (const slug of parseCentreSlugs(res.body)) {
      // First country wins; a slug should only ever be listed under one.
      if (!bySlug.has(slug)) bySlug.set(slug, alpha2);
    }
    for (const slug of parseOsrCentreSlugs(res.body)) osrSlugs.add(slug);
    for (const slug of parseOsrOnlyCentreSlugs(res.body)) osrOnlySlugs.add(slug);
    for (const operator of parseOnlineTestOperators(res.body)) {
      onlineCountries.get(operator)!.add(alpha2);
    }

    if ((i + 1) % 25 === 0 || i === options.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${options.length} countries, ${bySlug.size} centres`);
    }
  }
  process.stdout.write('\n');

  const globalOsrSlugs = osrSlugs.size;
  assertOsrListingCoverage(globalOsrSlugs, bySlug.size);

  const chinaOsrPage = await fetchText(CHINA_OSR_LISTING_URL, {
    cacheDir: LISTING_CACHE_DIR,
    force,
  });
  const chinaSupplementalSlugs = chinaOsrVenueSlugs(chinaOsrPage.body);
  for (const slug of chinaSupplementalSlugs) {
    if (!bySlug.has(slug)) {
      throw new Error(
        `China IELTS OSR venue ${slug} is absent from the global country listing; review its identity before publishing.`,
      );
    }
    osrSlugs.add(slug);
  }

  return {
    bySlug,
    names,
    osrSlugs,
    osrOnlySlugs,
    onlineCountries,
    stats: {
      countries: options.length,
      slugs: bySlug.size,
      globalOsrSlugs,
      chinaSupplementalOsrSlugs: chinaSupplementalSlugs.length,
      onlineCountries: {
        'British Council': onlineCountries.get('British Council')!.size,
        IDP: onlineCountries.get('IDP')!.size,
      },
      unmappedCodes,
    },
  };
}

/** Present so the crawler never has to guess; `CENTRE_URL_PREFIX` re-exported for callers. */
export { CENTRE_URL_PREFIX };

/**
 * ISO 3166-1 alpha-3 → alpha-2, covering every code the dropdown offers,
 * including territories with no UN-assigned code (Kosovo → the common `XK`).
 */
export const ALPHA3_TO_ALPHA2: Record<string, string> = {
  abw: 'AW', afg: 'AF', ago: 'AO', alb: 'AL', and: 'AD', are: 'AE', arg: 'AR',
  arm: 'AM', atg: 'AG', aus: 'AU', aut: 'AT', aze: 'AZ',
  bdi: 'BI', bel: 'BE', ben: 'BJ', bfa: 'BF', bgd: 'BD', bgr: 'BG', bhr: 'BH',
  bhs: 'BS', bih: 'BA', blr: 'BY', blz: 'BZ', bmu: 'BM', bol: 'BO', bra: 'BR',
  brb: 'BB', brn: 'BN', btn: 'BT', bwa: 'BW',
  caf: 'CF', can: 'CA', che: 'CH', chl: 'CL', chn: 'CN', civ: 'CI', cmr: 'CM',
  cod: 'CD', cog: 'CG', col: 'CO', com: 'KM', cpv: 'CV', cri: 'CR', cub: 'CU',
  cuw: 'CW', cym: 'KY', cyp: 'CY', cze: 'CZ',
  deu: 'DE', dji: 'DJ', dma: 'DM', dnk: 'DK', dom: 'DO', dza: 'DZ',
  ecu: 'EC', egy: 'EG', eri: 'ER', esp: 'ES', est: 'EE', eth: 'ET',
  fin: 'FI', fji: 'FJ', fra: 'FR', fro: 'FO', fsm: 'FM',
  gab: 'GA', gbr: 'GB', geo: 'GE', gha: 'GH', gib: 'GI', gin: 'GN', glp: 'GP',
  ggy: 'GG', gmb: 'GM', gnb: 'GW', gnq: 'GQ', grc: 'GR', grd: 'GD', grl: 'GL',
  gtm: 'GT', guy: 'GY',
  hkg: 'HK', hnd: 'HN', hrv: 'HR', hti: 'HT', hun: 'HU',
  idn: 'ID', ind: 'IN', imn: 'IM', irl: 'IE', irn: 'IR', irq: 'IQ', isl: 'IS',
  isr: 'IL', ita: 'IT',
  jam: 'JM', jey: 'JE', jor: 'JO', jpn: 'JP',
  kaz: 'KZ', ken: 'KE', kgz: 'KG', khm: 'KH', kir: 'KI', kna: 'KN', kor: 'KR',
  kwt: 'KW',
  lao: 'LA', lbn: 'LB', lbr: 'LR', lby: 'LY', lca: 'LC', lie: 'LI', lka: 'LK',
  lso: 'LS', ltu: 'LT', lux: 'LU', lva: 'LV',
  mac: 'MO', maf: 'MF', mar: 'MA', mco: 'MC', mda: 'MD', mdg: 'MG', mdv: 'MV',
  mex: 'MX', mkd: 'MK', mli: 'ML', mlt: 'MT', mmr: 'MM', mne: 'ME', mng: 'MN',
  moz: 'MZ', mrt: 'MR', mtq: 'MQ', mus: 'MU', mwi: 'MW', mys: 'MY',
  nam: 'NA', ncl: 'NC', ner: 'NE', nga: 'NG', nic: 'NI', nld: 'NL', nor: 'NO',
  npl: 'NP', nru: 'NR', nzl: 'NZ',
  omn: 'OM',
  pak: 'PK', pan: 'PA', per: 'PE', phl: 'PH', plw: 'PW', png: 'PG', pol: 'PL',
  prt: 'PT', pry: 'PY', pse: 'PS', pyf: 'PF',
  qat: 'QA',
  reu: 'RE', rou: 'RO', rus: 'RU', rwa: 'RW',
  sau: 'SA', sdn: 'SD', sen: 'SN', sgp: 'SG', slb: 'SB', sle: 'SL', slv: 'SV',
  som: 'SO', srb: 'RS', ssd: 'SS', stp: 'ST', sur: 'SR', svk: 'SK', svn: 'SI',
  swe: 'SE', swz: 'SZ', syc: 'SC', syr: 'SY',
  tcd: 'TD', tgo: 'TG', tha: 'TH', tjk: 'TJ', tkm: 'TM', tls: 'TL', ton: 'TO',
  tto: 'TT', tun: 'TN', tur: 'TR', tuv: 'TV', twn: 'TW', tza: 'TZ',
  uga: 'UG', ukr: 'UA', ury: 'UY', usa: 'US', uzb: 'UZ',
  vat: 'VA', vct: 'VC', ven: 'VE', vnm: 'VN', vut: 'VU',
  wsm: 'WS',
  xkx: 'XK',
  yem: 'YE',
  zaf: 'ZA', zmb: 'ZM', zwe: 'ZW',
};
