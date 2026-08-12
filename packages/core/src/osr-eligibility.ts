import type { Operator } from './types.ts';

export type OsrDestinationCountryRule = 'same_country' | 'country_group' | 'any_country';

export interface OsrEligibilityPolicy {
  portabilitySupported: boolean;
  destinationOperator: Operator | null;
  destinationCountryRule: OsrDestinationCountryRule | null;
  allowedDestinationCountries: string[];
  excludedDestinationCountries: string[];
  sourceUrl: string;
  explanation: string;
}

const BRITISH_COUNCIL_OSR_URL =
  'https://takeielts.britishcouncil.org/take-ielts/one-skill-retake';
const IDP_OSR_URL = 'https://ielts.idp.com/about/ielts-one-skill-retake';
const IDP_INDIA_OSR_URL = 'https://ieltsidpindia.com/ielts/one-skill-retake/';
const IDP_CHINA_OSR_URL = 'https://www.idpielts.cn/common-questions';
const IDP_INDIA_COUNTRIES = ['IN', 'BT'];

/**
 * Rules attached to the original full-test administrator. These are deliberately
 * explicit: a destination centre's OSR badge proves that it offers the service,
 * but does not prove that a candidate's original result is portable to it.
 */
export function osrEligibilityPolicy(
  operator: Operator,
  originalCountry = '',
): OsrEligibilityPolicy {
  switch (operator) {
    case 'British Council':
      return {
        portabilitySupported: true,
        destinationOperator: 'British Council',
        destinationCountryRule: 'same_country',
        allowedDestinationCountries: [],
        excludedDestinationCountries: [],
        sourceUrl: BRITISH_COUNCIL_OSR_URL,
        explanation:
          'British Council candidates must take One Skill Retake in the same country or region as their original full test.',
      };
    case 'IDP':
      if (originalCountry === 'CN') {
        return {
          portabilitySupported: true,
          destinationOperator: 'IDP',
          destinationCountryRule: 'same_country',
          allowedDestinationCountries: [],
          excludedDestinationCountries: [],
          sourceUrl: IDP_CHINA_OSR_URL,
          explanation:
            'Candidates who took their full test with IDP in mainland China must also take One Skill Retake there because it uses a separate candidate system.',
        };
      }
      if (IDP_INDIA_COUNTRIES.includes(originalCountry)) {
        return {
          portabilitySupported: true,
          destinationOperator: 'IDP',
          destinationCountryRule: 'country_group',
          allowedDestinationCountries: IDP_INDIA_COUNTRIES,
          excludedDestinationCountries: [],
          sourceUrl: IDP_INDIA_OSR_URL,
          explanation:
            'Candidates who took their full test in India or Bhutan may take One Skill Retake in either place because IELTS in Bhutan is operated through IELTS IDP India.',
        };
      }
      return {
        portabilitySupported: true,
        destinationOperator: 'IDP',
        destinationCountryRule: 'any_country',
        allowedDestinationCountries: [],
        excludedDestinationCountries: ['CN', 'IN', 'BT'],
        sourceUrl: IDP_OSR_URL,
        explanation:
          originalCountry
            ? 'You may take One Skill Retake in a different country or region, except in mainland China, India or Bhutan, which use separate candidate systems.'
            : 'Choose the country or region of the original IDP test to see whether another destination is permitted.',
      };
    case 'IELTS USA':
      return {
        portabilitySupported: false,
        destinationOperator: null,
        destinationCountryRule: null,
        allowedDestinationCountries: [],
        excludedDestinationCountries: [],
        sourceUrl: BRITISH_COUNCIL_OSR_URL,
        explanation:
          'One Skill Retake is not currently available to candidates whose full test was taken through IELTS USA.',
      };
    default:
      return {
        portabilitySupported: false,
        destinationOperator: null,
        destinationCountryRule: null,
        allowedDestinationCountries: [],
        excludedDestinationCountries: [],
        sourceUrl: 'https://ielts.org/take-a-test/one-skill-retake',
        explanation:
          'Choose the administrator of the original full test before searching for One Skill Retake.',
      };
  }
}

export function osrDestinationCountry(
  operator: Operator,
  originalCountry: string,
  selectedDestinationCountry: string,
): string | undefined {
  const policy = osrEligibilityPolicy(operator, originalCountry);
  if (policy.destinationCountryRule === 'same_country') return originalCountry || undefined;
  if (
    policy.destinationCountryRule === 'country_group' ||
    policy.destinationCountryRule === 'any_country'
  ) {
    return selectedDestinationCountry || undefined;
  }
  return undefined;
}

export function isOsrDestinationCountryAllowed(
  operator: Operator,
  originalCountry: string,
  destinationCountry: string,
): boolean {
  const policy = osrEligibilityPolicy(operator, originalCountry);
  if (!policy.portabilitySupported) return false;
  if (policy.destinationCountryRule === 'same_country') {
    return Boolean(originalCountry) && destinationCountry === originalCountry;
  }
  if (policy.destinationCountryRule === 'country_group') {
    return policy.allowedDestinationCountries.includes(destinationCountry);
  }
  if (policy.destinationCountryRule === 'any_country') {
    return !policy.excludedDestinationCountries.includes(destinationCountry);
  }
  return false;
}
