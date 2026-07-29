import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre, GeoPrecision } from '@ielts-map/core';
import { localizeCentres } from '../src/localize.ts';
import { GeocodeCache, wgs84ToGcj02 } from '../src/geocode.ts';

function centre(country: 'CN' | 'IN', precision: GeoPrecision): Centre {
  return {
    id: `example-${country.toLowerCase()}`,
    name: 'Example Centre',
    operator: 'IDP',
    operatorSource: 'booking_domain',
    externalId: null,
    ieltsOrgSlug: `example-${country.toLowerCase()}`,
    mergedSlugs: [],
    address: {
      raw: 'Canonical English address',
      lines: ['Canonical English address'],
      city: null,
      region: null,
      postcode: null,
      country,
    },
    contact: { phones: [], emails: [], websites: [] },
    geo: {
      lat: country === 'CN' ? 39.908722 : 28.550847,
      lng: country === 'CN' ? 116.397499 : 77.268947,
      precision,
      source: 'google',
      coordinateSystem: 'WGS84',
      verification: 'verified',
      evidencePaths: ['address', 'venue_name'],
      agreementKm: 0.05,
      confidence: 1,
    },
    phone: null,
    googlePlaceId: null,
    formats: [],
    offerings: [],
    priceFromText: null,
    parsedPriceFrom: null,
    parsedCurrency: null,
    bookingUrl: null,
    isPublishable: true,
    confidence: 1,
    sources: [],
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('AMap adds a nearby Chinese POI without replacing canonical English text', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AMAP_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalKey);
  });
  process.env.AMAP_API_KEY = 'test-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v5/place/around');
    assert.equal(url.searchParams.get('key'), 'test-key');
    assert.equal(url.searchParams.get('keywords'), 'Example University');
    const expected = wgs84ToGcj02(39.908722, 116.397499);
    assert.equal(
      url.searchParams.get('location'),
      `${expected.lng.toFixed(6)},${expected.lat.toFixed(6)}`,
    );
    return Response.json({
      status: '1',
      pois: [
        {
          name: '示例考试中心',
          address: '东华门街道东长安街1号',
          distance: '125',
          type: '科教文化服务;学校;高等院校',
          pname: '北京市',
          cityname: '北京市',
          adname: '东城区',
        },
      ],
    });
  };

  const item = centre('CN', 'rooftop');
  item.name = 'Example University';
  const stats = await localizeCentres([item]);
  assert.equal(stats.updated, 1);
  assert.equal(item.address.raw, 'Canonical English address');
  assert.deepEqual(item.localizations, [
    {
      locale: 'zh-CN',
      name: null,
      address: '北京市东城区东华门街道东长安街1号',
      nameSource: null,
      addressSource: 'amap',
    },
  ]);
});

test('Mappls requests Hindi and preserves an existing reviewed local name', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });
  process.env.MAPPLS_API_KEY = 'test-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/search/address/rev-geocode');
    assert.equal(url.searchParams.get('lang'), 'hi');
    return Response.json({
      responseCode: 200,
      results: [{ formatted_address: 'ओखला औद्योगिक क्षेत्र, नई दिल्ली, भारत' }],
    });
  };

  const item = centre('IN', 'rooftop');
  item.localizations = [
    {
      locale: 'hi-IN',
      name: 'समीक्षित नाम',
      address: null,
      nameSource: 'admin',
      addressSource: null,
    },
  ];
  const stats = await localizeCentres([item]);
  assert.equal(stats.updated, 1);
  assert.equal(item.localizations[0]?.name, 'समीक्षित नाम');
  assert.equal(item.localizations[0]?.addressSource, 'mappls');
});

test('coarse pins are not reverse-geocoded into precise-looking addresses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error('fetch must not run');
  };

  const item = centre('CN', 'rooftop');
  item.geo!.precision = 'approximate';
  const stats = await localizeCentres([item]);
  assert.equal(stats.skippedCoarse, 1);
  assert.equal(item.localizations, undefined);
});

test('AMap rejects a same-city POI when the published street number disagrees', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AMAP_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalKey);
  });
  process.env.AMAP_API_KEY = 'test-key';
  globalThis.fetch = async () =>
    Response.json({
      status: '1',
      pois: [
        {
          name: '示例大学',
          address: '西三环北路105号',
          distance: '100',
          type: '科教文化服务;学校;高等院校',
          pname: '北京市',
          cityname: '北京市',
          adname: '海淀区',
        },
      ],
    });

  const item = centre('CN', 'rooftop');
  item.name = 'Example University';
  item.address.lines = ['83 Xi San Huan Bei Road', 'Beijing'];
  const stats = await localizeCentres([item]);
  assert.equal(stats.unmatched, 1);
  assert.equal(item.localizations, undefined);
});

test('Mappls rejects a Hindi address with a different postcode', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });
  process.env.MAPPLS_API_KEY = 'test-key';
  globalThis.fetch = async () =>
    Response.json({
      responseCode: 200,
      results: [
        {
          pincode: '110021',
          formatted_address: 'गलत स्थान, नई दिल्ली, भारत',
        },
      ],
    });

  const item = centre('IN', 'rooftop');
  item.address.postcode = '110020';
  const stats = await localizeCentres([item]);
  assert.equal(stats.unmatched, 1);
  assert.equal(item.localizations, undefined);
});

test('localization shares the AMap request ceiling and does not call over budget', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AMAP_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalKey);
  });
  process.env.AMAP_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new Error('fetch must not run after the AMap budget is exhausted');
  };

  const item = centre('CN', 'rooftop');
  item.name = 'Example University';
  const providerContext = new GeocodeCache({ amapBudget: 0 });
  const stats = await localizeCentres([item], { providerContext });

  assert.equal(stats.skippedBudget, 1);
  assert.equal(stats.failed, 0);
  assert.equal(providerContext.stats.amapCalls, 0);
  assert.equal(providerContext.stats.budgetSkips, 1);
  assert.equal(item.localizations, undefined);
});

test('localization shares the Mappls request ceiling and does not call over budget', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });
  process.env.MAPPLS_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new Error('fetch must not run after the Mappls budget is exhausted');
  };

  const item = centre('IN', 'rooftop');
  const providerContext = new GeocodeCache({ mapplsBudget: 0 });
  const stats = await localizeCentres([item], { providerContext });

  assert.equal(stats.skippedBudget, 1);
  assert.equal(stats.failed, 0);
  assert.equal(providerContext.stats.mapplsCalls, 0);
  assert.equal(providerContext.stats.budgetSkips, 1);
  assert.equal(item.localizations, undefined);
});
