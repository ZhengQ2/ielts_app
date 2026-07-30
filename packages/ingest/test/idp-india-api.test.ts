import assert from 'node:assert/strict';
import test from 'node:test';
import {
  idpIndiaCapture,
  parseIdpIndiaDates,
  parseIdpIndiaOptions,
} from '../src/idp-india-api.ts';

test('parses IDP India module and city option envelopes', () => {
  assert.deepEqual(
    parseIdpIndiaOptions(
      {
        Status: null,
        Data: [
          [
            { ddlID: 8, ddlValue: 'Academic' },
            { ddlID: '9', ddlValue: ' General   Training ' },
          ],
          null,
        ],
      },
      'fixture options',
    ),
    [
      { id: '8', label: 'Academic' },
      { id: '9', label: 'General Training' },
    ],
  );
  assert.deepEqual(
    parseIdpIndiaOptions({ Data: [null, null] }, 'empty options'),
    [],
  );
});

test('parses exact DD/MM/YYYY dates and remaining-seat counts', () => {
  const dates = parseIdpIndiaDates({
    Data: [
      [
        {
          ddlID: 0,
          ddlValue: '02/08/2026',
          SeatAvailable: 1,
          FirstDate: '02/08/2026',
        },
        {
          ddlID: 0,
          ddlValue: '03/08/2026',
          SeatAvailable: '0',
          FirstDate: '02/08/2026',
        },
      ],
      null,
    ],
  });
  assert.deepEqual(dates, [
    { testDate: '2026-08-02', seatsAvailable: 1 },
    { testDate: '2026-08-03', seatsAvailable: 0 },
  ]);

  assert.deepEqual(
    idpIndiaCapture(
      {
        testId: '4',
        testLabel: 'IELTS on Computer',
        moduleId: '8',
        moduleLabel: 'Academic',
        cityId: '60',
        cityLabel: 'Mumbai',
      },
      dates,
    ),
    {
      sourceUrl:
        'https://ieltsidpindia.com/registration/reg1?ID=4%5E8%5E60',
      testId: '4',
      testLabel: 'IELTS on Computer',
      moduleId: '8',
      moduleLabel: 'Academic',
      cityId: '60',
      cityLabel: 'Mumbai',
      sessions: [
        {
          testDate: '2026-08-02',
          timeText: null,
          explicitlyAvailable: true,
        },
        {
          testDate: '2026-08-03',
          timeText: null,
          explicitlyAvailable: false,
        },
      ],
    },
  );
});

test('rejects malformed envelopes, dates and seat counts', () => {
  assert.throws(
    () => parseIdpIndiaOptions({ Data: {} }, 'bad options'),
    /Data is not an array/,
  );
  assert.throws(
    () =>
      parseIdpIndiaDates({
        Data: [[{ ddlValue: '08/02/26', SeatAvailable: 1 }]],
      }),
    /Invalid IDP India date/,
  );
  assert.throws(
    () =>
      parseIdpIndiaDates({
        Data: [[{ ddlValue: '02/08/2026', SeatAvailable: -1 }]],
      }),
    /non-negative integer/,
  );
});
