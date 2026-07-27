import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryFromBookingUrl, countryFromPhone, resolveCountry } from '../src/country.ts';

/**
 * This is the fallback chain, consulted only for the rare slug that IELTS.org's
 * own /test-centres?country=<alpha3> listing does not cover — that listing (see
 * country-index.ts) is the authoritative source and identifies 94%+ of the
 * worldwide master before any of this runs.
 *
 * Deliberately absent: inferring country from currency. It cannot separate the
 * many countries sharing USD, EUR, AUD or ZAR, and an early version of this
 * fallback did exactly that and would have silently mis-assigned them.
 */

test('British Council booking links declare their country', () => {
  assert.equal(
    countryFromBookingUrl(
      'https://ieltsregistration.britishcouncil.org/ors/find-test?country=VN&location=123',
    ),
    'VN',
  );
});

test('IDP booking links carry no country', () => {
  // Generic across every IDP centre worldwide.
  assert.equal(
    countryFromBookingUrl('https://bxsearch.ielts.idp.com/wizard?utm_source=ielts.org'),
    null,
  );
});

test('malformed booking links do not throw', () => {
  assert.equal(countryFromBookingUrl('not a url'), null);
  assert.equal(countryFromBookingUrl(null), null);
});

test('the dialling prefix identifies the country', () => {
  assert.equal(countryFromPhone('+92 42 111236000'), 'PK');
  assert.equal(countryFromPhone('+966125551234'), 'SA');
  assert.equal(countryFromPhone('+61 3 9000 0000'), 'AU');
});

test('longer prefixes are matched before shorter ones that would shadow them', () => {
  // '96' (unassigned here) must not steal a match from '966' (Saudi Arabia).
  assert.equal(countryFromPhone('+966501234567'), 'SA');
});

test('shared prefixes are refused rather than guessed', () => {
  // +1 spans the US, Canada and much of the Caribbean.
  assert.equal(countryFromPhone('+14165551234'), null);
});

test('a domestic-format phone number identifies nothing', () => {
  assert.equal(countryFromPhone('4034414375'), null);
  assert.equal(countryFromPhone(null), null);
});

test('a parsed address outranks both inferences', () => {
  // Direct evidence about this address beats an inference about the centre.
  assert.equal(
    resolveCountry(
      'CA',
      'https://ieltsregistration.britishcouncil.org/ors/find-test?country=GB',
      '+44 20 7946 0000',
    ),
    'CA',
  );
});

test('the booking link outranks the phone prefix', () => {
  assert.equal(
    resolveCountry(null, 'https://ieltsregistration.britishcouncil.org/ors/find-test?country=OM', '+966501234567'),
    'OM',
  );
});

test('the phone prefix is the last resort', () => {
  assert.equal(resolveCountry(null, null, '+62211234567'), 'ID');
});

test('nothing identifiable stays null rather than being invented', () => {
  assert.equal(resolveCountry(null, null, '+14165551234'), null);
  assert.equal(resolveCountry(null, null, null), null);
});
