import assert from 'node:assert/strict';
import test from 'node:test';
import { isTrustedTestCentreSitemap } from '../src/sitemap.ts';

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
