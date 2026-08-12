import { countryName } from './country-names.ts';
import onlineAvailabilityJson from '../data/online-test-availability.json' with { type: 'json' };
import type { Operator } from './types.ts';

export type IeltsOnlineOperator = 'British Council' | 'IDP';

export interface AvailabilityLink<T extends Operator | IeltsOnlineOperator> {
  operator: T;
  url: string;
}

export interface CountryOrRegionTestAvailability {
  countryOrRegion: string;
  inPerson: AvailabilityLink<Operator>[];
  online: AvailabilityLink<IeltsOnlineOperator>[];
}

const BRITISH_COUNCIL_IN_PERSON = new Set([
  'AL', 'DZ', 'AR', 'AM', 'AT', 'AZ', 'BH', 'BD', 'BE', 'BA', 'BW', 'BR', 'BN', 'BG',
  'KH', 'CM', 'CA', 'CL', 'CN', 'CO', 'CR', 'HR', 'CY', 'CZ', 'DK', 'EC', 'EG', 'EE',
  'ET', 'FI', 'FR', 'GM', 'GE', 'DE', 'GH', 'GR', 'GG', 'HK', 'HU', 'ID', 'IQ', 'IE',
  'IM', 'IL', 'IT', 'CI', 'JM', 'JP', 'JE', 'JO', 'KZ', 'KE', 'KR', 'XK', 'KW', 'KG',
  'LA', 'LV', 'LB', 'LY', 'LT', 'LU', 'MO', 'MK', 'MG', 'MW', 'MY', 'MV', 'MT', 'MU',
  'MX', 'MN', 'ME', 'MA', 'MZ', 'MM', 'NA', 'NP', 'NL', 'NG', 'NO', 'OM', 'PK', 'PS',
  'PE', 'PH', 'PL', 'PT', 'QA', 'RO', 'RW', 'SA', 'SN', 'RS', 'SC', 'SL', 'SG', 'SK',
  'ZA', 'ES', 'LK', 'SE', 'CH', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TT', 'TN', 'TR',
  'UG', 'AE', 'GB', 'UY', 'UZ', 'VE', 'VN', 'YE', 'ZM', 'ZW',
]);

const IDP_IN_PERSON = new Set([
  'AR', 'AM', 'AU', 'AT', 'AZ', 'BH', 'BD', 'BT', 'BR', 'BG', 'KH', 'CA', 'CL', 'CN',
  'CO', 'CY', 'EC', 'EG', 'FJ', 'FR', 'PF', 'DE', 'GH', 'GR', 'HK', 'IN', 'ID', 'IQ',
  'IE', 'IT', 'JP', 'JO', 'KZ', 'KE', 'KR', 'KW', 'LA', 'LB', 'MY', 'MU', 'MX', 'MD',
  'MN', 'ME', 'NP', 'NL', 'NC', 'NZ', 'NG', 'OM', 'PK', 'PG', 'PE', 'PH', 'PL', 'PT',
  'QA', 'RO', 'SA', 'RS', 'SG', 'SB', 'ZA', 'ES', 'LK', 'CH', 'SY', 'TW', 'TJ', 'TH',
  'TO', 'TR', 'AE', 'UY', 'UZ', 'VU', 'VN',
]);

const BRITISH_COUNCIL_ONLINE = new Set(
  onlineAvailabilityJson.operators['British Council'],
);
const IDP_ONLINE = new Set(onlineAvailabilityJson.operators.IDP);

const BRITISH_COUNCIL_BOOKING_URL = 'https://ieltsregistration.britishcouncil.org/';
const BRITISH_COUNCIL_CHINA_BOOKING_URL = 'https://ielts.neea.cn/';
const IELTS_USA_BOOKING_URL = 'https://ieltsregistration.registration-ieltsusa.org/';
const IDP_BOOKING_URL = 'https://bxsearch.ielts.idp.com/';
const IDP_INDIA_BOOKING_URL = 'https://ieltsidpindia.com/registration/reg1';
const IDP_CHINA_BOOKING_URL = 'https://www.idpielts.cn/';
const BRITISH_COUNCIL_ONLINE_URL =
  'https://ieltsregistration.britishcouncil.org/online-exam-choose/';
const IDP_ONLINE_URL = 'https://book.ielts.idp.com/';

function sortedCountryOrRegionCodes(codes: Iterable<string>): string[] {
  return [...new Set(codes)].sort((a, b) =>
    countryName(a).localeCompare(countryName(b), 'en'),
  );
}

export function inPersonCountryOrRegionCodes(operator: Operator): string[] {
  if (operator === 'British Council') {
    return sortedCountryOrRegionCodes(BRITISH_COUNCIL_IN_PERSON);
  }
  if (operator === 'IDP') return sortedCountryOrRegionCodes(IDP_IN_PERSON);
  if (operator === 'IELTS USA') return ['US'];
  return [];
}

export function onlineCountryOrRegionCodes(operator: Operator): string[] {
  if (operator === 'British Council') {
    return sortedCountryOrRegionCodes(BRITISH_COUNCIL_ONLINE);
  }
  if (operator === 'IDP') return sortedCountryOrRegionCodes(IDP_ONLINE);
  return [];
}

export function allAvailableCountryOrRegionCodes(): string[] {
  return sortedCountryOrRegionCodes([
    ...BRITISH_COUNCIL_IN_PERSON,
    ...IDP_IN_PERSON,
    ...BRITISH_COUNCIL_ONLINE,
    ...IDP_ONLINE,
    'US',
  ]);
}

export function isInPersonTestAvailable(
  operator: Operator,
  countryOrRegion: string | null | undefined,
): boolean {
  if (!countryOrRegion) return false;
  const code = countryOrRegion.toUpperCase();
  if (operator === 'British Council') return BRITISH_COUNCIL_IN_PERSON.has(code);
  if (operator === 'IDP') return IDP_IN_PERSON.has(code);
  if (operator === 'IELTS USA') return code === 'US';
  return false;
}

export function testAvailabilityForCountryOrRegion(
  countryOrRegion: string | null | undefined,
): CountryOrRegionTestAvailability | null {
  if (!countryOrRegion) return null;
  const code = countryOrRegion.toUpperCase();
  const inPerson: AvailabilityLink<Operator>[] = [];
  const online: AvailabilityLink<IeltsOnlineOperator>[] = [];

  if (BRITISH_COUNCIL_IN_PERSON.has(code)) {
    inPerson.push({
      operator: 'British Council',
      url: code === 'CN' ? BRITISH_COUNCIL_CHINA_BOOKING_URL : BRITISH_COUNCIL_BOOKING_URL,
    });
  }
  if (IDP_IN_PERSON.has(code)) {
    inPerson.push({
      operator: 'IDP',
      url:
        code === 'CN'
          ? IDP_CHINA_BOOKING_URL
          : code === 'IN' || code === 'BT'
            ? IDP_INDIA_BOOKING_URL
            : IDP_BOOKING_URL,
    });
  }
  if (code === 'US') {
    inPerson.push({ operator: 'IELTS USA', url: IELTS_USA_BOOKING_URL });
  }
  if (BRITISH_COUNCIL_ONLINE.has(code)) {
    online.push({ operator: 'British Council', url: BRITISH_COUNCIL_ONLINE_URL });
  }
  if (IDP_ONLINE.has(code)) {
    online.push({ operator: 'IDP', url: IDP_ONLINE_URL });
  }

  if (inPerson.length === 0 && online.length === 0) return null;
  return { countryOrRegion: code, inPerson, online };
}
