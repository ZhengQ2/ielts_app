import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isOsrDestinationCountryAllowed,
  osrDestinationCountry,
  osrEligibilityPolicy,
} from '../src/osr-eligibility.ts';

test('British Council OSR stays with British Council in the original country', () => {
  const policy = osrEligibilityPolicy('British Council');
  assert.equal(policy.portabilitySupported, true);
  assert.equal(policy.destinationOperator, 'British Council');
  assert.equal(policy.destinationCountryRule, 'same_country');
  assert.equal(osrDestinationCountry('British Council', 'CN', 'CA'), 'CN');
});

test('global IDP OSR exposes destinations outside separate portal countries', () => {
  const policy = osrEligibilityPolicy('IDP', 'CA');
  assert.equal(policy.portabilitySupported, true);
  assert.equal(policy.destinationOperator, 'IDP');
  assert.equal(policy.destinationCountryRule, 'any_country');
  assert.deepEqual(policy.excludedDestinationCountries, ['CN', 'IN', 'BT']);
  assert.equal(osrDestinationCountry('IDP', 'CA', ''), undefined);
  assert.equal(osrDestinationCountry('IDP', 'CA', 'SG'), 'SG');
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CA', 'SG'), true);
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CA', 'CN'), false);
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CA', 'IN'), false);
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CA', 'BT'), false);
});

test('IDP India system includes India and Bhutan but excludes other countries', () => {
  for (const country of ['IN', 'BT']) {
    const policy = osrEligibilityPolicy('IDP', country);
    assert.equal(policy.destinationCountryRule, 'country_group');
    assert.deepEqual(policy.allowedDestinationCountries, ['IN', 'BT']);
    assert.equal(osrDestinationCountry('IDP', country, ''), undefined);
    assert.equal(isOsrDestinationCountryAllowed('IDP', country, 'IN'), true);
    assert.equal(isOsrDestinationCountryAllowed('IDP', country, 'BT'), true);
    assert.equal(isOsrDestinationCountryAllowed('IDP', country, 'CA'), false);
  }
});

test('IDP mainland China remains inside its separate portal country', () => {
  const policy = osrEligibilityPolicy('IDP', 'CN');
  assert.equal(policy.destinationCountryRule, 'same_country');
  assert.equal(osrDestinationCountry('IDP', 'CN', 'CA'), 'CN');
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CN', 'CN'), true);
  assert.equal(isOsrDestinationCountryAllowed('IDP', 'CN', 'CA'), false);
});

test('IELTS USA original tests are currently unavailable for OSR', () => {
  const policy = osrEligibilityPolicy('IELTS USA');
  assert.equal(policy.portabilitySupported, false);
  assert.equal(policy.destinationOperator, null);
  assert.equal(policy.destinationCountryRule, null);
});
