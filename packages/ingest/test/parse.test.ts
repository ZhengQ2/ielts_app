import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCentrePage } from '../src/parse.ts';

/**
 * Fixtures are trimmed from real pages, keeping the markup the parser depends
 * on. The footer links are included deliberately: every centre page links
 * `ielts.idp.com` and `takeielts.britishcouncil.org` in its footer, so a parser
 * that scans the whole document for a booking domain mislabels the operator.
 */

const FOOTER = `
  <footer>
    <a href="https://ielts.idp.com">IDP IELTS</a>
    <a href="https://takeielts.britishcouncil.org">British Council</a>
  </footer>`;

function page(body: string): string {
  return `<html><body>${body}${FOOTER}</body></html>`;
}

const IDP_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">Global Village Calgary</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>Suite 1200 - 700 6 Ave SW</p><p>Calgary</p><p>Alberta</p><p>T2P 0T8</p>
  </div>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Contact</h5>
    <div class="test-center-header__content-column-contact test-center-header__content-column-contact--phone">
      <svg aria-label=""><use xlink:href="#prefix__sprite-phone"></use></svg><p>4034414375</p>
    </div>
  </div>
  <img src="https://maps.googleapis.com/maps/api/staticmap?center=51.04804604507514,-114.07684357116459&amp;zoom=14" />
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">IELTS Academic on computer</h6>
      <span class="ielts-tests-available__test-row-svg"><svg aria-label="Test on computer"></svg></span>
      <p class="ielts-tests-available__test-row-price">CAD 359</p>
    </div>
    <div class="col-md-2"><h6 class="ielts-tests-available__test-row-title">Fee</h6>
      <p class="ielts-tests-available__test-row-price">CAD 359</p></div>
    <div class="button"><a href="https://bxsearch.ielts.idp.com/wizard?utm_source=ielts.org&amp;utm_medium=referral"><span>Book A Test</span></a></div>
  </div>`);

const BC_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">British Council, BITTS Central - BITTS Calgary</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>Unit 3424 25th St NE</p><p>Calgary</p><p>AB</p><p>T1Y 6C1</p>
  </div>
  <img src="https://maps.googleapis.com/maps/api/staticmap?center=51.0844413,-114.0028269&amp;zoom=14" />
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">Academic Test</h6>
      <span class="ielts-tests-available__test-row-svg"><svg aria-label="Test on computer"></svg></span>
      <p class="ielts-tests-available__test-row-price">CAD 346.5</p>
    </div>
    <div class="button"><a href="https://ieltsregistration.britishcouncil.org/ors/find-test?country=CA&amp;location=13163&amp;examType=ac&amp;examFormat=cd"><span>Book A Test</span></a></div>
  </div>`);

const NOW = '2026-07-27T00:00:00.000Z';

test('IDP page: operator from booking domain, no external id', () => {
  const c = parseCentrePage('global-village-calgary', IDP_PAGE, NOW);
  assert.equal(c.name, 'Global Village Calgary');
  assert.equal(c.operator, 'IDP');
  assert.equal(c.operatorSource, 'booking_domain');
  // IDP booking links are generic — there is no per-centre id to capture.
  assert.equal(c.externalId, null);
  assert.equal(c.phone, '4034414375');
  assert.deepEqual(c.embeddedGeo, { lat: 51.04804604507514, lng: -114.07684357116459 });
});

test('British Council page: location= captured as the external id', () => {
  const c = parseCentrePage('british-council-bitts-central-bitts-calgary', BC_PAGE, NOW);
  assert.equal(c.operator, 'British Council');
  assert.equal(c.operatorSource, 'booking_domain');
  assert.equal(c.externalId, '13163');
});

test('the footer never decides the operator', () => {
  // Both footer domains are present on this British Council page.
  const c = parseCentrePage('british-council-bitts-central-bitts-calgary', BC_PAGE, NOW);
  assert.notEqual(c.operator, 'IDP');
});

test('the "Fee" column is not mistaken for a test offering', () => {
  const c = parseCentrePage('global-village-calgary', IDP_PAGE, NOW);
  assert.equal(c.offerings.length, 1);
  assert.equal(c.offerings[0]?.label, 'IELTS Academic on computer');
  assert.equal(c.offerings[0]?.price, 359);
  assert.equal(c.offerings[0]?.currency, 'CAD');
});

test('format comes from the icon label when the title omits it', () => {
  const c = parseCentrePage('british-council-bitts-central-bitts-calgary', BC_PAGE, NOW);
  assert.equal(c.offerings[0]?.label, 'Academic Test');
  assert.equal(c.offerings[0]?.format, 'computer_delivered');
});

test('a page with no operator prefix still resolves its operator', () => {
  // `global-village-calgary` carries no operator hint in slug or heading.
  const c = parseCentrePage('global-village-calgary', IDP_PAGE, NOW);
  assert.equal(c.operator, 'IDP');
});

test('decimal prices survive parsing', () => {
  const c = parseCentrePage('bc', BC_PAGE, NOW);
  assert.equal(c.offerings[0]?.price, 346.5);
});
