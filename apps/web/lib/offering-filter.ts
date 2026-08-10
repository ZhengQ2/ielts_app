import type {
  CentreFilter,
  OfferingDeliveryMode,
  TestCategory,
  TestKind,
  TestModule,
} from '@ielts-map/core';

export const TEST_MODULE_OPTIONS: { value: TestModule; label: string }[] = [
  { value: 'academic', label: 'Academic' },
  { value: 'general_training', label: 'General Training' },
  { value: 'life_skills', label: 'Life Skills' },
  { value: 'other', label: 'Other' },
];

export const TEST_CATEGORY_OPTIONS: {
  value: TestCategory;
  label: string;
}[] = [
  { value: 'standard', label: 'Standard IELTS' },
  { value: 'ukvi_selt', label: 'UKVI / SELT' },
];

export const DELIVERY_OPTIONS: {
  value: OfferingDeliveryMode;
  label: string;
}[] = [
  { value: 'computer_delivered', label: 'Computer-delivered' },
  { value: 'paper_based', label: 'Paper-based' },
  { value: 'writing_on_paper', label: 'Writing on paper' },
];

export const DEFAULT_TEST_MODULES: TestModule[] = TEST_MODULE_OPTIONS
  .map((option) => option.value)
  .filter((module) => module !== 'life_skills');

export const DEFAULT_TEST_CATEGORIES: TestCategory[] =
  TEST_CATEGORY_OPTIONS.map((option) => option.value);

export const DEFAULT_DELIVERY_MODES: OfferingDeliveryMode[] =
  DELIVERY_OPTIONS.map((option) => option.value);

const TEST_MODULE_PARAM = 'module';
const TEST_CATEGORY_PARAM = 'category';
const LEGACY_TEST_KIND_PARAM = 'test';
const DELIVERY_PARAM = 'delivery';
const VALID_TEST_MODULES = new Set(
  TEST_MODULE_OPTIONS.map((option) => option.value),
);
const VALID_TEST_CATEGORIES = new Set(
  TEST_CATEGORY_OPTIONS.map((option) => option.value),
);
const VALID_LEGACY_TEST_KINDS = new Set<TestKind>([
  'academic',
  'general_training',
  'ukvi',
  'osr',
  'life_skills',
  'other',
]);
const VALID_DELIVERY_MODES = new Set(
  DELIVERY_OPTIONS.map((option) => option.value),
);

/**
 * Carry only the offering dimensions into a centre-details URL. The directory
 * itself remains stateful, while a new tab or copied centre link still shows
 * the price that corresponds to the reader's selected test.
 */
export function offeringFilterSearch(
  testModules: readonly TestModule[],
  testCategories: readonly TestCategory[],
  deliveryModes: readonly OfferingDeliveryMode[],
): string {
  const params = new URLSearchParams();
  for (const testModule of testModules) {
    params.append(TEST_MODULE_PARAM, testModule);
  }
  for (const category of testCategories) {
    params.append(TEST_CATEGORY_PARAM, category);
  }
  for (const mode of deliveryModes) params.append(DELIVERY_PARAM, mode);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function offeringFilterFromSearch(
  params: Pick<URLSearchParams, 'getAll' | 'has'>,
): Pick<
  CentreFilter,
  'testModules' | 'testCategories' | 'testKinds' | 'deliveryModes'
> | null {
  const hasTestModules = params.has(TEST_MODULE_PARAM);
  const hasTestCategories = params.has(TEST_CATEGORY_PARAM);
  const hasLegacyTestKinds = params.has(LEGACY_TEST_KIND_PARAM);
  const hasDeliveryModes = params.has(DELIVERY_PARAM);
  if (
    !hasTestModules &&
    !hasTestCategories &&
    !hasLegacyTestKinds &&
    !hasDeliveryModes
  ) {
    return null;
  }

  const testModules = params
    .getAll(TEST_MODULE_PARAM)
    .filter((value): value is TestModule =>
      VALID_TEST_MODULES.has(value as TestModule),
    );
  const testCategories = params
    .getAll(TEST_CATEGORY_PARAM)
    .filter((value): value is TestCategory =>
      VALID_TEST_CATEGORIES.has(value as TestCategory),
    );
  const testKinds = params
    .getAll(LEGACY_TEST_KIND_PARAM)
    .filter((value): value is TestKind =>
      VALID_LEGACY_TEST_KINDS.has(value as TestKind),
    );
  const deliveryModes = params
    .getAll(DELIVERY_PARAM)
    .filter((value): value is OfferingDeliveryMode =>
      VALID_DELIVERY_MODES.has(value as OfferingDeliveryMode),
    );

  return {
    testModules: hasTestModules ? testModules : undefined,
    testCategories: hasTestCategories ? testCategories : undefined,
    // Old links remain valid, but new links never emit this flattened axis.
    testKinds:
      !hasTestModules && !hasTestCategories && hasLegacyTestKinds
        ? testKinds
        : undefined,
    deliveryModes: hasDeliveryModes ? deliveryModes : undefined,
  };
}

export function centreDetailHref(slug: string, filterSearch: string): string {
  return `/centres/${slug}${filterSearch}`;
}
