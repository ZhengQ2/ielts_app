import assert from 'node:assert/strict';
import test from 'node:test';
import type { Centre } from '@ielts-map/core';
import {
  buildIdpGlobalAvailabilitySnapshot,
  matchIdpGlobalCentre,
  parseIdpGlobalSearchCapture,
} from '../src/idp-global-availability.ts';

const checkedAt = '2026-07-29T20:00:00.000Z';
const sourceUrl =
  'https://api.session-search.prod.ielts.com/v2/sessions/search';

function centre(
  id: string,
  name: string,
  address: string,
  bookingUrl = 'https://bxsearch.ielts.idp.com/wizard',
): Pick<
  Centre,
  'id' | 'name' | 'address' | 'operator' | 'bookingUrl' | 'offerings' | 'geo'
> {
  return {
    id,
    name,
    address: {
      raw: address,
      lines: [address],
      city: 'Melbourne',
      region: 'Victoria',
      postcode: '3000',
      country: 'AU',
    },
    operator: 'IDP',
    bookingUrl,
    offerings: [
      {
        label: 'IELTS Academic on computer',
        kind: 'academic',
        module: 'academic',
        category: 'standard',
        format: 'computer_delivered',
        priceText: 'AUD 490',
        parsedCurrency: 'AUD',
        parsedPrice: 490,
        priceParseStatus: 'verified',
      },
    ],
    geo: null,
  };
}

function providerResponse(): unknown {
  return {
    page: 1,
    pageSize: 25,
    totalCount: 1,
    testLocations: [
      {
        id: 'location-1',
        latitude: -37.814289,
        longitude: 144.960802,
        name: 'IDP IELTS Melbourne - IELTS on Computer',
      },
    ],
    items: [
      {
        sessionId: 'session-1',
        languageSkills: ['L', 'R', 'W'],
        seatAvailability: { maxAvailable: 24, remaining: 3 },
        testCategory: 'IELTS',
        testFormat: 'CD',
        testModule: 'ACADEMIC',
        testStartLocalDatetime: '2026-08-05T09:00:00+10:00',
        testLocation: {
          id: 'location-1',
          externalReferenceId: 'external-1',
          name: 'IDP IELTS Melbourne - IELTS on Computer',
          address: {
            line1: 'L7/170 Queen St',
            line2: '',
            line3: '',
            line4: '',
          },
          contactEmailAddress: 'ielts.melbourne@idp.com',
          contactPhoneNumber: '1800 515 150',
          latitude: -37.814289,
          longitude: 144.960802,
        },
      },
    ],
  };
}

test('parses IDP Global seat and offering evidence without changing fee data', () => {
  const capture = parseIdpGlobalSearchCapture(providerResponse(), {
    sourceUrl,
    countryCode: 'AUS',
    countryName: 'Australia',
    city: 'Melbourne',
  });
  assert.equal(capture.totalCount, 1);
  assert.equal(capture.sessions[0]?.remainingSeats, 3);
  assert.equal(capture.sessions[0]?.testDate, '2026-08-05');
  assert.equal(capture.sessions[0]?.timeText, '09:00:00');
  assert.deepEqual(capture.sessions[0]?.location.addressLines, [
    'L7/170 Queen St',
  ]);
});

test('matches an exact provider venue conservatively and marks remaining seats available', () => {
  const capture = parseIdpGlobalSearchCapture(providerResponse(), {
    sourceUrl,
    countryCode: 'AUS',
    countryName: 'Australia',
    city: 'Melbourne',
  });
  const centres = [
    centre(
      'idp-melbourne',
      'IDP IELTS Melbourne - IELTS on Computer',
      'Level 7, 170 Queen Street, Melbourne, Victoria 3000',
    ),
  ];
  const snapshot = buildIdpGlobalAvailabilitySnapshot(
    [capture],
    centres,
    checkedAt,
  );
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0]?.centreId, 'idp-melbourne');
  assert.equal(snapshot.records[0]?.centreMatchStatus, 'matched');
  assert.equal(snapshot.records[0]?.status, 'available');
  assert.deepEqual(snapshot.records[0]?.offering, {
    module: 'academic',
    category: 'standard',
    deliveryMode: 'computer_delivered',
    sourceTestId: 'IELTS',
    sourceModuleId: 'ACADEMIC',
    sourceLabel: 'IELTS — ACADEMIC — CD',
  });
});

test('does not match India, China or a close same-city tie', () => {
  const capture = parseIdpGlobalSearchCapture(providerResponse(), {
    sourceUrl,
    countryCode: 'AUS',
    countryName: 'Australia',
    city: 'Melbourne',
  });
  const offering = {
    module: 'academic' as const,
    category: 'standard' as const,
    deliveryMode: 'computer_delivered' as const,
    sourceTestId: 'IELTS',
    sourceModuleId: 'ACADEMIC',
    sourceLabel: 'IELTS — ACADEMIC — CD',
  };
  const location = capture.sessions[0]!.location;
  const result = matchIdpGlobalCentre(capture, location, offering, [
    centre(
      'india',
      location.name,
      'L7/170 Queen St, Melbourne',
      'https://ieltsidpindia.com/registration/reg1',
    ),
    centre(
      'china',
      location.name,
      'L7/170 Queen St, Melbourne',
      'https://sign.idpielts.cn/kaoshibaoming/',
    ),
    centre(
      'tie-a',
      'IDP IELTS Melbourne Computer A',
      '170 Queen St, Melbourne',
    ),
    centre(
      'tie-b',
      'IDP IELTS Melbourne Computer B',
      '170 Queen St, Melbourne',
    ),
  ]);
  assert.notEqual(result.status, 'matched');
  assert.equal(result.centreId, null);
});

test('rejects malformed search responses instead of trusting partial data', () => {
  assert.throws(
    () =>
      parseIdpGlobalSearchCapture(
        { totalCount: 1, testLocations: [], items: [{}] },
        {
          sourceUrl,
          countryCode: 'AUS',
          countryName: 'Australia',
          city: 'Melbourne',
        },
      ),
    /testStartLocalDatetime is missing/,
  );
});
