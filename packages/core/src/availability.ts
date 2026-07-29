import type {
  Centre,
  CentreAvailability,
  CentreAvailabilityStatus,
  Operator,
  TestOffering,
} from './types.ts';

/** Two weekly refresh failures may pass before an operator signal is hidden. */
export const AVAILABILITY_MAX_AGE_DAYS = 15;

export type AvailabilityGuidanceStatus =
  | CentreAvailabilityStatus
  | 'operator_check_required';

export interface AvailabilityGuidance {
  status: AvailabilityGuidanceStatus;
  label: string;
  message: string;
  actionLabel: string | null;
  actionUrl: string | null;
  evidenceUrl: string | null;
  operatorVerified: boolean;
}

/**
 * A centre is publishable only when the source lists at least one test with
 * fee text. This says nothing about whether the centre is open or has future
 * test dates; availability will be modelled separately when those sources are
 * available.
 */
export function hasPricedOffering(
  offerings: readonly Pick<TestOffering, 'priceText'>[],
): boolean {
  return offerings.some((offering) => Boolean(offering.priceText?.trim()));
}

/**
 * Convert narrow source evidence into reader-facing guidance without
 * inventing a live availability claim.
 */
export function availabilityGuidance(
  centre: Pick<Centre, 'availability' | 'bookingUrl' | 'operator'>,
  now: Date = new Date(),
): AvailabilityGuidance {
  const evidence = freshAvailability(centre.availability, now);
  if (evidence?.status === 'future_location') {
    return {
      status: evidence.status,
      label: 'Future location',
      message:
        'IELTS USA says this is a potential future location with no scheduled or planned test dates.',
      actionLabel: centre.bookingUrl ? 'Join the IELTS USA interest list' : null,
      actionUrl: centre.bookingUrl,
      evidenceUrl: evidence.sourceUrl,
      operatorVerified: true,
    };
  }
  if (evidence?.status === 'not_accepting_registrations') {
    return {
      status: evidence.status,
      label: 'Not accepting registrations',
      message: 'IELTS USA says this location is not currently accepting registrations.',
      actionLabel: 'Check the official IELTS USA status',
      actionUrl: evidence.sourceUrl,
      evidenceUrl: evidence.sourceUrl,
      operatorVerified: true,
    };
  }
  if (evidence?.status === 'registration_available') {
    return {
      status: evidence.status,
      label: 'Registration link listed',
      message:
        'IELTS USA currently lists a registration link for this location. Dates and seats still need confirmation on the booking site.',
      actionLabel: centre.bookingUrl
        ? `Check dates and book on the ${centre.operator} site`
        : null,
      actionUrl: centre.bookingUrl,
      evidenceUrl: evidence.sourceUrl,
      operatorVerified: true,
    };
  }

  return {
    status: 'operator_check_required',
    label: 'Availability not verified here',
    message:
      'This directory has no fresh operator-supported status for this centre. Confirm dates, seats and opening status with the operator.',
    actionLabel: centre.bookingUrl
      ? `Check dates and book on the ${operatorSiteLabel(centre.operator)} site`
      : null,
    actionUrl: centre.bookingUrl,
    evidenceUrl: null,
    operatorVerified: false,
  };
}

export function freshAvailability(
  availability: CentreAvailability | undefined,
  now: Date = new Date(),
): CentreAvailability | null {
  if (!availability) return null;
  const checkedAt = Date.parse(availability.checkedAt);
  if (!Number.isFinite(checkedAt)) return null;
  const ageMs = now.getTime() - checkedAt;
  // Tolerate ordinary client/CI clock skew, but reject a clearly corrupt
  // timestamp that claims evidence came from well into the future.
  if (ageMs < -86_400_000) return null;
  return ageMs <= AVAILABILITY_MAX_AGE_DAYS * 86_400_000
    ? availability
    : null;
}

function operatorSiteLabel(operator: Operator): string {
  return operator === 'unknown' ? 'operator' : operator;
}
