import type { Centre, Operator, TestFormat } from './types.ts';
import { haversineKm } from './geo.ts';
import { normaliseText } from './text.ts';

/**
 * Filtering and sorting for the directory. Lives in core, not in the web app,
 * so the mobile client gets identical list behaviour for free.
 */

export interface CentreFilter {
  /** Free text over name, city and address. */
  q?: string;
  city?: string;
  operators?: Operator[];
  formats?: TestFormat[];
  maxPrice?: number;
  /** Include centres derived as inactive. Off by default. */
  includeInactive?: boolean;
  /** When set, results can be sorted and limited by distance from here. */
  near?: { lat: number; lng: number };
  withinKm?: number;
}

export type SortKey = 'name' | 'price' | 'distance' | 'city';

export interface CentreWithDistance extends Centre {
  /** Populated only when `filter.near` is supplied and the centre has coords. */
  distanceKm?: number;
}

export function filterCentres(
  centres: Centre[],
  filter: CentreFilter = {},
): CentreWithDistance[] {
  const q = filter.q ? normaliseText(filter.q) : '';
  const operators = filter.operators?.length ? new Set(filter.operators) : null;
  const formats = filter.formats?.length ? new Set(filter.formats) : null;
  const city = filter.city ? normaliseText(filter.city) : '';

  const out: CentreWithDistance[] = [];

  for (const c of centres) {
    if (!filter.includeInactive && !c.isActive) continue;
    if (operators && !operators.has(c.operator)) continue;
    if (formats && !c.formats.some((f) => formats.has(f))) continue;
    if (city && normaliseText(c.address.city ?? '') !== city) continue;
    if (filter.maxPrice !== undefined) {
      if (c.priceFrom === null || c.priceFrom > filter.maxPrice) continue;
    }
    if (q) {
      const haystack = normaliseText(
        `${c.name} ${c.address.raw} ${c.address.city ?? ''} ${c.address.postcode ?? ''}`,
      );
      if (!haystack.includes(q)) continue;
    }

    let distanceKm: number | undefined;
    if (filter.near && c.geo) {
      distanceKm = haversineKm(filter.near, c.geo);
      if (filter.withinKm !== undefined && distanceKm > filter.withinKm) continue;
    } else if (filter.near && filter.withinKm !== undefined) {
      // No coordinate means we cannot honour a radius filter — exclude rather
      // than silently pretend the centre is nearby.
      continue;
    }

    out.push(distanceKm === undefined ? c : { ...c, distanceKm });
  }

  return out;
}

export function sortCentres(
  centres: CentreWithDistance[],
  key: SortKey = 'name',
): CentreWithDistance[] {
  const sorted = [...centres];
  switch (key) {
    case 'price':
      // Centres with no published price sort last rather than as free.
      sorted.sort((a, b) => nullsLast(a.priceFrom, b.priceFrom) || a.name.localeCompare(b.name));
      break;
    case 'distance':
      sorted.sort(
        (a, b) => nullsLast(a.distanceKm ?? null, b.distanceKm ?? null) || a.name.localeCompare(b.name),
      );
      break;
    case 'city':
      sorted.sort(
        (a, b) =>
          (a.address.city ?? '').localeCompare(b.address.city ?? '') ||
          a.name.localeCompare(b.name),
      );
      break;
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

function nullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Distinct cities present in the dataset, with counts, for filter chips. */
export function cityFacets(centres: Centre[]): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of centres) {
    if (!c.isActive) continue;
    const city = c.address.city;
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

export function operatorFacets(centres: Centre[]): { operator: Operator; count: number }[] {
  const counts = new Map<Operator, number>();
  for (const c of centres) {
    if (!c.isActive) continue;
    counts.set(c.operator, (counts.get(c.operator) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([operator, count]) => ({ operator, count }))
    .sort((a, b) => b.count - a.count);
}
