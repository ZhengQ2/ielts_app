import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRITISH_COUNCIL_CHINA_MINI_PROGRAM_QR,
  rawScoreInquiryUrl,
  resultsActionLabel,
  resultPortalUrl,
  usesBritishCouncilChinaMiniProgram,
} from '../src/after-test.ts';
import type { Centre } from '../src/types.ts';

function centre(
  operator: Centre['operator'],
  country: string,
  name = 'Example IELTS Centre',
  offersOneSkillRetake = false,
): Pick<Centre, 'name' | 'operator' | 'address' | 'offersOneSkillRetake'> {
  return {
    name,
    operator,
    offersOneSkillRetake,
    address: {
      raw: '',
      lines: [],
      city: null,
      region: null,
      postcode: null,
      country,
    },
  };
}

test('British Council candidates use the Test Taker Portal', () => {
  assert.equal(
    resultPortalUrl(centre('British Council', 'CA')),
    'https://ieltsregistration.britishcouncil.org/ttp',
  );
});

test('British Council candidates in China retain NEEA as a browser fallback', () => {
  assert.equal(
    resultPortalUrl(centre('British Council', 'CN')),
    'https://ielts.neea.cn/login',
  );
});

test('British Council candidates in China receive the official WeChat mini-program option', () => {
  assert.equal(usesBritishCouncilChinaMiniProgram(centre('British Council', 'CN')), true);
  assert.equal(usesBritishCouncilChinaMiniProgram(centre('British Council', 'CA')), false);
  assert.equal(usesBritishCouncilChinaMiniProgram(centre('IDP', 'CN')), false);
  assert.equal(
    BRITISH_COUNCIL_CHINA_MINI_PROGRAM_QR,
    '/assets/bc-ielts-china-mini-program.png',
  );
});

test('IDP candidates use the India-system and China-specific portals', () => {
  assert.equal(
    resultPortalUrl(centre('IDP', 'IN')),
    'https://www.ieltsidpindia.com/access/candidatelogin',
  );
  assert.equal(
    resultPortalUrl(centre('IDP', 'BT')),
    'https://www.ieltsidpindia.com/access/candidatelogin',
  );
  assert.equal(
    resultPortalUrl(centre('IDP', 'CN')),
    'https://sign.idpielts.cn/personal-test',
  );
  assert.equal(
    resultPortalUrl(centre('IDP', 'CA')),
    'https://account.ielts.idp.com/',
  );
});

test('IELTS USA has its own Test Taker Portal', () => {
  assert.equal(
    resultPortalUrl(centre('IELTS USA', 'US')),
    'https://ieltsregistration.registration-ieltsusa.org/ttp',
  );
});

test('every results action includes One Skill Retake', () => {
  assert.equal(resultsActionLabel(), 'Results & One Skill Retake');
});

test('British Council and IELTS USA use the raw-score request form', () => {
  const form = 'https://forms.office.com/r/qj0ECRwGuD';
  assert.equal(rawScoreInquiryUrl(centre('British Council', 'CA')), form);
  assert.equal(rawScoreInquiryUrl(centre('IELTS USA', 'US')), form);
});

test('IDP gets a prefilled privacy-office email with blank personal fields', () => {
  const url = new URL(rawScoreInquiryUrl(centre('IDP', 'CA', 'Downtown Centre'))!);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, 'privacyofficer@idp.com');
  assert.match(url.searchParams.get('subject') ?? '', /Downtown Centre/);
  assert.match(url.searchParams.get('body') ?? '', /Candidate number:\n/);
  assert.match(url.searchParams.get('body') ?? '', /Test centre: Downtown Centre/);
});

test('unknown operators do not receive a potentially wrong after-test link', () => {
  assert.equal(resultPortalUrl(centre('unknown', 'CA')), null);
  assert.equal(rawScoreInquiryUrl(centre('unknown', 'CA')), null);
});
