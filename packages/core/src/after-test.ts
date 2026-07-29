import type { Centre } from './types.ts';

type PortalCentre = Pick<Centre, 'operator' | 'address'>;
type InquiryCentre = Pick<Centre, 'name' | 'operator' | 'address'>;

const BRITISH_COUNCIL_RESULTS = 'https://ieltsregistration.britishcouncil.org/ttp';
const IDP_RESULTS = 'https://ielts.idp.com/results/check-your-result';
const IDP_INDIA_RESULTS = 'https://www.ieltsidpindia.com/access/candidatelogin';
const IELTS_USA_RESULTS = 'https://ieltsregistration.registration-ieltsusa.org/ttp';
const IDP_CHINA_RESULTS = 'https://sign.idpielts.cn/personal-test';
const BRITISH_COUNCIL_CHINA_RESULTS = 'https://ielts.neea.cn/login';
const BRITISH_COUNCIL_RAW_SCORE_FORM = 'https://forms.office.com/r/qj0ECRwGuD';
const IDP_PRIVACY_EMAIL = 'privacyofficer@idp.com';

/**
 * Candidate results portals vary by operator and, for IDP India and both
 * operators in China, by the country where the test was taken.
 */
export function resultPortalUrl(centre: PortalCentre): string | null {
  const country = centre.address.country?.toUpperCase();

  if (centre.operator === 'IELTS USA') return IELTS_USA_RESULTS;
  if (centre.operator === 'British Council') {
    return country === 'CN' ? BRITISH_COUNCIL_CHINA_RESULTS : BRITISH_COUNCIL_RESULTS;
  }
  if (centre.operator === 'IDP') {
    if (country === 'CN') return IDP_CHINA_RESULTS;
    if (country === 'IN') return IDP_INDIA_RESULTS;
    return IDP_RESULTS;
  }
  return null;
}

/**
 * British Council and IELTS USA use one request form. IDP asks candidates to
 * email its privacy office, so the mail link includes a fill-in template while
 * deliberately leaving all personal identifiers blank.
 */
export function rawScoreInquiryUrl(centre: InquiryCentre): string | null {
  if (centre.operator === 'British Council' || centre.operator === 'IELTS USA') {
    return BRITISH_COUNCIL_RAW_SCORE_FORM;
  }
  if (centre.operator !== 'IDP') return null;

  const subject = `IELTS raw score inquiry — ${centre.name}`;
  const body = [
    'Hello IDP Privacy Officer,',
    '',
    'I would like to request the raw scores recorded for my IELTS test.',
    '',
    'Full legal name:',
    'Candidate number:',
    'Test date (YYYY-MM-DD):',
    `Test centre: ${centre.name}`,
    `Country of test: ${centre.address.country ?? ''}`,
    'Test module (Academic / General Training / Life Skills):',
    'Test category (Standard IELTS / UKVI or SELT):',
    'Modules requested:',
    'Preferred contact email:',
    '',
    'Please let me know what identification or authorization you require to process this request.',
    '',
    'Kind regards,',
    '[Your name]',
  ].join('\n');

  return `mailto:${IDP_PRIVACY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
