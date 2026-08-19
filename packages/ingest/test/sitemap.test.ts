import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchText, parseRetryAfterMs, RequestGate } from '../src/fetcher.ts';
import {
  isTrustedSitemapIndexRedirect,
  isTrustedTestCentreSitemap,
  unionCentreDiscoverySlugs,
} from '../src/sitemap.ts';

test('centre discovery unions sitemap and country-listing slugs deterministically', () => {
  const discovery = unionCentreDiscoverySlugs(
    ['shared', 'sitemap-only', 'shared'],
    ['listing-z', 'shared', 'listing-a', 'listing-z'],
  );

  assert.deepEqual(discovery.slugs, [
    'shared',
    'sitemap-only',
    'listing-a',
    'listing-z',
  ]);
  assert.deepEqual(discovery.sitemapOnly, ['sitemap-only']);
  assert.deepEqual(discovery.listingOnly, ['listing-a', 'listing-z']);
});

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

test('request gate shares cooldowns and staggers concurrent workers', async () => {
  let now = 1_000;
  const sleeps: number[] = [];
  const gate = new RequestGate(
    250,
    () => now,
    async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  );

  await Promise.all([gate.waitTurn(), gate.waitTurn()]);
  gate.cooldown(1_000);
  await Promise.all([gate.waitTurn(), gate.waitTurn()]);

  assert.deepEqual(sleeps, [250, 1_000, 250]);
});

test('request gate honors a cooldown extended while a worker is waiting', async () => {
  let now = 1_000;
  const pendingSleeps: { ms: number; finish: () => void }[] = [];
  const gate = new RequestGate(
    250,
    () => now,
    (ms) =>
      new Promise<void>((resolve) => {
        pendingSleeps.push({
          ms,
          finish: () => {
            now += ms;
            resolve();
          },
        });
      }),
  );

  await gate.waitTurn();
  const waiting = gate.waitTurn();
  await Promise.resolve();
  assert.equal(pendingSleeps[0]?.ms, 250);

  gate.cooldown(1_000);
  pendingSleeps[0]!.finish();
  await Promise.resolve();
  assert.equal(pendingSleeps[1]?.ms, 750);
  pendingSleeps[1]!.finish();
  await waiting;
});

test('fetch timeout remains active while consuming a stalled response body', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener(
          'abort',
          () => {
            controller.error(
              Object.assign(new Error('stalled body aborted'), { permanent: true }),
            );
          },
          { once: true },
        );
      },
    });
    return new Response(body, { status: 200 });
  };

  const fetchResult = fetchText('https://example.test/stalled-body', {
    force: true,
    timeoutMs: 20,
  });
  const testDeadline = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('stalled body exceeded the test deadline')), 250);
  });

  await assert.rejects(Promise.race([fetchResult, testDeadline]), /stalled body aborted/);
});
