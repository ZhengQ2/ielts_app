import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dedupe,
  mergeContactInformation,
  mergeOfferings,
  pickCanonical,
} from '../src/dedup.ts';
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
    contact: { phones: [], emails: [], websites: [] },
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
  assert.equal(links[0]?.reason, 'operator_address');
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
    embeddedGeo: { lat: 51, lng: -114, coordinateSystem: 'unknown' },
    phone: '4034414375',
    bookingUrl: 'https://ieltsregistration.britishcouncil.org/ors/find-test?location=1',
  });
  assert.equal(pickCanonical([sparse, rich]).slug, 'a');
});

test('offering variants union under one centre without choosing a cheaper conflicting fee', () => {
  const a = centre({
    slug: 'a',
    offerings: [
      {
        label: 'Academic Test',
        kind: 'academic',
        format: 'computer_delivered',
        priceText: 'CAD 380',
        parsedCurrency: 'CAD',
        parsedPrice: 380,
        priceParseStatus: 'verified',
      },
    ],
  });
  const b = centre({
    slug: 'a-2',
    offerings: [
      {
        label: 'Academic Test',
        kind: 'academic',
        format: 'computer_delivered',
        priceText: 'CAD 359',
        parsedCurrency: 'CAD',
        parsedPrice: 359,
        priceParseStatus: 'verified',
      },
      {
        label: 'General Training Test',
        kind: 'general_training',
        format: 'computer_delivered',
        priceText: 'CAD 359',
        parsedCurrency: 'CAD',
        parsedPrice: 359,
        priceParseStatus: 'verified',
      },
    ],
  });
  const merged = mergeOfferings([a, b]);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged
      .filter((offering) => offering.kind === 'academic')
      .map((offering) => offering.priceText)
      .sort(),
    ['CAD 359', 'CAD 380'],
  );
});

test('explicit UKVI and source-labelled SELT offerings remain distinct', () => {
  const a = centre({
    slug: 'a',
    offerings: [
      {
        label: 'IELTS UKVI Academic on computer',
        kind: 'ukvi',
        format: 'computer_delivered',
        priceText: 'PKR 60500',
        parsedCurrency: 'PKR',
        parsedPrice: 60500,
        priceParseStatus: 'verified',
      },
    ],
  });
  const b = centre({
    slug: 'a-2',
    offerings: [
      {
        label: 'IELTS SELT Online AC',
        kind: 'other',
        format: 'computer_delivered',
        priceText: 'PKR 60500',
        parsedCurrency: 'PKR',
        parsedPrice: 60500,
        priceParseStatus: 'verified',
      },
    ],
  });

  assert.deepEqual(
    mergeOfferings([a, b]).map((offering) => offering.label),
    ['IELTS SELT Online AC', 'IELTS UKVI Academic on computer'],
  );
});

test('merged contacts preserve distinct values and collapse equivalent phone formatting', () => {
  const a = centre({
    slug: 'a',
    contact: {
      phones: ['+1 (403) 441-4375'],
      emails: ['Info@Example.com'],
      websites: ['https://example.com/centre/'],
    },
    phone: '+1 (403) 441-4375',
  });
  const b = centre({
    slug: 'a-2',
    contact: {
      phones: ['+1 403 441 4375', '+1 403 555 0100'],
      emails: ['info@example.com', 'support@example.com'],
      websites: ['https://example.com/centre', 'https://example.com/results'],
    },
    phone: '+1 403 441 4375',
  });

  assert.deepEqual(mergeContactInformation([a, b]), {
    phones: ['+1 (403) 441-4375', '+1 403 555 0100'],
    emails: ['Info@Example.com', 'support@example.com'],
    websites: ['https://example.com/centre/', 'https://example.com/results'],
  });
});
