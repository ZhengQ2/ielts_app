import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  Centre,
  OfferingDeliveryMode,
  TestCategory,
  TestModule,
  TestOffering,
} from '@ielts-map/core';
import {
  buildIdpIndiaAvailabilitySnapshot,
  idpIndiaAvailabilitySafetyProblems,
  matchIdpIndiaCentre,
  type IdpIndiaBrowserCapture,
} from '../src/idp-india-availability.ts';
import { isoDateToAccessibleLabel } from '../src/idp-india-browser.ts';
import type {
  ProviderOfferingIdentity,
  ProviderSessionSnapshot,
} from '../src/provider-availability.ts';

const checkedAt = '2026-07-29T12:00:00.000Z';

function offering(
  module: TestModule,
  category: TestCategory,
  deliveryMode: OfferingDeliveryMode | null,
): TestOffering {
  const format =
    deliveryMode === 'computer_delivered'
      ? 'computer_delivered'
      : 'paper_based';
  const label = [
    category === 'ukvi_selt' ? 'IELTS UKVI' : 'IELTS',
    module === 'general_training'
      ? 'General Training'
      : module === 'life_skills'
        ? 'Life Skills A1'
        : 'Academic',
    deliveryMode === 'writing_on_paper'
      ? 'Writing on Paper'
      : deliveryMode === 'computer_delivered'
        ? 'on computer'
        : deliveryMode === 'paper_based'
          ? 'on paper'
          : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    label,
    kind:
      module === 'general_training'
        ? 'general_training'
        : module === 'life_skills'
          ? 'life_skills'
          : category === 'ukvi_selt'
            ? 'ukvi'
            : 'academic',
    module,
    category,
    format,
    priceText: 'INR 19,000',
    parsedCurrency: 'INR',
    parsedPrice: 19000,
    priceParseStatus: 'verified',
  };
}

function centre(
  id: string,
  name: string,
  offerings: TestOffering[],
): Pick<Centre, 'id' | 'name' | 'operator' | 'bookingUrl' | 'offerings'> {
  return {
    id,
    name,
    operator: 'IDP',
    bookingUrl: 'https://ieltsidpindia.com/registration/reg1',
    offerings,
  };
}

function identity(
  module: TestModule,
  category: TestCategory,
  deliveryMode: OfferingDeliveryMode | null,
): ProviderOfferingIdentity {
  return {
    module,
    category,
    deliveryMode,
    sourceTestId: 'fixture',
    sourceModuleId: null,
    sourceLabel: 'fixture',
  };
}

function capture(
  overrides: Partial<IdpIndiaBrowserCapture> = {},
): IdpIndiaBrowserCapture {
  return {
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
        timeText: '01:00 PM to 04:00 PM',
        explicitlyAvailable: true,
      },
    ],
    ...overrides,
  };
}

test('matches a precise IDP India location only within the same offering', () => {
  const centres = [
    centre(
      'paper',
      'Mumbai - West',
      [offering('academic', 'standard', 'paper_based')],
    ),
    centre(
      'computer',
      'IDP Education India - Mumbai',
      [offering('academic', 'standard', 'computer_delivered')],
    ),
    centre(
      'ukvi',
      'IDP Education India - Mumbai - Lower Parel',
      [offering('academic', 'ukvi_selt', 'computer_delivered')],
    ),
  ];

  const match = matchIdpIndiaCentre(
    'Mumbai',
    identity('academic', 'standard', 'computer_delivered'),
    centres,
  );
  assert.equal(match.status, 'matched');
  assert.equal(match.centreId, 'computer');
});

test('a generic city remains ambiguous when two matching branches exist', () => {
  const centres = [
    centre(
      'nehru',
      'IDP Education India - New Delhi - Nehru Place',
      [offering('academic', 'standard', 'computer_delivered')],
    ),
    centre(
      'pitampura',
      'IDP Education India - New Delhi - Pitampura',
      [offering('academic', 'standard', 'computer_delivered')],
    ),
  ];

  const match = matchIdpIndiaCentre(
    'New Delhi',
    identity('academic', 'standard', 'computer_delivered'),
    centres,
  );
  assert.equal(match.status, 'ambiguous');
  assert.equal(match.centreId, null);
  assert.deepEqual(match.candidateCentreIds.sort(), ['nehru', 'pitampura']);
});

test('builds an explicitly available session without changing source text', () => {
  const centres = [
    centre(
      'mumbai',
      'IDP Education India - Mumbai',
      [offering('academic', 'standard', 'computer_delivered')],
    ),
  ];
  const snapshot = buildIdpIndiaAvailabilitySnapshot(
    [capture()],
    centres,
    checkedAt,
  );

  assert.equal(snapshot.records.length, 1);
  assert.deepEqual(snapshot.records[0], {
    source: 'idp_india',
    providerLocationId: '60',
    providerLocationLabel: 'Mumbai',
    centreId: 'mumbai',
    centreMatchStatus: 'matched',
    candidateCentreIds: ['mumbai'],
    offering: {
      module: 'academic',
      category: 'standard',
      deliveryMode: 'computer_delivered',
      sourceTestId: '4',
      sourceModuleId: '8',
      sourceLabel: 'IELTS on Computer — Academic',
    },
    testDate: '2026-08-02',
    timeText: '01:00 PM to 04:00 PM',
    status: 'available',
    sourceUrl:
      'https://ieltsidpindia.com/registration/reg1?ID=4%5E8%5E60',
    checkedAt,
  });
});

test('a date without an explicit availability label stays session-published', () => {
  const snapshot = buildIdpIndiaAvailabilitySnapshot(
    [
      capture({
        sessions: [
          {
            testDate: '2026-08-02',
            timeText: null,
            explicitlyAvailable: false,
          },
        ],
      }),
    ],
    [],
    checkedAt,
  );

  assert.equal(snapshot.records[0]?.status, 'session_published');
  assert.equal(snapshot.records[0]?.centreMatchStatus, 'unmatched');
});

test('recognises the UKVI module abbreviations returned by the live API', () => {
  const academic = buildIdpIndiaAvailabilitySnapshot(
    [
      capture({
        testId: '5',
        testLabel: 'Computer-delivered IELTS for UKVI',
        moduleId: '10',
        moduleLabel: 'CDIELTS for UKVI AC',
      }),
    ],
    [],
    checkedAt,
  );
  const generalTraining = buildIdpIndiaAvailabilitySnapshot(
    [
      capture({
        testId: '5',
        testLabel: 'Computer-delivered IELTS for UKVI',
        moduleId: '11',
        moduleLabel: 'CDIELTS for UKVI GT',
      }),
    ],
    [],
    checkedAt,
  );

  assert.equal(academic.diagnostics.rejectedCaptures.length, 0);
  assert.equal(academic.records[0]?.offering.module, 'academic');
  assert.equal(generalTraining.diagnostics.rejectedCaptures.length, 0);
  assert.equal(
    generalTraining.records[0]?.offering.module,
    'general_training',
  );
});

test('invalid captures and systemic session drops trip the safety gate', () => {
  const invalid = buildIdpIndiaAvailabilitySnapshot(
    [capture({ sessions: [] })],
    [],
    checkedAt,
  );
  assert.match(
    idpIndiaAvailabilitySafetyProblems(null, invalid).join('\n'),
    /no .* sessions|capture.*rejected/i,
  );

  const previous: ProviderSessionSnapshot = {
    ...invalid,
    records: Array.from({ length: 20 }, (_, index) => ({
      ...buildIdpIndiaAvailabilitySnapshot(
        [
          capture({
            cityId: String(index),
            cityLabel: `City ${index}`,
          }),
        ],
        [],
        checkedAt,
      ).records[0]!,
    })),
    diagnostics: {
      ...invalid.diagnostics,
      captures: 20,
      publishedSessions: 20,
      rejectedCaptures: [],
    },
  };
  const next = buildIdpIndiaAvailabilitySnapshot(
    [capture()],
    [],
    checkedAt,
  );
  assert.match(
    idpIndiaAvailabilitySafetyProblems(previous, next).join('\n'),
    /fell from 20 to 1/i,
  );
});

test('the browser collector uses the calendar accessible-date format', () => {
  assert.equal(
    isoDateToAccessibleLabel('2026-08-02'),
    'August 2, 2026',
  );
  assert.throws(
    () => isoDateToAccessibleLabel('02/08/2026'),
    /invalid ISO date/i,
  );
});
