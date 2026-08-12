import type { Centre } from './types.ts';

type PortalCentre = Pick<Centre, 'operator' | 'address'>;
type InquiryCentre = Pick<Centre, 'name' | 'operator' | 'address'>;

const BRITISH_COUNCIL_RESULTS = 'https://ieltsregistration.britishcouncil.org/ttp';
const IDP_RESULTS = 'https://account.ielts.idp.com/';
const IDP_INDIA_RESULTS = 'https://www.ieltsidpindia.com/access/candidatelogin';
const IELTS_USA_RESULTS = 'https://ieltsregistration.registration-ieltsusa.org/ttp';
const IDP_CHINA_RESULTS = 'https://sign.idpielts.cn/personal-test';
const BRITISH_COUNCIL_CHINA_RESULTS = 'https://ielts.neea.cn/login';
export const BRITISH_COUNCIL_CHINA_MINI_PROGRAM_QR =
  '/assets/bc-ielts-china-mini-program.png';
export const BRITISH_COUNCIL_CHINA_OSR_GUIDE =
  'https://www.chinaielts.org/book-ielts/one-skill-retake';
const BRITISH_COUNCIL_RAW_SCORE_FORM = 'https://forms.office.com/r/qj0ECRwGuD';
const IDP_PRIVACY_EMAIL = 'privacyofficer@idp.com';

/**
 * Mainland British Council candidates use the official WeChat mini-program
 * for their test record, results and One Skill Retake. NEEA remains available
 * as a browser-based result-service fallback.
 */
export function usesBritishCouncilChinaMiniProgram(centre: PortalCentre): boolean {
  return (
    centre.operator === 'British Council' && centre.address.country?.toUpperCase() === 'CN'
  );
}

/**
 * Candidate results portals vary by operator and, for the IDP India candidate
 * system (India and Bhutan) and both operators in China, by test country.
 */
export function resultPortalUrl(centre: PortalCentre): string | null {
  const country = centre.address.country?.toUpperCase();

  if (centre.operator === 'IELTS USA') return IELTS_USA_RESULTS;
  if (centre.operator === 'British Council') {
    return country === 'CN' ? BRITISH_COUNCIL_CHINA_RESULTS : BRITISH_COUNCIL_RESULTS;
  }
  if (centre.operator === 'IDP') {
    if (country === 'CN') return IDP_CHINA_RESULTS;
    if (country === 'IN' || country === 'BT') return IDP_INDIA_RESULTS;
    return IDP_RESULTS;
  }
  return null;
}

/** A result may remain OSR-eligible at another centre operated by the same provider. */
export function resultsActionLabel(): string {
  return 'Results & One Skill Retake';
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
    `Country or region of test: ${centre.address.country ?? ''}`,
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
