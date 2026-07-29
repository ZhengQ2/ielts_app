import assert from 'node:assert/strict';
import test from 'node:test';
import { geoWithinBounds } from '../src/query.ts';
import { filterCentres } from '../src/query.ts';
import type {
  Centre,
  TestCategory,
  TestKind,
  TestModule,
  TestOffering,
} from '../src/types.ts';
import { normaliseText } from '../src/text.ts';

test('a coordinate inside an ordinary map viewport is included', () => {
  assert.equal(
    geoWithinBounds(
      { lat: 43.65, lng: -79.38 },
      { north: 44, south: 43, west: -80, east: -79 },
    ),
    true,
  );
});

test('a coordinate outside the latitude range is excluded', () => {
  assert.equal(
    geoWithinBounds(
      { lat: 45, lng: -79.38 },
      { north: 44, south: 43, west: -80, east: -79 },
    ),
    false,
  );
});

test('a viewport crossing the antimeridian includes either side', () => {
  const bounds = { north: 20, south: -20, west: 170, east: -170 };
  assert.equal(geoWithinBounds({ lat: 0, lng: 175 }, bounds), true);
  assert.equal(geoWithinBounds({ lat: 0, lng: -175 }, bounds), true);
  assert.equal(geoWithinBounds({ lat: 0, lng: 0 }, bounds), false);
});

test('a viewport spanning the whole world accepts every longitude', () => {
  assert.equal(
    geoWithinBounds(
      { lat: 0, lng: 42 },
      { north: 90, south: -90, west: -190, east: 190 },
    ),
    true,
  );
});

test('free-text search includes local-language names and addresses', () => {
  const centre = {
    id: 'localized',
    name: 'English name',
    address: {
      raw: 'English address',
      lines: ['English address'],
      city: 'Guangzhou',
      region: null,
      postcode: null,
      country: 'CN',
    },
    localizations: [
      {
        locale: 'zh-CN',
        name: '广州雅思考场',
        address: '广东省广州市天河区体育东路',
        nameSource: 'admin',
        addressSource: 'amap',
      },
    ],
    isPublishable: true,
  } as unknown as Centre;

  const unrelated = {
    ...centre,
    id: 'unrelated',
    localizations: undefined,
  };
  assert.deepEqual(filterCentres([centre, unrelated], { q: '天河区' }).map((item) => item.id), [
    'localized',
  ]);
});

test('search normalization preserves Chinese and Devanagari scripts', () => {
  assert.equal(normaliseText('天河区'), '天河区');
  assert.equal(normaliseText('रानीप'), 'रानीप');
  assert.equal(normaliseText('São Paulo'), 'sao paulo');
});

test('free-text search includes merged contact information', () => {
  const centre = {
    id: 'contactable',
    name: 'Example Centre',
    address: {
      raw: '1 Test Street',
      lines: ['1 Test Street'],
      city: 'Calgary',
      region: 'AB',
      postcode: null,
      country: 'CA',
    },
    contact: {
      phones: ['+1 403 555 0100'],
      emails: ['help@example.test'],
      websites: ['https://example.test/ielts'],
    },
    isPublishable: true,
  } as unknown as Centre;

  assert.equal(filterCentres([centre], { q: 'help@example.test' }).length, 1);
  assert.equal(filterCentres([centre], { q: '403 555 0100' }).length, 1);
});

test('test kind and delivery mode must match the same offering', () => {
  const centre = offeringCentre('split', [
    offering('Academic on computer', 'academic', 'computer_delivered', 320),
    offering('General Training on paper', 'general_training', 'paper_based', 300),
  ]);

  assert.equal(
    filterCentres([centre], {
      testKinds: ['academic'],
      deliveryModes: ['paper_based'],
    }).length,
    0,
  );
  assert.equal(
    filterCentres([centre], {
      testKinds: ['academic'],
      deliveryModes: ['computer_delivered'],
    }).length,
    1,
  );
});

test('module and UKVI/SELT category match independently on one offering', () => {
  const centre = offeringCentre('two-dimensional', [
    offering('IELTS Academic on computer', 'academic', 'computer_delivered', 320),
    offering('IELTS General Training on paper', 'general_training', 'paper_based', 300),
    offering('IELTS UKVI Academic on computer', 'ukvi', 'computer_delivered', 410),
    offering('IELTS UKVI General Training on paper', 'ukvi', 'paper_based', 400),
    offering('IELTS SELT Online AC', 'other', 'computer_delivered', 390),
    offering('IELTS Life Skills A1', 'life_skills', 'computer_delivered', 180),
  ]);

  const standardAcademic = filterCentres([centre], {
    testModules: ['academic'],
    testCategories: ['standard'],
  });
  assert.deepEqual(
    standardAcademic[0]?.offerings.map((item) => item.label),
    ['IELTS Academic on computer'],
  );
  assert.equal(standardAcademic[0]?.parsedPriceFrom, 320);

  const secureAcademic = filterCentres([centre], {
    testModules: ['academic'],
    testCategories: ['ukvi_selt'],
  });
  assert.deepEqual(
    secureAcademic[0]?.offerings.map((item) => item.label),
    ['IELTS UKVI Academic on computer', 'IELTS SELT Online AC'],
  );
  assert.equal(
    secureAcademic[0]?.parsedPriceFrom,
    390,
    'the contextual price should use only matching UKVI/SELT Academic rows',
  );

  const secureGeneralOnPaper = filterCentres([centre], {
    testModules: ['general_training'],
    testCategories: ['ukvi_selt'],
    deliveryModes: ['paper_based'],
  });
  assert.deepEqual(
    secureGeneralOnPaper[0]?.offerings.map((item) => item.label),
    ['IELTS UKVI General Training on paper'],
  );

  assert.equal(
    filterCentres([centre], {
      testModules: ['life_skills'],
      testCategories: ['standard'],
    }).length,
    0,
    'Life Skills belongs to UKVI/SELT, never Standard IELTS',
  );
});

test('writing on paper is distinct from traditional paper delivery', () => {
  const hybrid = offeringCentre('hybrid', [
    offering(
      'Academic Test - Computer, Writing on Paper',
      'academic',
      'paper_based',
      330,
    ),
    offering(
      'IELTS Academic on computer',
      'academic',
      'computer_delivered',
      350,
    ),
  ]);

  const writing = filterCentres([hybrid], {
    deliveryModes: ['writing_on_paper'],
  });
  assert.equal(writing.length, 1);
  assert.equal(writing[0]?.priceFromText, 'CAD 330');
  assert.equal(writing[0]?.parsedPriceFrom, 330);
  assert.deepEqual(
    writing[0]?.offerings.map((item) => item.label),
    ['Academic Test - Computer, Writing on Paper'],
  );

  const computer = filterCentres([hybrid], {
    deliveryModes: ['computer_delivered'],
  });
  assert.equal(computer.length, 1);
  assert.equal(computer[0]?.priceFromText, 'CAD 350');
  assert.equal(computer[0]?.parsedPriceFrom, 350);
  assert.deepEqual(
    computer[0]?.offerings.map((item) => item.label),
    ['IELTS Academic on computer'],
  );

  assert.equal(
    filterCentres([hybrid], { deliveryModes: ['paper_based'] }).length,
    0,
  );
});

test('ordinary-test defaults exclude Life Skills-only centres and their lower fees', () => {
  const ordinaryModules: TestModule[] = [
    'academic',
    'general_training',
    'other',
  ];
  const allCategories: TestCategory[] = ['standard', 'ukvi_selt'];
  const lifeOnly = offeringCentre('life-only', [
    offering('Life Skills A1', 'life_skills', 'computer_delivered', 180),
  ]);
  const mixed = offeringCentre('mixed', [
    offering('Life Skills A1', 'life_skills', 'computer_delivered', 180),
    offering('Academic Test', 'academic', 'computer_delivered', 330),
  ]);

  const results = filterCentres([lifeOnly, mixed], {
    testModules: ordinaryModules,
    testCategories: allCategories,
    deliveryModes: [
      'computer_delivered',
      'paper_based',
      'writing_on_paper',
    ],
  });
  assert.deepEqual(results.map((centre) => centre.id), ['mixed']);
  assert.deepEqual(results[0]?.offerings.map((item) => item.kind), ['academic']);
  assert.equal(results[0]?.priceFromText, 'CAD 330');
  assert.equal(results[0]?.parsedPriceFrom, 330);
  assert.equal(
    filterCentres([mixed], {
      testModules: ordinaryModules,
      testCategories: allCategories,
      maxPrice: 200,
    }).length,
    0,
    'the excluded Life Skills fee must not satisfy an Academic price filter',
  );
});

test('an explicitly empty offering selection matches no centres', () => {
  const centre = offeringCentre('academic', [
    offering('Academic Test', 'academic', 'computer_delivered', 330),
  ]);
  assert.equal(filterCentres([centre], { testKinds: [] }).length, 0);
  assert.equal(filterCentres([centre], { testModules: [] }).length, 0);
  assert.equal(filterCentres([centre], { testCategories: [] }).length, 0);
  assert.equal(filterCentres([centre], { deliveryModes: [] }).length, 0);
});

test('Life Skills never claims a delivery mode that the source did not publish', () => {
  const life = offeringCentre('life', [
    offering('Life Skills A1', 'life_skills', 'computer_delivered', 180),
  ]);
  assert.equal(
    filterCentres([life], {
      testKinds: ['life_skills'],
      deliveryModes: [
        'computer_delivered',
        'paper_based',
        'writing_on_paper',
      ],
    }).length,
    1,
    'all delivery choices means no delivery restriction',
  );
  assert.equal(
    filterCentres([life], {
      testKinds: ['life_skills'],
      deliveryModes: ['computer_delivered'],
    }).length,
    0,
    'the stored fallback is not source-confirmed computer delivery',
  );
});

function offering(
  label: string,
  kind: TestKind,
  format: TestOffering['format'],
  price: number,
): TestOffering {
  return {
    label,
    kind,
    format,
    priceText: `CAD ${price}`,
    parsedCurrency: 'CAD',
    parsedPrice: price,
    priceParseStatus: 'verified',
  };
}

function offeringCentre(id: string, offerings: TestOffering[]): Centre {
  const cheapest = [...offerings].sort(
    (left, right) => (left.parsedPrice ?? Infinity) - (right.parsedPrice ?? Infinity),
  )[0]!;
  return {
    id,
    name: id,
    operator: 'IDP',
    address: {
      raw: '1 Test Street, Toronto',
      lines: ['1 Test Street', 'Toronto'],
      city: 'Toronto',
      region: 'ON',
      postcode: 'M5V 1A1',
      country: 'CA',
    },
    formats: [...new Set(offerings.map((item) => item.format))],
    offerings,
    priceFromText: cheapest.priceText,
    parsedPriceFrom: cheapest.parsedPrice,
    parsedCurrency: cheapest.parsedCurrency,
    isPublishable: true,
  } as Centre;
}
