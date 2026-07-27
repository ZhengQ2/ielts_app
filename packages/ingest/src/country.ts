/**
 * Country resolution for the global crawl.
 *
 * The address parser only recognises Canadian and US address shapes, which is
 * fine for a Canada-first build but identifies the country for just 9% of the
 * worldwide master. Two better signals exist on the page itself.
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
 * Currencies used by exactly one IELTS market. Deliberately excludes EUR, USD,
 * XOF and XAF: those span many countries and would assign the wrong one.
 */
const CURRENCY_COUNTRY: Record<string, string> = {
  AED: 'AE', AMD: 'AM', ARS: 'AR', AUD: 'AU', AZN: 'AZ',
  BDT: 'BD', BGN: 'BG', BHD: 'BH', BRL: 'BR', BWP: 'BW',
  CAD: 'CA', CHF: 'CH', CLP: 'CL', CNY: 'CN', COP: 'CO', CZK: 'CZ',
  DKK: 'DK', DZD: 'DZ',
  EGP: 'EG', ETB: 'ET',
  FJD: 'FJ',
  GBP: 'GB', GEL: 'GE', GHS: 'GH',
  HKD: 'HK', HUF: 'HU',
  IDR: 'ID', ILS: 'IL', INR: 'IN', IQD: 'IQ', IRR: 'IR', ISK: 'IS',
  JOD: 'JO', JPY: 'JP',
  KES: 'KE', KHR: 'KH', KRW: 'KR', KWD: 'KW', KZT: 'KZ',
  LAK: 'LA', LBP: 'LB', LKR: 'LK',
  MAD: 'MA', MMK: 'MM', MNT: 'MN', MUR: 'MU', MVR: 'MV', MXN: 'MX', MYR: 'MY',
  NGN: 'NG', NOK: 'NO', NPR: 'NP', NZD: 'NZ',
  OMR: 'OM',
  PEN: 'PE', PGK: 'PG', PHP: 'PH', PKR: 'PK', PLN: 'PL',
  QAR: 'QA',
  RON: 'RO', RSD: 'RS', RUB: 'RU', RWF: 'RW',
  SAR: 'SA', SEK: 'SE', SGD: 'SG',
  THB: 'TH', TND: 'TN', TRY: 'TR', TWD: 'TW', TZS: 'TZ',
  UAH: 'UA', UGX: 'UG', UZS: 'UZ',
  VND: 'VN',
  XCD: 'AG',
  ZAR: 'ZA', ZMW: 'ZM',
};

export function countryFromCurrency(currency: string | null | undefined): string | null {
  if (!currency) return null;
  return CURRENCY_COUNTRY[currency.toUpperCase()] ?? null;
}

/**
 * Best available country, most authoritative first. The address wins where it
 * produced an answer, because a postcode match is direct evidence about *this*
 * address; the others are inferences about the centre.
 */
export function resolveCountry(
  fromAddress: string | null,
  bookingUrl: string | null,
  currency: string | null | undefined,
): string | null {
  return (
    fromAddress ?? countryFromBookingUrl(bookingUrl) ?? countryFromCurrency(currency) ?? null
  );
}
