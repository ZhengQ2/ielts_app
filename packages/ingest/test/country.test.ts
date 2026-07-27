import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryFromBookingUrl, countryFromCurrency, resolveCountry } from '../src/country.ts';

/**
 * The address parser only recognises CA/US shapes, which identified the country
 * for 9% of the worldwide master. These two fallbacks take that to 94%.
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

test('single-country currencies identify the market', () => {
  assert.equal(countryFromCurrency('CNY'), 'CN');
  assert.equal(countryFromCurrency('PKR'), 'PK');
  assert.equal(countryFromCurrency('cad'), 'CA');
});

test('multi-country currencies are refused rather than guessed', () => {
  // Assigning EUR to one country would misplace centres across the eurozone.
  assert.equal(countryFromCurrency('EUR'), null);
  assert.equal(countryFromCurrency('USD'), null);
  assert.equal(countryFromCurrency('XOF'), null);
});

test('a parsed address outranks both inferences', () => {
  // Direct evidence about this address beats an inference about the centre.
  assert.equal(
    resolveCountry('CA', 'https://ieltsregistration.britishcouncil.org/ors/find-test?country=GB', 'GBP'),
    'CA',
  );
});

test('the booking link outranks the currency', () => {
  assert.equal(
    resolveCountry(null, 'https://ieltsregistration.britishcouncil.org/ors/find-test?country=OM', 'AED'),
    'OM',
  );
});

test('currency is the last resort', () => {
  assert.equal(resolveCountry(null, null, 'IDR'), 'ID');
});

test('nothing identifiable stays null rather than being invented', () => {
  assert.equal(resolveCountry(null, null, 'EUR'), null);
  assert.equal(resolveCountry(null, null, null), null);
});
