import assert from 'node:assert/strict';
import test from 'node:test';
import { correctionReportUrl, genericCorrectionReportUrl } from '../src/corrections.ts';

test('centre correction reports are prefilled with identity, sources and review fields', () => {
  const url = new URL(
    correctionReportUrl({
      name: 'IDP IELTS China Guangzhou Tianhe',
      ieltsOrgSlug: 'idp-ielts-china-guangzhou-tianhe',
      sources: [
        {
          source: 'IELTS.org',
          externalSlug: 'idp-ielts-china-guangzhou-tianhe',
          url: 'https://ielts.org/test-centres/idp-ielts-china-guangzhou-tianhe',
          seenAt: '2026-07-27T00:00:00.000Z',
          stillPresent: true,
        },
      ],
    }),
  );

  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/ZhengQ2/ielts_app/issues/new');
  assert.equal(url.searchParams.get('title'), 'Centre correction: IDP IELTS China Guangzhou Tianhe');
  assert.match(url.searchParams.get('body') ?? '', /Opening status/);
  assert.match(url.searchParams.get('body') ?? '', /- \[ \] Address text/);
  assert.doesNotMatch(url.searchParams.get('body') ?? '', /Map location/);
  assert.doesNotMatch(url.searchParams.get('body') ?? '', /Exact location selected on map/);
  assert.match(
    url.searchParams.get('body') ?? '',
    /https:\/\/ielts\.zhengqiu\.net\/centres\/idp-ielts-china-guangzhou-tianhe\//,
  );
  assert.match(url.searchParams.get('body') ?? '', /### Evidence/);
});

test('location correction reports include the exact user-selected map coordinate', () => {
  const url = new URL(
    correctionReportUrl(
      {
        name: 'IDP IELTS China Guangzhou Tianhe',
        ieltsOrgSlug: 'idp-ielts-china-guangzhou-tianhe',
        sources: [
          {
            source: 'IELTS.org',
            externalSlug: 'idp-ielts-china-guangzhou-tianhe',
            url: 'https://ielts.org/test-centres/idp-ielts-china-guangzhou-tianhe',
            seenAt: '2026-07-27T00:00:00.000Z',
            stillPresent: true,
          },
        ],
      },
      {
        location: {
          lat: 23.12345678,
          lng: 113.98765432,
        },
      },
    ),
  );

  const body = url.searchParams.get('body') ?? '';
  assert.equal(
    url.searchParams.get('title'),
    'Centre location correction: IDP IELTS China Guangzhou Tianhe',
  );
  assert.match(body, /- \[x\] Map location/);
  assert.match(body, /- Latitude: 23\.123457/);
  assert.match(body, /- Longitude: 113\.987654/);
  assert.match(
    body,
    /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=23\.123457%2C113\.987654/,
  );
  assert.match(body, /IDP IELTS China Guangzhou Tianhe/);
  assert.match(body, /https:\/\/ielts\.org\/test-centres\/idp-ielts-china-guangzhou-tianhe/);
  assert.match(body, /### Evidence/);
});

test('generic correction reports ask for the centre and supporting evidence', () => {
  const url = new URL(genericCorrectionReportUrl());
  assert.equal(url.searchParams.get('title'), 'Centre correction: ');
  assert.match(url.searchParams.get('body') ?? '', /Add the centre name/);
  assert.match(url.searchParams.get('body') ?? '', /Address text/);
  assert.match(url.searchParams.get('body') ?? '', /exact-location picker/);
});
