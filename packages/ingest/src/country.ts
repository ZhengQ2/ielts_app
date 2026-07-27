/**
 * Fallback country resolution for the global crawl.
 *
 * IELTS.org's own `/test-centres?country=<alpha3>&city=all` listing (see
 * country-index.ts) is the primary source and is stated fact — it is fetched
 * once per run and covers 94%+ of the worldwide master. What's here is the
 * fallback for whatever that listing doesn't cover: the address parser (CA/US
 * shapes only), the booking link's declared country, and the phone's dialling
 * code. All three are still direct evidence, not a guess — deliberately absent
 * is inferring country from currency, which cannot distinguish the many
 * countries sharing USD or EUR and would quietly mis-assign the ones sharing
 * AUD, ZAR, INR or CHF.
 */

/**
 * British Council booking links carry `country=<ISO>` — the operator's own
 * declaration, and the strongest signal available. Covers ~730 centres.
 */
export function countryFromBookingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const code = new URL(url).searchParams.get('country');
    return code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * E.164 dialling prefixes, longest match first. Printed on the page itself, so
 * this is stated fact rather than inference.
 *
 * Shared prefixes are deliberately absent: +1 spans the US, Canada and much of
 * the Caribbean, and +7 spans Russia and Kazakhstan. Those fall through to a
 * geocoder rather than being guessed.
 */
const DIALLING_CODES: Record<string, string> = {
  '20': 'EG', '27': 'ZA',
  '30': 'GR', '31': 'NL', '32': 'BE', '33': 'FR', '34': 'ES', '36': 'HU',
  '39': 'IT',
  '40': 'RO', '41': 'CH', '43': 'AT', '44': 'GB', '45': 'DK', '46': 'SE',
  '47': 'NO', '48': 'PL', '49': 'DE',
  '51': 'PE', '52': 'MX', '53': 'CU', '54': 'AR', '55': 'BR', '56': 'CL',
  '57': 'CO', '58': 'VE',
  '60': 'MY', '61': 'AU', '62': 'ID', '63': 'PH', '64': 'NZ', '65': 'SG',
  '66': 'TH',
  '81': 'JP', '82': 'KR', '84': 'VN', '86': 'CN',
  '90': 'TR', '91': 'IN', '92': 'PK', '93': 'AF', '94': 'LK', '95': 'MM',
  '98': 'IR',
  '212': 'MA', '213': 'DZ', '216': 'TN', '218': 'LY', '220': 'GM',
  '221': 'SN', '223': 'ML', '225': 'CI', '226': 'BF', '229': 'BJ',
  '230': 'MU', '231': 'LR', '232': 'SL', '233': 'GH', '234': 'NG',
  '235': 'TD', '237': 'CM', '241': 'GA', '243': 'CD', '244': 'AO',
  '249': 'SD', '250': 'RW', '251': 'ET', '254': 'KE', '255': 'TZ',
  '256': 'UG', '260': 'ZM', '263': 'ZW', '264': 'NA', '265': 'MW',
  '266': 'LS', '267': 'BW', '268': 'SZ',
  '351': 'PT', '352': 'LU', '353': 'IE', '354': 'IS', '355': 'AL',
  '356': 'MT', '357': 'CY', '358': 'FI', '359': 'BG',
  '370': 'LT', '371': 'LV', '372': 'EE', '373': 'MD', '374': 'AM',
  '375': 'BY', '380': 'UA', '381': 'RS', '382': 'ME', '385': 'HR',
  '386': 'SI', '387': 'BA', '389': 'MK',
  '420': 'CZ', '421': 'SK',
  '852': 'HK', '853': 'MO', '855': 'KH', '856': 'LA', '880': 'BD',
  '886': 'TW',
  '960': 'MV', '961': 'LB', '962': 'JO', '963': 'SY', '964': 'IQ',
  '965': 'KW', '966': 'SA', '967': 'YE', '968': 'OM', '970': 'PS',
  '971': 'AE', '972': 'IL', '973': 'BH', '974': 'QA', '975': 'BT',
  '976': 'MN', '977': 'NP',
  '992': 'TJ', '993': 'TM', '994': 'AZ', '995': 'GE', '996': 'KG',
  '998': 'UZ',
};

/**
 * The only two calling codes ITU assigns at a single digit: '1' (NANP — the US,
 * Canada and much of the Caribbean) and '7' (Russia and Kazakhstan). Both are
 * excluded from DIALLING_CODES as ambiguous, but that alone is not enough: if
 * length-3/2 matching ran over their remaining digits regardless, "+14165551234"
 * would strip its leading '1' and then match '41' (Switzerland) purely by
 * coincidence. Checking for these two prefixes first, before any length-3/2
 * lookup runs at all, is what stops that.
 */
const SINGLE_DIGIT_AMBIGUOUS = new Set(['1', '7']);

export function countryFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return null;
  const national = digits.slice(1);
  if (!national || SINGLE_DIGIT_AMBIGUOUS.has(national[0]!)) return null;

  // Every other assigned calling code is 2 or 3 digits and, by ITU design, no
  // code is a prefix of another — so trying the longer length first is safe.
  for (const len of [3, 2]) {
    const code = DIALLING_CODES[national.slice(0, len)];
    if (code) return code;
  }
  return null;
}

/**
 * Best country available at parse time, most authoritative first. Anything
 * still unresolved is filled in later from the geocoder, which returns the
 * country as fact rather than inference.
 */
export function resolveCountry(
  fromAddress: string | null,
  bookingUrl: string | null,
  phone: string | null | undefined,
): string | null {
  return fromAddress ?? countryFromBookingUrl(bookingUrl) ?? countryFromPhone(phone) ?? null;
}
