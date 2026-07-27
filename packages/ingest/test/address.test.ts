import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAddress } from '../src/address.ts';

/**
 * Every case here is a real address-block shape observed on IELTS.org. The
 * block is a bare list of `<p>` lines with no schema, so these lock in the
 * shapes that previously produced a wrong city ("3rd Floor") or none at all.
 */

test('canonical street / city / province / postcode', () => {
  const a = parseAddress(['Suite 1200 - 700 6 Ave SW', 'Calgary', 'Alberta', 'T2P 0T8']);
  assert.equal(a.city, 'Calgary');
  assert.equal(a.region, 'AB');
  assert.equal(a.postcode, 'T2P 0T8');
  assert.equal(a.country, 'CA');
});

test('extra floor line does not become the city', () => {
  const a = parseAddress(['31 Pippy Place, Unit 3006', '3rd Floor', 'St Johns (NL)', 'A1B3X2']);
  assert.equal(a.city, 'St Johns');
  assert.equal(a.region, 'NL');
  assert.equal(a.postcode, 'A1B 3X2');
});

test('two street lines still resolve the city', () => {
  const a = parseAddress(['Unit 210, Bentinck St Level', '500 George St', 'Sydney', 'B1P 1K6']);
  assert.equal(a.city, 'Sydney');
  assert.equal(a.postcode, 'B1P 1K6');
  assert.equal(a.country, 'CA');
});

test('city and province share a line', () => {
  const a = parseAddress(['100 Main St', 'Toronto, ON', 'M5V 1A1']);
  assert.equal(a.city, 'Toronto');
  assert.equal(a.region, 'ON');
});

test('explicit country line is consumed, not treated as a city', () => {
  const a = parseAddress(['1 King St W', 'Toronto', 'Ontario', 'M5H 1A1', 'Canada']);
  assert.equal(a.city, 'Toronto');
  assert.equal(a.country, 'CA');
});

test('unpostcoded foreign address degrades without inventing a country', () => {
  const a = parseAddress(['KFUPM square', 'Alkhobar/Dammam']);
  assert.equal(a.country, null);
  assert.equal(a.postcode, null);
  assert.equal(a.city, 'Alkhobar/Dammam');
});

test('postcode without a space is normalised', () => {
  assert.equal(parseAddress(['1 Main St', 'Halifax', 'B3H4R2']).postcode, 'B3H 4R2');
});

test('raw text is preserved verbatim as the source of truth', () => {
  const lines = ['Suite 5', 'Vancouver', 'BC', 'V6B 1A1'];
  assert.equal(parseAddress(lines).raw, 'Suite 5, Vancouver, BC, V6B 1A1');
  assert.deepEqual(parseAddress(lines).lines, lines);
});
