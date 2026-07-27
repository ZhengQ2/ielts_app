import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, mergeOfferings, pickCanonical } from '../src/dedup.ts';
import type { ParsedCentre } from '../src/types.ts';

function address(street: string, city: string, region: string, postcode: string) {
  return {
    raw: `${street}, ${city}, ${region}, ${postcode}`,
    lines: [street, city, region, postcode],
    city,
    region,
    postcode,
    country: 'CA',
  };
}

function centre(over: Partial<ParsedCentre> & { slug: string }): ParsedCentre {
  return {
    url: `https://ielts.org/test-centres/${over.slug}`,
    name: 'Test Centre',
    operator: 'British Council',
    operatorSource: 'booking_domain',
    externalId: null,
    address: {
      raw: '1 Main St, Calgary, AB, T2P 0T8',
      lines: ['1 Main St', 'Calgary', 'AB', 'T2P 0T8'],
      city: 'Calgary',
      region: 'AB',
      postcode: 'T2P 0T8',
      country: 'CA',
    },
    phone: null,
    embeddedGeo: null,
    offerings: [],
    bookingUrl: null,
    fetchedAt: '2026-07-27T00:00:00.000Z',
    ...over,
  };
}

test('merges British Council pages sharing a location= id', () => {
  const { clusters } = dedupe([
    centre({ slug: 'bc-sydney-ns', externalId: '13776', name: 'BITTS Sydney' }),
    centre({ slug: 'bc-sydney-ns-different', externalId: '13776', name: 'BITTS Sydney NS' }),
  ]);
  assert.equal(clusters.length, 1);
});

test('merges the -2 duplicate-page pattern via the slug base', () => {
  const { clusters, links } = dedupe([
    centre({ slug: 'global-village-calgary' }),
    centre({ slug: 'global-village-calgary-2' }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(links[0]?.reason, 'slug_base');
});

test('never merges two centres with different location= ids', () => {
  // Same slug base and near-identical names, but the ids are real and differ.
  const { clusters } = dedupe([
    centre({ slug: 'bc-calgary', externalId: '13163', name: 'BITTS Calgary' }),
    centre({ slug: 'bc-calgary-2', externalId: '99999', name: 'BITTS Calgary' }),
  ]);
  assert.equal(clusters.length, 2);
});

test('merges IDP pages by name and postcode when no id exists', () => {
  const { clusters, links } = dedupe([
    centre({
      slug: 'idp-somewhere',
      operator: 'IDP',
      externalId: null,
      name: 'Global Village Calgary',
    }),
    centre({
      slug: 'another-page-entirely',
      operator: 'IDP',
      externalId: null,
      name: 'Global Village Calgary Centre',
    }),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(links[0]?.reason, 'name_postcode');
});

test('keeps unrelated centres at the same postcode apart', () => {
  // Both real Calgary centres, neither carrying an operator prefix in its slug.
  const { clusters } = dedupe([
    centre({ slug: 'global-village-calgary', name: 'Global Village Calgary' }),
    centre({ slug: 'ces-exams-calgary', name: 'CES Exams Calgary' }),
  ]);
  assert.equal(clusters.length, 2);
});

/**
 * The three cases below are real Canadian centres that an earlier, looser rule
 * merged together. Each is a distinct business at a distinct address.
 */
test('a near-identical name in the same city is not identity', () => {
  const { clusters } = dedupe([
    centre({
      slug: 'british-council-ilsc-vancouver-downtown',
      name: 'British Council, ILSC Vancouver Downtown',
      externalId: '2256',
      address: address('540 Seymour St', 'Vancouver', 'BC', 'V6B 3J5'),
    }),
    centre({
      slug: 'ilac-vancouver-downtown',
      name: 'ILAC - Vancouver Downtown',
      operator: 'IDP',
      address: address('688 W Hastings St, B20', 'Vancouver', 'BC', 'V6B 1P1'),
    }),
  ]);
  assert.equal(clusters.length, 2, 'ILSC and ILAC are different companies');
});

test('operators read from booking domains cannot disagree within a centre', () => {
  const { clusters } = dedupe([
    centre({ slug: 'x', name: 'Same Name Centre', operator: 'IDP' }),
    centre({ slug: 'x-2', name: 'Same Name Centre', operator: 'British Council' }),
  ]);
  assert.equal(clusters.length, 2);
});

test('one name being a subset of another is not a perfect match', () => {
  const { clusters } = dedupe([
    centre({
      slug: 'canada-college-mississauga',
      name: 'Canada College - Mississauga',
      operator: 'IDP',
      address: address('989 Derry Rd E, Suite 201', 'Mississauga', 'ON', 'L5T 2J8'),
    }),
    centre({
      slug: 'idp-ielts-canada-anderson-college-mississauga',
      name: 'IDP IELTS Canada - Anderson College Mississauga',
      operator: 'IDP',
      address: address('165 Dundas St W, Suite 300', 'Mississauga', 'ON', 'L5B 2N6'),
    }),
  ]);
  assert.equal(clusters.length, 2, 'Canada College is not Anderson College');
});

test('canonical record is the most complete page', () => {
  const sparse = centre({ slug: 'a-2' });
  const rich = centre({
    slug: 'a',
    embeddedGeo: { lat: 51, lng: -114 },
    phone: '4034414375',
    bookingUrl: 'https://ieltsregistration.britishcouncil.org/ors/find-test?location=1',
  });
  assert.equal(pickCanonical([sparse, rich]).slug, 'a');
});

test('offerings union across a cluster and keep the lower price', () => {
  const a = centre({
    slug: 'a',
    offerings: [
      { label: 'Academic Test', kind: 'academic', format: 'computer_delivered', currency: 'CAD', price: 380 },
    ],
  });
  const b = centre({
    slug: 'a-2',
    offerings: [
      { label: 'Academic Test', kind: 'academic', format: 'computer_delivered', currency: 'CAD', price: 359 },
      { label: 'General Training Test', kind: 'general_training', format: 'computer_delivered', currency: 'CAD', price: 359 },
    ],
  });
  const merged = mergeOfferings([a, b]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((o) => o.label === 'Academic Test')?.price, 359);
});
