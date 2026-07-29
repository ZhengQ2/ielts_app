import assert from 'node:assert/strict';
import test from 'node:test';
import { rawScoreInquiryUrl, resultPortalUrl } from '../src/after-test.ts';
import type { Centre } from '../src/types.ts';

function centre(
  operator: Centre['operator'],
  country: string,
  name = 'Example IELTS Centre',
): Pick<Centre, 'name' | 'operator' | 'address'> {
  return {
    name,
    operator,
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

test('British Council candidates in China use NEEA', () => {
  assert.equal(
    resultPortalUrl(centre('British Council', 'CN')),
    'https://ielts.neea.cn/login',
  );
});

test('IDP candidates use the country-specific India and China portals', () => {
  assert.equal(
    resultPortalUrl(centre('IDP', 'IN')),
    'https://www.ieltsidpindia.com/access/candidatelogin',
  );
  assert.equal(
    resultPortalUrl(centre('IDP', 'CN')),
    'https://sign.idpielts.cn/personal-test',
  );
  assert.equal(
    resultPortalUrl(centre('IDP', 'CA')),
    'https://ielts.idp.com/results/check-your-result',
  );
});

test('IELTS USA has its own Test Taker Portal', () => {
  assert.equal(
    resultPortalUrl(centre('IELTS USA', 'US')),
    'https://ieltsregistration.registration-ieltsusa.org/ttp',
  );
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
