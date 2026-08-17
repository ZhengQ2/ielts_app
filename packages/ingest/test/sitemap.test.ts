import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRetryAfterMs } from '../src/fetcher.ts';
import {
  isTrustedSitemapIndexRedirect,
  isTrustedTestCentreSitemap,
} from '../src/sitemap.ts';

test('only expected HTTPS IELTS.org test-centre sitemap URLs are trusted', () => {
  assert.equal(
    isTrustedTestCentreSitemap(
      'https://ielts.org/sitemap-section-testCentres-p2.xml',
    ),
    true,
  );
  assert.equal(
    isTrustedTestCentreSitemap(
      'https://attacker.example/testcentres-p2.xml',
    ),
    false,
  );
  assert.equal(
    isTrustedTestCentreSitemap(
      'https://ielts.org.attacker.example/testcentres-p2.xml',
    ),
    false,
  );
  assert.equal(
    isTrustedTestCentreSitemap(
      'http://ielts.org/sitemap-section-testCentres-p2.xml',
    ),
    false,
  );
});

test('only numbered same-origin IELTS.org sitemap-index redirects are trusted', () => {
  assert.equal(
    isTrustedSitemapIndexRedirect('https://ielts.org/sitemaps-1-sitemap.xml'),
    true,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect('https://ielts.org/sitemaps-27-sitemap.xml'),
    true,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect('https://attacker.example/sitemaps-1-sitemap.xml'),
    false,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect(
      'https://ielts.org.attacker.example/sitemaps-1-sitemap.xml',
    ),
    false,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect('http://ielts.org/sitemaps-1-sitemap.xml'),
    false,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect('https://ielts.org/other-sitemap.xml'),
    false,
  );
  assert.equal(
    isTrustedSitemapIndexRedirect('https://ielts.org/sitemaps-1-sitemap.xml?next=1'),
    false,
  );
});

test('Retry-After parsing honors seconds and dates with a bounded wait', () => {
  const now = Date.parse('2026-08-17T09:00:00Z');
  assert.equal(parseRetryAfterMs('10', now), 10_000);
  assert.equal(parseRetryAfterMs('2026-08-17T09:00:12Z', now), 12_000);
  assert.equal(parseRetryAfterMs('600', now), 60_000);
  assert.equal(parseRetryAfterMs('invalid', now), null);
  assert.equal(parseRetryAfterMs(null, now), null);
});
