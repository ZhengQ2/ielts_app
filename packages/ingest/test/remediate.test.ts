import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Centre, ParsedCentre } from '@ielts-map/core';
import { GeocodeCache } from '../src/geocode.ts';
import { analyseCentreQuality } from '../src/quality.ts';
import { remediateCentres } from '../src/remediate.ts';

const generatedAt = '2026-07-28T00:00:00.000Z';

function centre(id: string): Centre {
  return {
    id,
    name: `Centre ${id}`,
    operator: 'IDP',
    operatorSource: 'booking_domain',
    externalId: null,
    ieltsOrgSlug: id,
    mergedSlugs: [],
    address: {
      raw: '1 Main Street, Toronto, ON, M5V 1A1',
      lines: ['1 Main Street', 'Toronto', 'ON', 'M5V 1A1'],
      city: 'Old Toronto',
      citySource: 'legacy',
      region: 'ON',
      postcode: 'M5V 1A1',
      country: 'CA',
    },
    contact: {
      phones: ['+1 416 555 0100'],
      emails: [],
      websites: [],
    },
    phone: '+1 416 555 0100',
    geo: {
      lat: 43.65,
      lng: -79.38,
      precision: 'street',
      source: 'google',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['address', 'venue_name'],
      agreementKm: 0.05,
      confidence: 0.8,
    },
    googlePlaceId: 'place-id',
    formats: ['computer_delivered'],
    offerings: [
      {
        label: 'IELTS Academic on computer',
        kind: 'academic',
        module: 'academic',
        category: 'standard',
        format: 'computer_delivered',
        priceText: 'CAD 359',
        parsedCurrency: 'CAD',
        parsedPrice: 359,
        priceParseStatus: 'verified',
      },
    ],
    priceFromText: 'CAD 359',
    parsedPriceFrom: 359,
    parsedCurrency: 'CAD',
    bookingUrl: 'https://bxsearch.ielts.idp.com/wizard',
    isPublishable: true,
    confidence: 0.9,
    sources: [
      {
        source: 'IELTS.org',
        externalSlug: id,
        url: `https://ielts.org/test-centres/${id}`,
        seenAt: generatedAt,
        stillPresent: true,
      },
    ],
    firstSeenAt: generatedAt,
    lastSeenAt: generatedAt,
  };
}

function parsed(id: string): ParsedCentre {
  const item = centre(id);
  return {
    slug: id,
    url: item.sources[0]!.url,
    name: item.name,
    operator: item.operator,
    operatorSource: item.operatorSource,
    externalId: null,
    address: {
      ...item.address,
      city: null,
      citySource: null,
    },
    contact: item.contact,
    phone: item.phone,
    embeddedGeo: null,
    offerings: item.offerings,
    bookingUrl: item.bookingUrl,
    fetchedAt: generatedAt,
  };
}

function analyses(centres: Centre[]) {
  return analyseCentreQuality(centres, {
    previous: null,
    pendingLinks: [],
    parseFailures: [],
    generatedAt,
    country: 'ALL',
  }).analyses;
}

test('a structured geocoder city replaces a legacy city after re-validation', async () => {
  const original = centre('legacy-city');
  const centres = [original];
  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [[parsed('legacy-city')]],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 10,
    enabled: true,
    resolve: async () => {
      const fixed = structuredClone(original);
      fixed.address.city = 'Toronto';
      fixed.address.citySource = 'geocoder';
      return fixed;
    },
  });

  assert.equal(report.accepted, 1);
  assert.equal(centres[0]?.address.city, 'Toronto');
  assert.equal(centres[0]?.address.citySource, 'geocoder');
  assert.equal(centres[0]?.priceFromText, 'CAD 359');
});

test('a moved but still-unverified location is ignored', async () => {
  const original = centre('weak-location');
  original.address.citySource = 'address_rule';
  original.geo = {
    ...original.geo!,
    verification: 'unverified',
    evidencePaths: ['address'],
    agreementKm: null,
    confidence: 0.4,
  };
  const originalLat = original.geo.lat;
  const centres = [original];
  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [[parsed('weak-location')]],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 10,
    enabled: true,
    resolve: async () => {
      const moved = structuredClone(original);
      moved.geo = { ...moved.geo!, lat: 44 };
      return moved;
    },
  });

  assert.equal(report.accepted, 0);
  assert.equal(report.unchanged, 1);
  assert.equal(centres[0]?.geo?.lat, originalLat);
});

test('a pinnable re-geocode that jumps implausibly far from the existing pin is rejected as a mismatch', async () => {
  const original = centre('implausible-jump');
  original.address.citySource = 'address_rule';
  original.geo = {
    ...original.geo!,
    verification: 'unverified',
    evidencePaths: ['address'],
    agreementKm: null,
    confidence: 0.4,
  };
  const originalGeo = original.geo;
  const centres = [original];
  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [[parsed('implausible-jump')]],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 10,
    enabled: true,
    resolve: async () => {
      const moved = structuredClone(original);
      // Montreal, ~500km from the Toronto fixture — a verified, pinnable
      // match, but far past a 'street' precision's refinement radius.
      moved.geo = {
        ...moved.geo!,
        lat: 45.5,
        lng: -73.6,
        verification: 'verified',
        evidencePaths: ['address', 'venue_name'],
        agreementKm: 0.05,
        confidence: 0.9,
      };
      return moved;
    },
  });

  assert.equal(report.accepted, 0);
  assert.equal(report.rejected, 1);
  assert.match(report.attempts[0]!.reason, /moved.*km from the existing coordinate/);
  assert.equal(centres[0]?.geo?.lat, originalGeo.lat);
});

test('an independently corroborated location repair is accepted', async () => {
  const original = centre('verified-repair');
  original.address.citySource = 'address_rule';
  original.geo = {
    ...original.geo!,
    verification: 'unverified',
    evidencePaths: ['address'],
    agreementKm: null,
    confidence: 0.4,
  };
  const centres = [original];
  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [[parsed('verified-repair')]],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 10,
    enabled: true,
    resolve: async () => {
      const fixed = structuredClone(original);
      fixed.geo = {
        ...fixed.geo!,
        lat: 43.651,
        verification: 'verified',
        evidencePaths: ['address', 'plus_code'],
        agreementKm: 0.03,
        confidence: 0.85,
      };
      return fixed;
    },
  });

  assert.equal(report.accepted, 1);
  assert.equal(centres[0]?.geo?.verification, 'verified');
  assert.deepEqual(centres[0]?.geo?.evidencePaths, [
    'address',
    'plus_code',
  ]);
});

test('the remediation limit bounds attempts and recurring source retries are counted', async () => {
  const first = centre('first');
  const second = centre('second');
  const centres = [first, second];
  let resolves = 0;
  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [[parsed('first')], [parsed('second')]],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [{ slug: 'stale-page', error: 'still broken' }],
    previousUnresolvedSlugs: ['stale-page'],
    limit: 1,
    enabled: true,
    resolve: async (cluster) => {
      resolves++;
      return centre(cluster[0]!.slug);
    },
  });

  assert.equal(resolves, 1);
  assert.equal(report.attempted, 1);
  assert.equal(report.skippedOverLimit, 1);
  assert.equal(report.unresolvedPagesRetried, 1);
});

test('bounded remediation prioritizes the country with the worst issue rate', async () => {
  const canadaWeak = centre('ca-weak');
  const canadaHealthy = centre('ca-healthy');
  canadaHealthy.address.citySource = 'address_rule';
  const omanWeak = centre('om-weak');
  omanWeak.address.country = 'OM';
  const centres = [canadaWeak, canadaHealthy, omanWeak];
  const resolvedIds: string[] = [];

  await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [
      [parsed('ca-weak')],
      [parsed('ca-healthy')],
      [
        {
          ...parsed('om-weak'),
          address: {
            ...parsed('om-weak').address,
            country: 'OM',
          },
        },
      ],
    ],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 1,
    enabled: true,
    resolve: async (cluster) => {
      resolvedIds.push(cluster[0]!.slug);
      return centre(cluster[0]!.slug);
    },
  });

  assert.deepEqual(resolvedIds, ['om-weak']);
});

test('pending duplicates gain structured evidence without being auto-merged', async () => {
  const left = centre('left-page');
  const right = centre('right-page');
  right.contact.phones = ['+1 (416) 555-0100'];
  right.phone = right.contact.phones[0]!;
  right.address.raw = '2 Main Street, Toronto, ON, M5V 1A1';
  right.address.lines[0] = '2 Main Street';
  const centres = [left, right];

  const report = await remediateCentres(centres, {
    analyses: analyses(centres),
    clusters: [],
    cache: new GeocodeCache({ disabled: true }),
    pendingLinks: [
      {
        a: 'left-page',
        b: 'right-page',
        reason: 'name_postcode',
        strength: 0.85,
        decision: 'pending',
      },
    ],
    parseFailures: [],
    previousUnresolvedSlugs: [],
    limit: 0,
    enabled: false,
  });

  assert.equal(report.pendingDuplicatesEvaluated, 1);
  assert.deepEqual(
    report.pendingDuplicateEvidence[0]?.sharedPhones,
    ['14165550100'],
  );
  assert.equal(
    report.pendingDuplicateEvidence[0]?.conclusion,
    'insufficient_identity_evidence',
  );
  assert.equal(centres.length, 2);
});
