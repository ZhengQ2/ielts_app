import assert from 'node:assert/strict';
import { test } from 'node:test';
import { haversineKm, isPinnable, resolveGeo, scoreCandidate } from '../src/geo.ts';
import type { GeoCandidate } from '../src/geo.ts';

const YYC = { lat: 51.048, lng: -114.077 };

function candidate(over: Partial<GeoCandidate>): GeoCandidate {
  return {
    lat: YYC.lat,
    lng: YYC.lng,
    precision: 'rooftop',
    source: 'nominatim',
    echoedPostcode: null,
    echoedCity: null,
    echoedCountry: 'CA',
    ...over,
  };
}

test('haversine matches a known distance', () => {
  // Calgary to Edmonton is ~280 km.
  const d = haversineKm(YYC, { lat: 53.5461, lng: -113.4938 });
  assert.ok(d > 275 && d < 285, `expected ~280 km, got ${d}`);
});

test('a hit in the wrong country is rejected outright', () => {
  const score = scoreCandidate(candidate({ echoedCountry: 'US' }), { country: 'CA' });
  assert.equal(score, null);
});

test('a hit echoing a different postcode is rejected however precise it is', () => {
  // Real failure: searching "A1B 3X2, St Johns" returned a rooftop hit in
  // Prescott, Ontario echoing K0E 1T0, which won on precision and pinned a
  // Newfoundland centre 1,500 km away.
  const score = scoreCandidate(
    candidate({ precision: 'rooftop', echoedPostcode: 'K0E 1T0', echoedCity: 'Prescott' }),
    { country: 'CA', postcode: 'A1B 3X2', city: 'St Johns' },
  );
  assert.equal(score, null);
});

test('a matching city outweighs a wrong postcode on the source page', () => {
  // 3030 Lincoln Ave, Coquitlam is really V3B; its listing claims V3N. The
  // rooftop hit on the right street in the right city must still win.
  const score = scoreCandidate(
    candidate({ precision: 'rooftop', echoedPostcode: 'V3B 2H6', echoedCity: 'Coquitlam' }),
    { country: 'CA', postcode: 'V3N 2H6', city: 'Coquitlam' },
  );
  assert.ok(score !== null && score > 0);
});

test('neighbouring postcodes in the same area are not treated as conflicts', () => {
  const score = scoreCandidate(
    candidate({ precision: 'rooftop', echoedPostcode: 'A1B 9Z9' }),
    { country: 'CA', postcode: 'A1B 3X2' },
  );
  assert.ok(score !== null && score > 0);
});

test('the correct postcode hit survives when a wrong-region rival is rejected', () => {
  const geo = resolveGeo(
    [
      candidate({ precision: 'rooftop', echoedPostcode: 'K0E 1T0', lat: 44.71, lng: -75.52 }),
      candidate({ precision: 'postcode', echoedPostcode: 'A1B 3X2', lat: 47.556, lng: -52.768 }),
    ],
    { country: 'CA', postcode: 'A1B 3X2' },
  )!;
  assert.ok(Math.abs(geo.lat - 47.556) < 0.01, `expected St John's, got ${geo.lat}`);
});

test('echoed postcode and city each add to the score', () => {
  const bare = scoreCandidate(candidate({}), { country: 'CA' });
  const corroborated = scoreCandidate(
    candidate({ echoedPostcode: 'T2P 0T8', echoedCity: 'Calgary' }),
    { country: 'CA', postcode: 'T2P0T8', city: 'calgary' },
  );
  assert.ok(corroborated! > bare!);
});

test('a postcode hit in the right country beats a rooftop hit in the wrong one', () => {
  const geo = resolveGeo(
    [
      candidate({ precision: 'rooftop', echoedCountry: 'US', lat: 40, lng: -74 }),
      candidate({ precision: 'postcode', echoedCountry: 'CA' }),
    ],
    { country: 'CA' },
  );
  assert.equal(geo?.precision, 'postcode');
});

test('agreeing lookups raise confidence', () => {
  const apart = resolveGeo([candidate({})], { country: 'CA' })!;
  const together = resolveGeo(
    [candidate({}), candidate({ lat: YYC.lat + 0.0005, precision: 'street' })],
    { country: 'CA' },
  )!;
  assert.ok(together.confidence > apart.confidence);
});

test('diverging lookups are capped at approximate', () => {
  const geo = resolveGeo(
    [
      candidate({ precision: 'rooftop' }),
      // ~350 km away — the disagreement is itself the signal.
      candidate({ precision: 'rooftop', lat: 53.5461, lng: -113.4938 }),
    ],
    { country: 'CA' },
  )!;
  assert.equal(geo.precision, 'approximate');
  assert.ok(geo.confidence <= 0.3);
  assert.equal(isPinnable(geo), false);
});

test('no candidates yields no location rather than a fabricated one', () => {
  assert.equal(resolveGeo([], { country: 'CA' }), null);
});
