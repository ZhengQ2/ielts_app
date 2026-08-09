import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amap,
  amapPlaces,
  fetchProviderResponse,
  gcj02ToWgs84,
  GeocodeCache,
  google,
  googlePlaces,
  localProviderFor,
  mappls,
  wgs84ToGcj02,
} from '../src/geocode.ts';
import {
  extractPlusCode,
  localRefinementRadiusKm,
} from '../src/resolve.ts';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('Google Places turns a venue-name search into structured location evidence', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('GOOGLE_MAPS_API_KEY', originalKey);
  });

  process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Goog-Api-Key'), 'test-google-key');
    assert.equal(
      headers.get('X-Goog-FieldMask'),
      'places.id,places.types,places.location,places.addressComponents',
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      textQuery: 'University IELTS Centre, Toronto, M5V 2T6, CA',
      pageSize: 3,
      languageCode: 'en',
      regionCode: 'CA',
    });
    return Response.json({
      places: [{
        id: 'place-123',
        types: ['university', 'point_of_interest'],
        location: { latitude: 43.6426, longitude: -79.3871 },
        addressComponents: [
          { longText: 'M5V 2T6', shortText: 'M5V 2T6', types: ['postal_code'] },
          { longText: 'Toronto', shortText: 'Toronto', types: ['locality'] },
          { longText: 'Ontario', shortText: 'ON', types: ['administrative_area_level_1'] },
          { longText: 'Canada', shortText: 'CA', types: ['country'] },
        ],
      }],
    });
  };

  const results = await googlePlaces.lookup({
    text: 'University IELTS Centre, Toronto, M5V 2T6, CA',
    country: 'CA',
  });

  assert.deepEqual(results, [{
    lat: 43.6426,
    lng: -79.3871,
    coordinateSystem: 'WGS84',
    precision: 'rooftop',
    echoedPostcode: 'M5V 2T6',
    echoedCity: 'Toronto',
    echoedRegion: 'Ontario',
    echoedCountry: 'CA',
    placeId: 'place-123',
  }]);
});

test('AMap maps a China POI and normalizes its coordinate to WGS-84', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AMAP_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalKey);
  });

  process.env.AMAP_API_KEY = 'test-amap-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://restapi.amap.com/v3/geocode/geo');
    assert.equal(url.searchParams.get('key'), 'test-amap-key');
    assert.equal(url.searchParams.get('city'), 'Beijing');
    return Response.json({
      status: '1',
      info: 'OK',
      geocodes: [
        {
          city: 'Beijing',
          location: '116.397499,39.908722',
          level: '兴趣点',
        },
      ],
    });
  };

  const results = await amap.lookup({
    structured: { street: 'Tiananmen', city: 'Beijing' },
    country: 'CN',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.precision, 'rooftop');
  assert.equal(results[0]?.echoedCity, 'Beijing');
  assert.equal(results[0]?.echoedCountry, 'CN');
  assert.ok((results[0]?.lng ?? 999) < 116.397499 - 0.001);
  assert.ok((results[0]?.lat ?? 999) < 39.908722);
});

test('China transform agrees with AMap official conversion and exactly round-trips', () => {
  // AMap's official GPS → AMap endpoint returned
  // 116.403999023438,39.914999186198 for this WGS-84 point.
  const wgs = { lng: 116.3977557546, lat: 39.9135962356 };
  const gcj = wgs84ToGcj02(wgs.lat, wgs.lng);
  assert.ok(Math.abs(gcj.lng - 116.403999023438) < 0.000002);
  assert.ok(Math.abs(gcj.lat - 39.914999186198) < 0.000002);

  const restored = gcj02ToWgs84(gcj.lat, gcj.lng);
  assert.ok(Math.abs(restored.lng - wgs.lng) < 1e-10);
  assert.ok(Math.abs(restored.lat - wgs.lat) < 1e-10);
});

test('AMap POI lookup uses transient Google Chinese text and returns only AMap data', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalAmapKey = process.env.AMAP_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalAmapKey);
    restoreEnv('GOOGLE_MAPS_API_KEY', originalGoogleKey);
  });

  process.env.AMAP_API_KEY = 'test-amap-key';
  process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.origin + url.pathname);
    if (url.hostname === 'places.googleapis.com') {
      assert.equal(url.pathname, '/v1/places/place-123');
      assert.equal(url.searchParams.get('languageCode'), 'zh-CN');
      assert.equal(url.searchParams.get('regionCode'), 'CN');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('X-Goog-Api-Key'), 'test-google-key');
      assert.equal(
        headers.get('X-Goog-FieldMask'),
        'displayName,addressComponents',
      );
      return Response.json({
        displayName: { text: '北京外国语大学' },
        addressComponents: [
          { longText: '北京市', shortText: '北京市', types: ['locality'] },
        ],
      });
    }

    assert.equal(url.origin + url.pathname, 'https://restapi.amap.com/v5/place/text');
    assert.equal(url.searchParams.get('key'), 'test-amap-key');
    assert.equal(url.searchParams.get('keywords'), '北京外国语大学');
    assert.equal(url.searchParams.get('region'), '北京市');
    assert.equal(url.searchParams.get('city_limit'), 'true');
    return Response.json({
      status: '1',
      info: 'OK',
      pois: [{
        name: '北京外国语大学',
        location: '116.310238,39.955164',
        cityname: '北京市',
        pname: '北京市',
        address: '西三环北路2号',
        type: '科教文化服务;学校;高等院校',
      }],
    });
  };

  const results = await amapPlaces.lookup({
    text: 'Beijing Foreign Studies University, Beijing, CN',
    country: 'CN',
    placeId: 'place-123',
  });

  assert.deepEqual(requests, [
    'https://places.googleapis.com/v1/places/place-123',
    'https://restapi.amap.com/v5/place/text',
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.echoedCity, '北京市');
  assert.equal(results[0]?.echoedCountry, 'CN');
  assert.equal(results[0]?.precision, 'rooftop');
  assert.ok((results[0]?.lng ?? 999) < 116.305);
});

test('Mappls resolves the best geocode eLoc through Place Details', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });

  process.env.MAPPLS_API_KEY = 'test-mappls-key';
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.origin + url.pathname);
    assert.equal(url.searchParams.get('access_token'), 'test-mappls-key');
    if (url.hostname === 'search.mappls.com') {
      assert.equal(url.searchParams.get('itemCount'), '1');
      return Response.json({
        copResults: {
          eLoc: 'TIYF9Q',
          city: 'New Delhi',
          pincode: '110020',
          geocodeLevel: 'houseNumber',
        },
      });
    }
    assert.equal(url.pathname, '/O2O/entity/place-details/TIYF9Q');
    return Response.json({
      latitude: 28.550847,
      longitude: 77.268947,
      type: 'HOUSE_NUMBER',
    });
  };

  const results = await mappls.lookup({
    text: '237 Okhla Industrial Estate Phase 3, New Delhi, 110020',
    country: 'IN',
  });

  assert.deepEqual(requests, [
    'https://search.mappls.com/search/address/geocode',
    'https://place.mappls.com/O2O/entity/place-details/TIYF9Q',
  ]);
  assert.deepEqual(results, [
    {
      lat: 28.550847,
      lng: 77.268947,
      coordinateSystem: 'WGS84',
      precision: 'rooftop',
      echoedPostcode: '110020',
      echoedCity: 'New Delhi',
      echoedRegion: null,
      echoedCountry: 'IN',
    },
  ]);
});

test('Mappls reports a missing Location Coordinates entitlement instead of caching no result', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });

  process.env.MAPPLS_API_KEY = 'test-mappls-key';
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'search.mappls.com') {
      return Response.json({
        copResults: {
          eLoc: 'EHDR10',
          city: 'Noida',
          pincode: '201301',
          geocodeLevel: 'poi',
        },
      });
    }
    return Response.json({ address: 'Sector 18, Noida', name: 'Som Datt Tower', eloc: 'EHDR10' });
  };

  await assert.rejects(
    mappls.lookup({ text: 'Som Datt Tower, Sector 18, Noida', country: 'IN' }),
    /enable that subtemplate/,
  );
});

test('AMap request budget stops further HTTP calls once exhausted', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.AMAP_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('AMAP_API_KEY', originalKey);
  });

  process.env.AMAP_API_KEY = 'test-amap-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      status: '1',
      info: 'OK',
      geocodes: [{ city: 'Beijing', location: '116.397499,39.908722', level: '兴趣点' }],
    });
  };

  const cache = new GeocodeCache({ amapBudget: 1 });
  const first = await cache.lookup(amap, {
    structured: { street: 'A', city: 'Beijing' },
    country: 'CN',
  });
  const second = await cache.lookup(amap, {
    structured: { street: 'B', city: 'Beijing' },
    country: 'CN',
  });
  const repeated = await cache.lookup(amap, {
    structured: { street: 'B', city: 'Beijing' },
    country: 'CN',
  });

  assert.equal(first.length, 1);
  assert.deepEqual(second, []);
  assert.deepEqual(repeated, []);
  assert.equal(calls, 1);
  assert.equal(cache.stats.cacheHits, 0);
  assert.equal(cache.stats.budgetSkips, 2);
});

test('Mappls request budget blocks the Place Details follow-up once exhausted', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });

  process.env.MAPPLS_API_KEY = 'test-mappls-key';
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.origin + url.pathname);
    return Response.json({
      copResults: {
        eLoc: 'TIYF9Q',
        city: 'New Delhi',
        pincode: '110020',
        geocodeLevel: 'houseNumber',
      },
    });
  };

  const cache = new GeocodeCache({ mapplsBudget: 1 });
  const result = await cache.lookup(mappls, {
    text: '237 Okhla Industrial Estate Phase 3, New Delhi, 110020',
    country: 'IN',
  });
  const repeated = await cache.lookup(mappls, {
    text: '237 Okhla Industrial Estate Phase 3, New Delhi, 110020',
    country: 'IN',
  });

  assert.deepEqual(result, []);
  assert.deepEqual(repeated, []);
  assert.deepEqual(requests, ['https://search.mappls.com/search/address/geocode']);
  assert.equal(cache.stats.cacheHits, 0);
  assert.equal(cache.stats.budgetSkips, 2);
});

test('Mappls retries cannot exceed the request budget', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MAPPLS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('MAPPLS_API_KEY', originalKey);
  });

  process.env.MAPPLS_API_KEY = 'test-mappls-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    return Response.json({
      copResults: {
        latitude: 28.5355,
        longitude: 77.391,
        city: 'Noida',
        pincode: '201301',
        geocodeLevel: 'houseNumber',
      },
    });
  };

  const cache = new GeocodeCache({ mapplsBudget: 1 });
  const result = await cache.lookup(mappls, {
    text: 'Sector 18, Noida, 201301',
    country: 'IN',
  });

  assert.deepEqual(result, []);
  assert.equal(calls, 1);
  assert.equal(cache.stats.mapplsCalls, 1);
  assert.equal(cache.stats.budgetSkips, 1);
  assert.equal(cache.stats.cacheHits, 0);
});

test('Google retries cannot exceed the physical request budget', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('GOOGLE_MAPS_API_KEY', originalKey);
  });

  process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    return Response.json({ status: 'ZERO_RESULTS', results: [] });
  };

  const cache = new GeocodeCache({ googleBudget: 1 });
  const result = await cache.lookup(google, {
    text: '1 Test Street, Toronto',
    country: 'CA',
  });

  assert.deepEqual(result, []);
  assert.equal(calls, 1);
  assert.equal(cache.stats.googleCalls, 1);
  assert.equal(cache.stats.budgetSkips, 1);
});

test('empty provider results expire instead of becoming permanent', async () => {
  let calls = 0;
  const emptyProvider = {
    name: 'nominatim' as const,
    async lookup() {
      calls++;
      return [];
    },
  };
  const cache = new GeocodeCache({ emptyResultTtlMs: 0 });

  await cache.lookup(emptyProvider, { text: 'Missing venue', country: 'CA' });
  await cache.lookup(emptyProvider, { text: 'Missing venue', country: 'CA' });

  assert.equal(calls, 2);
  assert.equal(cache.stats.cacheHits, 0);
});

test('local providers are gated by both country and configured key', (t) => {
  const originalAmap = process.env.AMAP_API_KEY;
  const originalMappls = process.env.MAPPLS_API_KEY;
  t.after(() => {
    restoreEnv('AMAP_API_KEY', originalAmap);
    restoreEnv('MAPPLS_API_KEY', originalMappls);
  });

  delete process.env.AMAP_API_KEY;
  delete process.env.MAPPLS_API_KEY;
  assert.equal(localProviderFor('CN'), null);
  assert.equal(localProviderFor('IN'), null);

  process.env.AMAP_API_KEY = 'configured';
  process.env.MAPPLS_API_KEY = 'configured';
  assert.equal(localProviderFor('CN')?.name, 'amap');
  assert.equal(localProviderFor('IN')?.name, 'mappls');
  assert.equal(localProviderFor('CA'), null);
});

test('local refinement distance is strict for street matches and regional for coarse matches', () => {
  assert.equal(localRefinementRadiusKm('rooftop'), 25);
  assert.equal(localRefinementRadiusKm('street'), 5);
  assert.equal(localRefinementRadiusKm('city'), 100);
  assert.equal(localRefinementRadiusKm('approximate'), 100);
});

test('published Plus Codes are extracted as independent location evidence', () => {
  assert.equal(
    extractPlusCode(
      'Office C-13, Al-Fazary Square, MJMF+RJ Al Safarat, Riyadh',
    ),
    'MJMF+RJ',
  );
  assert.equal(
    extractPlusCode('Gold Coast Club, R69F+63X, Punjab 142001'),
    'R69F+63X',
  );
  assert.equal(extractPlusCode('1 Main Street, Toronto'), null);
});

test('transient provider transport failures are retried', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('temporary network failure');
    return Response.json({ ok: true });
  };

  const response = await fetchProviderResponse('https://example.com/provider');
  assert.equal(response.ok, true);
  assert.equal(calls, 2);
});
