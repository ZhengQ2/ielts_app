import type {
  OfferingDeliveryMode,
  TestCategory,
  TestModule,
} from '@ielts-map/core';

export type ProviderAvailabilitySource =
  | 'idp_india'
  | 'idp_global'
  | 'idp_china'
  | 'bc_global';

/**
 * `available` requires an explicit operator statement. Merely finding a date
 * produces `session_published`, which must not be described as a remaining
 * seat.
 */
export type ProviderSessionStatus = 'available' | 'session_published';

export type ProviderCentreMatchStatus =
  | 'matched'
  | 'ambiguous'
  | 'unmatched';

export interface ProviderOfferingIdentity {
  module: TestModule;
  category: TestCategory;
  deliveryMode: OfferingDeliveryMode | null;
  sourceTestId: string;
  sourceModuleId: string | null;
  sourceLabel: string;
}

export interface ProviderSessionRecord {
  source: ProviderAvailabilitySource;
  providerLocationId: string;
  providerLocationLabel: string;
  centreId: string | null;
  centreMatchStatus: ProviderCentreMatchStatus;
  candidateCentreIds: string[];
  offering: ProviderOfferingIdentity;
  /** ISO calendar date in the test centre's local timezone. */
  testDate: string;
  /** Source text; null when the source publishes only a date. */
  timeText: string | null;
  status: ProviderSessionStatus;
  sourceUrl: string;
  checkedAt: string;
}

export interface ProviderSessionSnapshot {
  version: 1;
  source: ProviderAvailabilitySource;
  checkedAt: string;
  records: ProviderSessionRecord[];
  diagnostics: {
    captures: number;
    publishedSessions: number;
    explicitlyAvailable: number;
    matchedSessions: number;
    ambiguousSessions: number;
    unmatchedSessions: number;
    rejectedCaptures: {
      sourceUrl: string;
      reason: string;
    }[];
  };
}

