import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAddress, streetLine } from '../src/address.ts';

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

test('unpostcoded foreign address degrades without inventing a country or city', () => {
  const a = parseAddress(['KFUPM square', 'Alkhobar/Dammam']);
  assert.equal(a.country, null);
  assert.equal(a.postcode, null);
  assert.equal(a.city, null);
});

test('an Australian NT address is not mistaken for Northwest Territories', () => {
  // Real page: this landed in the Canadian dataset and put a pin in Darwin.
  const a = parseAddress([
    'Australian City International College, 25 Cavenagh St',
    'Darwin',
    'NT',
    '0800',
  ]);
  assert.notEqual(a.country, 'CA');
  assert.equal(a.city, null);
});

test('an authoritative country hint never enables the global last-line heuristic', () => {
  const a = parseAddress(
    ['Australian City International College, 25 Cavenagh St', 'Darwin', 'NT', '0800'],
    'AU',
  );
  assert.equal(a.country, 'AU');
  assert.equal(a.city, null);
});

test('the full province name is unambiguous even without a postcode', () => {
  const a = parseAddress(['1335 Matheson Blvd East', 'Mississauga', 'Ontario']);
  assert.equal(a.country, 'CA');
  assert.equal(a.region, 'ON');
});

test('a malformed Canadian postcode still resolves the country from the province', () => {
  // "M2N063" is a typo on the source page — it is not a valid postcode.
  const a = parseAddress(['4789 Yonge St Suite 508', 'North York', 'Ontario', 'M2N063']);
  assert.equal(a.country, 'CA');
  assert.equal(a.city, 'North York');
});

test('a five-digit street number is not a US ZIP', () => {
  // This stole the postcode slot, leaving the real postcode to become the city.
  const a = parseAddress(['14505 Bannister Rd SE #101', 'Calgary', 'AB', 'T2X 3J3']);
  assert.equal(a.postcode, 'T2X 3J3');
  assert.equal(a.city, 'Calgary');
  assert.equal(a.country, 'CA');
});

test('a repeated postcode never becomes the city', () => {
  const a = parseAddress(['155 Skinner St #101', 'Nanaimo, BC V9R 5E8', 'Nanaimo', 'BC', 'V9R 5E8']);
  assert.equal(a.city, 'Nanaimo');
  assert.equal(a.postcode, 'V9R 5E8');
});

test('a postcode embedded in the street line does not displace the city', () => {
  const a = parseAddress([
    'Assiniboine Community College 1430 Victoria Ave East, R7A 2A9 Brandon',
    'Brandon',
    'Manitoba',
    'R7A 2A9',
  ]);
  assert.equal(a.city, 'Brandon');
  assert.equal(a.region, 'MB');
});

test('a genuine US address still parses', () => {
  const a = parseAddress(['1600 Amphitheatre Pkwy', 'Mountain View', 'CA 94043']);
  assert.equal(a.postcode, '94043');
  assert.equal(a.country, 'US');
});

test('postcode without a space is normalised', () => {
  assert.equal(parseAddress(['1 Main St', 'Halifax', 'B3H4R2']).postcode, 'B3H 4R2');
});

test('raw text is preserved verbatim as the source of truth', () => {
  const lines = ['Suite 5', 'Vancouver', 'BC', 'V6B 1A1'];
  assert.equal(parseAddress(lines).raw, 'Suite 5, Vancouver, BC, V6B 1A1');
  assert.deepEqual(parseAddress(lines).lines, lines);
});

/**
 * `streetLine` feeds the geocoder's structured query. Every case below is a
 * real Canadian centre whose free-text lookup resolved no better than its city,
 * because unit and floor designators defeat free-text address parsing.
 */
test('strips unit and suite designators', () => {
  assert.equal(streetLine(['31 Pippy Place, Unit 3006', '3rd Floor']), '31 Pippy Place');
  assert.equal(streetLine(['980 W 1st St, Unit 106', 'North Vancouver']), '980 W 1st St');
  assert.equal(streetLine(['155 Skinner St #101', 'Nanaimo']), '155 Skinner St');
});

test('keeps the quadrant, which distinguishes real streets', () => {
  // Bannister Rd SE and Bannister Rd NW are different places in Calgary.
  assert.equal(streetLine(['14505 Bannister Rd SE #101', 'Calgary']), '14505 Bannister Rd SE');
  assert.equal(streetLine(['1803 91 St W, Unit 104', 'Edmonton']), '1803 91 St W');
});

test('prefers the line that actually carries the street', () => {
  assert.equal(
    streetLine(['Unit 210, Bentinck St Level', '500 George St', 'Sydney']),
    '500 George St',
  );
});

test('unwraps a unit number placed before the civic number', () => {
  assert.equal(streetLine(['Unit 208 - 4250 Kingsway', 'Burnaby']), '4250 Kingsway');
  assert.equal(
    streetLine(['Bld. 5, 110 - 13571 Commerce Parkway', 'Richmond']),
    '13571 Commerce Parkway',
  );
});

test('returns null when no line carries a civic number', () => {
  assert.equal(streetLine(['KFUPM square', 'Alkhobar/Dammam']), null);
});
