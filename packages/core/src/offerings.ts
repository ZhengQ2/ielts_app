import type {
  TestCategory,
  TestKind,
  TestModule,
  TestOffering,
} from './types.ts';

type OfferingClassificationInput = Pick<TestOffering, 'label'> & {
  kind?: TestKind;
  module?: TestModule;
  category?: TestCategory;
};

const GENERAL_TRAINING = /general\s+training|\bgt\b/i;
const ACADEMIC = /academic|\bac\b/i;
const LIFE_SKILLS = /life\s*skills/i;
const UKVI_SELT = /\bukvi\b|\bselt\b/i;

/**
 * Module and UKVI/SELT are independent dimensions. This deliberately maps
 * source labels such as "UKVI Academic" and "SELT Online AC" to Academic
 * without discarding their secure-test category.
 */
export function offeringModule(
  offering: OfferingClassificationInput,
): TestModule {
  if (offering.module) return offering.module;
  if (LIFE_SKILLS.test(offering.label) || offering.kind === 'life_skills') {
    return 'life_skills';
  }
  if (
    GENERAL_TRAINING.test(offering.label) ||
    offering.kind === 'general_training'
  ) {
    return 'general_training';
  }
  if (ACADEMIC.test(offering.label) || offering.kind === 'academic') {
    return 'academic';
  }
  return 'other';
}

export function offeringCategory(
  offering: OfferingClassificationInput,
): TestCategory {
  if (offering.category) return offering.category;
  if (
    LIFE_SKILLS.test(offering.label) ||
    UKVI_SELT.test(offering.label) ||
    offering.kind === 'ukvi' ||
    offering.kind === 'life_skills'
  ) {
    return 'ukvi_selt';
  }
  return 'standard';
}
