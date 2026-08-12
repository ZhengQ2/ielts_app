import assert from 'node:assert/strict';
import test from 'node:test';
import { manualCentreId } from '../src/manual-centre.ts';

const common = {
  countryOrRegion: 'CA',
  operator: 'IDP',
  name: 'Central IELTS Centre',
  address: '1 First Street',
};

test('manual centre ids distinguish same-name centres in different cities', () => {
  assert.notEqual(
    manualCentreId({ ...common, city: 'Toronto' }),
    manualCentreId({ ...common, city: 'Ottawa' }),
  );
});

test('manual centre ids distinguish different addresses in the same city', () => {
  assert.notEqual(
    manualCentreId({ ...common, city: 'Toronto' }),
    manualCentreId({ ...common, city: 'Toronto', address: '2 Second Street' }),
  );
});

test('manual centre ids are stable across harmless casing and Unicode differences', () => {
  assert.equal(
    manualCentreId({ ...common, city: 'Montréal' }),
    manualCentreId({
      ...common,
      operator: 'idp',
      city: 'Montréal',
      address: '1 FIRST STREET',
    }),
  );
});

test('manual centre ids support non-Latin city and centre names', () => {
  for (const [city, name] of [
    ['哈尔滨市', '哈尔滨雅思考试中心'],
    ['دبي', 'مركز اختبار دبي'],
    ['ঢাকা', 'ঢাকা পরীক্ষা কেন্দ্র'],
  ] as const) {
    const id = manualCentreId({
      countryOrRegion: 'CN',
      operator: 'British Council',
      city,
      name,
      address: `1 Example Street, ${city}`,
    });
    assert.match(id, /^manual-cn-british-council-city-[a-z0-9]+-centre-[a-z0-9]+-[a-z0-9]+$/);
  }
});
