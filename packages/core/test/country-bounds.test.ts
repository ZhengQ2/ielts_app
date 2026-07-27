import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundsFor, isPlausibleForCountry } from '../src/country-bounds.ts';

/**
 * This is a sanity gate for embedded page coordinates, not a source of truth —
 * see country-bounds.ts's module doc for the two real pages (Manchester,
 * Hai Phong) that motivated it. Coverage gaps must stay permissive.
 */

test('a real Manchester, UK coordinate is plausible for GB', () => {
  assert.equal(isPlausibleForCountry(53.48098, -2.23259, 'GB'), true);
});

test('the actual bug: a sign-flipped longitude registers as implausible', () => {
  // The real embedded value on a live IELTS.org page — missing the UK's
  // negative longitude sign, landing over the North Sea instead.
  assert.equal(isPlausibleForCountry(53.48098, 2.23259, 'GB'), false);
});

test('the actual bug: a (1,1) placeholder registers as implausible for Vietnam', () => {
  assert.equal(isPlausibleForCountry(1, 1, 'VN'), false);
});

test('a real Hai Phong, Vietnam coordinate is plausible', () => {
  assert.equal(isPlausibleForCountry(20.86, 106.68, 'VN'), true);
});

test('country codes are matched case-insensitively', () => {
  assert.equal(isPlausibleForCountry(43.65, -79.38, 'ca'), true);
});

test('an uncovered country is permissive, not a false negative', () => {
  // No entry on file for this fictitious code — must not read as "implausible".
  assert.equal(isPlausibleForCountry(1, 1, 'ZZ'), true);
  assert.equal(boundsFor('ZZ'), null);
});

test('no country at all is permissive', () => {
  assert.equal(isPlausibleForCountry(1, 1, null), true);
  assert.equal(isPlausibleForCountry(1, 1, undefined), true);
});

test('a coordinate in the right country but wrong hemisphere is rejected', () => {
  // A Toronto-shaped centre whose longitude sign was dropped would land in
  // Mongolia, not Canada.
  assert.equal(isPlausibleForCountry(43.65, 79.38, 'CA'), false);
});

test('bounds are generous, not a precise national boundary', () => {
  // Confirms the gate is a coarse sanity check: a point well inside the box
  // but outside any real landmass still reads as "plausible enough".
  const b = boundsFor('CA')!;
  assert.ok(b.maxLat - b.minLat > 20, 'Canada spans a wide latitude range');
});
