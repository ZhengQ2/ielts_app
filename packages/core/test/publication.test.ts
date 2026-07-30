import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPricedOffering,
  isDirectoryVisible,
} from '../src/publication.ts';

test('a centre with no available test type is not ordinarily publishable', () => {
  assert.equal(hasPricedOffering([]), false);
});

test('a centre whose test types are all unpriced is not ordinarily publishable', () => {
  assert.equal(hasPricedOffering([{ priceText: null }, { priceText: null }]), false);
});

test('one source-published fee makes a centre publishable even when parsing is deferred', () => {
  assert.equal(
    hasPricedOffering([
      { priceText: null },
      { priceText: 'Contact centre for fee' },
      { priceText: 'CAD 325' },
    ]),
    true,
  );
});

test('a curated future opening is visible despite having no published price', () => {
  assert.equal(
    isDirectoryVisible({
      isPublishable: false,
      futureOpening: {
        source: 'ielts_usa_network',
        sourceUrl: 'https://go.ieltsusa.org/TestCenterNetwork',
        sourceLabel: 'New Haven, CT',
      },
    }),
    true,
  );
  assert.equal(
    isDirectoryVisible({
      isPublishable: false,
    }),
    false,
  );
});
