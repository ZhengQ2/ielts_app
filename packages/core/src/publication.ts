import type { Centre, TestOffering } from './types.ts';

/**
 * The ordinary publication rule requires at least one source-published fee.
 * A non-numeric string such as "Contact centre for fee" still counts because
 * the source explicitly published it.
 */
export function hasPricedOffering(
  offerings: readonly Pick<TestOffering, 'priceText'>[],
): boolean {
  return offerings.some((offering) => Boolean(offering.priceText?.trim()));
}

/**
 * Official future-opening interest locations are the sole exception to the
 * ordinary fee requirement. They remain visibly marked as not yet open and
 * link to the operator's interest form rather than being presented as bookable.
 */
export function isDirectoryVisible(
  centre: Pick<Centre, 'isPublishable' | 'futureOpening'>,
): boolean {
  return centre.isPublishable || centre.futureOpening !== undefined;
}
