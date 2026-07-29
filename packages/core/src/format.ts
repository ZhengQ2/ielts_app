import type {
  Centre,
  GeoPrecision,
  OfferingDeliveryMode,
  TestFormat,
} from './types.ts';

/** Presentation helpers shared by web and mobile so labels never drift apart. */

/** Source-published fee text is authoritative and must not be reformatted. */
export function formatPublishedPrice(priceText: string | null): string {
  return priceText ?? 'Price not published';
}

export function formatFormat(f: TestFormat): string {
  return f === 'computer_delivered' ? 'Computer-delivered' : 'Paper-based';
}

export function formatDeliveryMode(mode: OfferingDeliveryMode): string {
  if (mode === 'computer_delivered') return 'Computer-delivered';
  if (mode === 'writing_on_paper') return 'Writing on paper';
  return 'Paper-based';
}

export function formatDistance(km: number | undefined): string | null {
  if (km === undefined) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/**
 * Plain-English caveat for a coarse coordinate. Returning null means the pin is
 * trustworthy enough to show without qualification.
 */
export function geoCaveat(centre: Centre): string | null {
  if (!centre.geo) return 'No map location — use the address below.';
  if (centre.geo.verification === 'conflicted') {
    return 'Approximate — independent location evidence conflicts.';
  }
  if (centre.geo.verification === 'unverified') {
    return 'Unverified — this point has not yet been corroborated by a second evidence path.';
  }
  if (centre.geo.verification === 'approximate') {
    return 'Approximate — evidence did not agree closely enough for a precise pin.';
  }
  const messages: Partial<Record<GeoPrecision, string>> = {
    postcode: 'Approximate — located to the postal code, not the building.',
    city: 'Approximate — located to the city only.',
    country: 'Very approximate — no street-level match found.',
    approximate: 'Approximate — sources disagreed on this location.',
  };
  return messages[centre.geo.precision] ?? null;
}

/** How much to trust that this centre is currently operating (§5.5). */
export function confidenceLabel(centre: Centre): 'high' | 'medium' | 'low' {
  if (centre.confidence >= 0.75) return 'high';
  if (centre.confidence >= 0.5) return 'medium';
  return 'low';
}
