import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe, mergeOfferings, pickCanonical } from '../src/dedup.ts';
import type { ParsedCentre } from '../src/types.ts';

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
