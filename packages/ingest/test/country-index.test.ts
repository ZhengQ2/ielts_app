import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALPHA3_TO_ALPHA2,
  parseCentreSlugs,
  parseCountryOptions,
} from '../src/country-index.ts';

/**
 * Real IELTS.org listing pages have two <select> elements: a country dropdown
 * (three-letter codes) and a city dropdown (place names, filled in only once a
 * country is chosen). This fixture keeps that shape at a scale small enough to
 * read, since production pages carry 170+ country options.
 */
const LISTING_FIXTURE = `
<html><body>
  <select name="country">
    <option value="all">Select Country</option>
    <option value="alb">Albania</option>
    <option value="can">Canada</option>
    <option value="chn">China</option>
    ${Array.from(
      { length: 20 },
      (_, i) => `<option value="x${String.fromCharCode(97 + i)}x">Placeholder ${i}</option>`,
    ).join('')}
  </select>
  <select name="city">
    <option value="all">Select City</option>
    <option value="Tirana">Tirana</option>
  </select>
  <div class="results">
    <a href="https://ielts.org/test-centres/british-council-kullat-binjake">Kullat Binjake</a>
    <a href="/test-centres/another-centre">Another Centre</a>
  </div>
  <nav>
    <a href="/test-centres?country=can&city=all">Home breadcrumb (not a centre)</a>
    <a href="/test-centres">Bare listing link (not a centre)</a>
  </nav>
</body></html>`;

test('the country dropdown is told apart from the city dropdown', () => {
  const options = parseCountryOptions(LISTING_FIXTURE);
  // The placeholders push the count past the >20 threshold the same way real
  // country lists do. 'all' matches the three-letter filter too — real pages
  // carry it as "Select Country" — and is filtered downstream instead, against
  // ALPHA3_TO_ALPHA2 (see fetchCountryIndex's unmappedCodes).
  assert.ok(options.length > 20);
  assert.deepEqual(
    options.slice(0, 4),
    [
      { code3: 'all', name: 'Select Country' },
      { code3: 'alb', name: 'Albania' },
      { code3: 'can', name: 'Canada' },
      { code3: 'chn', name: 'China' },
    ],
  );
});

test('a listing with too few three-letter options is not mistaken for the country select', () => {
  const small = `<select><option value="all">Select City</option><option value="Tirana">Tirana</option></select>`;
  assert.deepEqual(parseCountryOptions(small), []);
});

test('centre slugs are extracted; the listing page itself is not one', () => {
  const slugs = parseCentreSlugs(LISTING_FIXTURE);
  assert.deepEqual([...slugs].sort(), ['another-centre', 'british-council-kullat-binjake']);
});

test('a bare "/test-centres" breadcrumb link is not read as a slug', () => {
  const html = `<a href="/test-centres">Test centres</a>`;
  assert.deepEqual(parseCentreSlugs(html), []);
});

test('the listing page\'s own query-string URL is not read as a slug', () => {
  const html = `<a href="https://ielts.org/test-centres?country=can&city=all">Canada</a>`;
  assert.deepEqual(parseCentreSlugs(html), []);
});

test('a percent-encoded slug is decoded', () => {
  const html = `<a href="/test-centres/institut-fran%C3%A7ais">Institut Français</a>`;
  assert.deepEqual(parseCentreSlugs(html), ['institut-français']);
});

test('every alpha-3 code maps to a two-letter code', () => {
  for (const [code3, code2] of Object.entries(ALPHA3_TO_ALPHA2)) {
    assert.match(code3, /^[a-z]{3}$/, `${code3} should be lowercase alpha-3`);
    assert.match(code2, /^[A-Z]{2}$/, `${code3} -> ${code2} should be uppercase alpha-2`);
  }
});

test('the major markets this project cares about resolve', () => {
  assert.equal(ALPHA3_TO_ALPHA2.can, 'CA');
  assert.equal(ALPHA3_TO_ALPHA2.usa, 'US');
  assert.equal(ALPHA3_TO_ALPHA2.gbr, 'GB');
  assert.equal(ALPHA3_TO_ALPHA2.chn, 'CN');
  assert.equal(ALPHA3_TO_ALPHA2.ind, 'IN');
});
