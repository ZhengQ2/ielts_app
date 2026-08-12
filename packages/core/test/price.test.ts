import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublishedPrice } from '../src/price.ts';

test('published prices retain their source text and derive numeric fields', () => {
  assert.deepEqual(parsePublishedPrice('CAD 379'), {
    priceText: 'CAD 379',
    parsedCurrency: 'CAD',
    parsedPrice: 379,
    priceParseStatus: 'verified',
  });
  assert.deepEqual(parsePublishedPrice('AED ١٬٤٧٠'), {
    priceText: 'AED ١٬٤٧٠',
    parsedCurrency: 'AED',
    parsedPrice: 1470,
    priceParseStatus: 'verified',
  });
});

test('unsupported price text stays visible but is not treated as numeric', () => {
  assert.deepEqual(parsePublishedPrice('Contact centre for fee'), {
    priceText: 'Contact centre for fee',
    parsedCurrency: null,
    parsedPrice: null,
    priceParseStatus: 'unparsed',
  });
});
