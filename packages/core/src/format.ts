import type { Centre, GeoPrecision, TestFormat } from './types.ts';

/** Presentation helpers shared by web and mobile so labels never drift apart. */

/**
 * Formatted with the en-US locale deliberately: it renders CAD as "CA$365"
 * rather than a bare "$365". The directory already carries several currencies
 * (CAD, USD, CNY, GBP), so an unqualified dollar sign would be misleading.
 */
export function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null) return 'Price not published';
  const code = currency ?? '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code || 'CAD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${code} ${amount}`.trim();
  }
}

export function formatFormat(f: TestFormat): string {
  return f === 'computer_delivered' ? 'Computer-delivered' : 'Paper-based';
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
