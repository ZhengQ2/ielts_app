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

/**
 * Real page: an AEO Lahore Life Skills row booked through `ielts.idp.com` with
 * a `/book/UKVI?...` path, not through `bxsearch.ielts.idp.com/wizard`. This
 * page has NO academic/GT row at all — only Life Skills — so the fixture is
 * intentionally single-row rather than reusing IDP_PAGE's shape.
 */
const IDP_LIFE_SKILLS_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">AEO Lahore Life Skills</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>50 C III, Gulberg III</p><p>Lahore</p><p>Punjab</p><p>54660</p>
  </div>
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">IELTS Life Skills A1</h6>
      <span class="ielts-tests-available__test-row-svg"><svg aria-label="Test on paper"></svg></span>
      <p class="ielts-tests-available__test-row-price">PKR 22000</p>
    </div>
    <div class="button"><a href="https://ielts.idp.com/book/UKVI?countryId=157&amp;testCentreId=70&amp;testVenueId=565&amp;testModuleId=5&amp;isSELT=true&amp;lang=en&amp;utm_source=ielts.org&amp;utm_medium=referral"><span>Book A Test</span></a></div>
  </div>`);

/** Real page: an Ahmedabad centre booking through IDP's dedicated India site. */
const IDP_INDIA_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">Ahmedabad - West</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>Ahmedabad</p><p>Gujarat</p><p>380015</p>
  </div>
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">IELTS Academic on paper</h6>
      <span class="ielts-tests-available__test-row-svg"><svg aria-label="Test on paper"></svg></span>
      <p class="ielts-tests-available__test-row-price">INR 19,000.00</p>
    </div>
    <div class="button"><a href="https://ieltsidpindia.com/registration/reg1"><span>Book A Test</span></a></div>
  </div>`);

/** Real page: BITTS Atlanta booking through a domain distinct from ieltsusa.org. */
const IELTS_USA_ALT_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">British Council, BITTS Testing Services - Atlanta</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>1 Test St</p><p>Atlanta</p><p>GA</p><p>30301</p>
  </div>
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">Academic Test</h6>
      <span class="ielts-tests-available__test-row-svg"><svg aria-label="Test on computer"></svg></span>
      <p class="ielts-tests-available__test-row-price">USD 245</p>
    </div>
    <div class="button"><a href="https://ieltsregistration.registration-ieltsusa.org/?organization=BITTS_Testing_Services_Atlanta"><span>Book A Test</span></a></div>
  </div>`);

/**
 * A row with no CTA at all, on a page whose shared footer still carries the
 * bare `ielts.idp.com` link. Guards the thing that makes recognising that bare
 * domain safe: `extractOfferings` only ever calls `hrefs()` on a test-row div,
 * never on the whole page, so the footer's copy is unreachable from here.
 */
const NO_BOOKING_LINK_PAGE = page(`
  <h1 class="test-center-header__title font-main-h2">Archived Centre With No Booking Link</h1>
  <div class="col-lg-4 col-12 test-center-header__content-column">
    <h5 class="test-center-header__content-column-heading font-main">Address</h5>
    <p>1 Test St</p><p>Nowhere</p>
  </div>
  <div class="row ielts-tests-available__test-row">
    <div class="col-md-4 col-12">
      <h6 class="ielts-tests-available__test-row-title">Academic Test</h6>
      <p class="ielts-tests-available__test-row-price">USD 200</p>
    </div>
  </div>`);

const NOW = '2026-07-27T00:00:00.000Z';

test('a /book/UKVI path on bare ielts.idp.com is recognised as IDP', () => {
  const c = parseCentrePage('aeo-lahore-life-skills', IDP_LIFE_SKILLS_PAGE, NOW);
  assert.equal(c.operator, 'IDP');
  assert.equal(c.operatorSource, 'booking_domain');
});

test("IDP's separate India booking site is recognised as IDP", () => {
  const c = parseCentrePage('ahmedabad-west', IDP_INDIA_PAGE, NOW);
  assert.equal(c.operator, 'IDP');
  assert.equal(c.operatorSource, 'booking_domain');
});

test('registration-ieltsusa.org is recognised as IELTS USA, not missed as a stray domain', () => {
  const c = parseCentrePage('bitts-atlanta', IELTS_USA_ALT_PAGE, NOW);
  assert.equal(c.operator, 'IELTS USA');
  assert.equal(c.operatorSource, 'booking_domain');
});

test('a row with no CTA stays unknown even though the shared footer has ielts.idp.com', () => {
  // If href extraction ever stopped being row-scoped, this would wrongly
  // become IDP from the footer alone.
  const c = parseCentrePage('archived-centre', NO_BOOKING_LINK_PAGE, NOW);
  assert.equal(c.operator, 'unknown');
  assert.equal(c.bookingUrl, null);
});

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
