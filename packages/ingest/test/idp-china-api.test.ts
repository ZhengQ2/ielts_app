import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import test from 'node:test';
import {
  decryptIdpChinaEnvelope,
  decryptIdpChinaPayload,
} from '../src/idp-china-api.ts';
import {
  buildIdpChinaAvailabilitySnapshot,
  matchIdpChinaCentre,
  parseIdpChinaSessionPage,
} from '../src/idp-china-availability.ts';
import {
  matchIdpChinaProviderCentre,
  mergeIdpChinaProviderCentres,
  parseIdpChinaCentrePage,
} from '../src/idp-china-centres.ts';

const KEY = Buffer.from('065574e7ef3d92c579ffba093797b4f2', 'hex');
const IV = Buffer.from('7a6b964619a05e5ce5423608b7bf4e95', 'hex');

test('decrypts an IDP China SM4-CBC JSON payload', () => {
  const expected = {
    list: [
      {
        centerId: '42',
        centerEnName: 'IDP IELTS Example',
        state: 0,
      },
    ],
    total: 1,
  };
  const cipher = createCipheriv('sm4-cbc', KEY, IV);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(expected), 'utf8'),
    cipher.final(),
  ]).toString('hex');

  assert.deepEqual(decryptIdpChinaPayload(encrypted), expected);
  assert.deepEqual(
    decryptIdpChinaEnvelope({ code: 200, data: encrypted }),
    expected,
  );
});

test('rejects malformed or unsuccessful IDP China envelopes', () => {
  assert.throws(
    () => decryptIdpChinaPayload('not-hex'),
    /even-length hexadecimal/,
  );
  assert.throws(
    () => decryptIdpChinaEnvelope({ code: 402, data: '' }),
    /response code was 402/,
  );
});

const checkedAt = '2026-07-29T12:00:00.000Z';

function sessionPage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code: 200,
    msg: '查询成功',
    total: 1,
    rows: [
      {
        ID: 'session-1',
        centerId: 'provider-centre-1',
        centerEnName: 'IDP IELTS Guangzhou Tianhe Test Center',
        centerCnName: 'IDP雅思广州天河区考场',
        projectCode: '22',
        projectName: 'IELTS on Computer Academic',
        examTimeOrigin: '2026-08-04',
        examTime: '09:00 AM',
        participantsCount: '35',
        signUpCount: '4',
        fullyBooked: '0',
        ...overrides,
      },
    ],
  };
}

function chinaCentre(
  id = 'idp-ielts-china-guangzhou-tianhe',
  name = 'IDP IELTS China Guangzhou Tianhe',
) {
  return {
    id,
    name,
    operator: 'IDP' as const,
    bookingUrl: 'https://sign.idpielts.cn/kaoshibaoming/',
    address: {
      raw: 'Guangzhou Tianhe',
      lines: ['Guangzhou Tianhe'],
      city: 'Guangzhou',
      region: null,
      postcode: null,
      country: 'CN',
    },
    offerings: [
      {
        label: 'IELTS on Computer Academic',
        kind: 'academic' as const,
        module: 'academic' as const,
        category: 'standard' as const,
        format: 'computer_delivered' as const,
        priceText: 'CNY 1,890',
        parsedCurrency: 'CNY',
        parsedPrice: 1890,
        priceParseStatus: 'verified' as const,
      },
    ],
  };
}

test('parses exact IDP China session capacity and availability', () => {
  const parsed = parseIdpChinaSessionPage(sessionPage());
  assert.equal(parsed.total, 1);
  assert.deepEqual(parsed.sessions[0], {
    sessionId: 'session-1',
    centreId: 'provider-centre-1',
    centreEnglishName: 'IDP IELTS Guangzhou Tianhe Test Center',
    centreChineseName: 'IDP雅思广州天河区考场',
    projectCode: '22',
    projectName: 'IELTS on Computer Academic',
    testDate: '2026-08-04',
    timeText: '09:00 AM',
    capacity: 35,
    registrations: 4,
    fullyBooked: false,
  });

  const snapshot = buildIdpChinaAvailabilitySnapshot(
    parsed.sessions,
    [chinaCentre()],
    checkedAt,
  );
  assert.equal(snapshot.records[0]?.status, 'available');
  assert.equal(
    snapshot.records[0]?.centreId,
    'idp-ielts-china-guangzhou-tianhe',
  );
  assert.equal(
    snapshot.records[0]?.providerLocationLabel,
    'IDP IELTS Guangzhou Tianhe Test Center',
  );
});

test('does not trust translated provider names or overstate full sessions', () => {
  const parsed = parseIdpChinaSessionPage(
    sessionPage({ fullyBooked: '1', signUpCount: '35' }),
  );
  const snapshot = buildIdpChinaAvailabilitySnapshot(
    parsed.sessions,
    [chinaCentre()],
    checkedAt,
  );
  assert.equal(snapshot.records[0]?.status, 'session_published');
  assert.doesNotMatch(
    snapshot.records[0]?.providerLocationLabel ?? '',
    /[\u3400-\u9fff]/,
  );
});

test('keeps unsupported offerings and ambiguous centres fail-closed', () => {
  assert.throws(
    () =>
      parseIdpChinaSessionPage(
        sessionPage({ projectCode: '99', projectName: 'Unknown' }),
      ),
    /unsupported project 99/,
  );

  const parsed = parseIdpChinaSessionPage(sessionPage());
  const offering = buildIdpChinaAvailabilitySnapshot(
    parsed.sessions,
    [],
    checkedAt,
  ).records[0]!.offering;
  const match = matchIdpChinaCentre(
    'IDP IELTS Guangzhou Tianhe Test Center',
    offering,
    [
      chinaCentre('one'),
      chinaCentre('two'),
    ],
  );
  assert.equal(match.status, 'ambiguous');
  assert.equal(match.centreId, null);
});

function providerCentrePage(projectCode: string) {
  return parseIdpChinaCentrePage(
    {
      code: 200,
      total: 1,
      rows: [
        {
          kdId: 'provider-centre-1',
          kdCode: 'T10038',
          kdName: 'IDP雅思广州天河区考场',
          kdEName: 'IDP IELTS Guangzhou Tianhe Test Center',
          address: '广州市天河区龙口东横街28号丽柏国际酒店南塔22楼',
          addressEn:
            '22/F, South Tower, La Perle International Hotel, ' +
            'No. 28 Longkou East Cross Street, Tianhe District, Guangzhou',
          phone: '18024017361',
          postalCode: '510000',
          email: 'guangzhoutianhe@idpielts.cn',
          proId: '440000',
          cityId: '440100',
        },
      ],
    },
    projectCode,
  );
}

test('merges complete provider centre inventories across both projects', () => {
  const centres = mergeIdpChinaProviderCentres([
    providerCentrePage('22'),
    providerCentrePage('23'),
  ]);
  assert.equal(centres.length, 1);
  assert.deepEqual(centres[0]?.projectCodes, ['22', '23']);
  assert.equal(
    matchIdpChinaProviderCentre(centres[0]!, [chinaCentre()]).centreId,
    'idp-ielts-china-guangzhou-tianhe',
  );
});

test('does not confuse a new China district with a nearby fuzzy name', () => {
  const provider = providerCentrePage('22').centres[0]!;
  provider.englishName = 'IDP IELTS Shanghai Yangpu Test Center';
  const existing = chinaCentre(
    'idp-ielts-china-shanghai-xuhui',
    'IDP IELTS China Shanghai Xuhui',
  );
  existing.address.city = 'Shanghai';

  const match = matchIdpChinaProviderCentre(provider, [existing]);
  assert.equal(match.status, 'unmatched');
  assert.equal(match.centreId, null);
});

test('rejects partial or contradictory provider centre inventories', () => {
  const partial = providerCentrePage('22');
  partial.total = 2;
  assert.throws(
    () => mergeIdpChinaProviderCentres([partial]),
    /returned 1 of 2 centres/,
  );

  const changed = providerCentrePage('23');
  changed.centres[0]!.englishAddress = 'Different address';
  assert.throws(
    () =>
      mergeIdpChinaProviderCentres([
        providerCentrePage('22'),
        changed,
      ]),
    /metadata changed/,
  );
});
