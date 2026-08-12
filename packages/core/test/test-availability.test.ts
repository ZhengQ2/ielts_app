import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allAvailableCountryOrRegionCodes,
  inPersonCountryOrRegionCodes,
  isInPersonTestAvailable,
  onlineCountryOrRegionCodes,
  testAvailabilityForCountryOrRegion,
} from '../src/test-availability.ts';
import { countryName } from '../src/country-names.ts';

test('country or region availability is ordered by display name', () => {
  const codes = allAvailableCountryOrRegionCodes();
  const names = codes.map(countryName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')));
});

test('operator in-person lists follow the supplied availability table', () => {
  assert.equal(isInPersonTestAvailable('British Council', 'IN'), false);
  assert.equal(isInPersonTestAvailable('IDP', 'IN'), true);
  assert.equal(isInPersonTestAvailable('IDP', 'BT'), true);
  assert.equal(isInPersonTestAvailable('British Council', 'US'), false);
  assert.equal(isInPersonTestAvailable('IELTS USA', 'US'), true);
  assert.deepEqual(inPersonCountryOrRegionCodes('IELTS USA'), ['US']);
});

test('Bhutan uses the IELTS IDP India booking service', () => {
  const availability = testAvailabilityForCountryOrRegion('BT');
  assert.deepEqual(availability?.inPerson, [
    { operator: 'IDP', url: 'https://ieltsidpindia.com/registration/reg1' },
  ]);
});

test('online-only regions remain discoverable without inventing centres', () => {
  const availability = testAvailabilityForCountryOrRegion('AG');
  assert.deepEqual(availability?.inPerson, []);
  assert.deepEqual(availability?.online, [
    {
      operator: 'British Council',
      url: 'https://ieltsregistration.britishcouncil.org/online-exam-choose/',
    },
  ]);
});

test('operator online lists include online-only markets', () => {
  assert.equal(onlineCountryOrRegionCodes('British Council').includes('AG'), true);
  assert.equal(inPersonCountryOrRegionCodes('British Council').includes('AG'), false);
  assert.equal(onlineCountryOrRegionCodes('IDP').includes('BE'), true);
  assert.equal(inPersonCountryOrRegionCodes('IDP').includes('BE'), false);
  assert.deepEqual(onlineCountryOrRegionCodes('IELTS USA'), []);
});

test('a country can expose both IELTS Online providers independently', () => {
  const availability = testAvailabilityForCountryOrRegion('AT');
  assert.deepEqual(
    availability?.online.map(({ operator }) => operator),
    ['British Council', 'IDP'],
  );
});

test('current IELTS.org assigns Hong Kong and Philippines Online to British Council', () => {
  for (const country of ['HK', 'PH']) {
    assert.deepEqual(
      testAvailabilityForCountryOrRegion(country)?.online.map(({ operator }) => operator),
      ['British Council'],
    );
  }
});
