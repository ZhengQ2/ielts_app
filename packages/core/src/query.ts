import type {
  Centre,
  OfferingDeliveryMode,
  Operator,
  TestCategory,
  TestFormat,
  TestKind,
  TestModule,
  TestOffering,
} from './types.ts';
import { haversineKm, isPinnable } from './geo.ts';
import { normaliseText } from './text.ts';
import { offeringCategory, offeringModule } from './offerings.ts';
import { isDirectoryVisible } from './publication.ts';

/**
 * Filtering and sorting for the directory. Lives in core, not in the web app,
 * so the mobile client gets identical list behaviour for free.
 */

export interface CentreFilter {
  /** Free text over name, city and address. */
  q?: string;
  city?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  operators?: Operator[];
  formats?: TestFormat[];
  /**
   * OR within each offering dimension, AND across dimensions. One actual
   * offering must satisfy module + category + delivery — a centre with
   * standard Academic-on-computer and UKVI GT-on-paper must not match
   * Academic + UKVI/SELT + paper.
   * An explicitly empty array matches nothing.
   */
  testModules?: TestModule[];
  testCategories?: TestCategory[];
  /** @deprecated Use `testModules` and `testCategories`. */
  testKinds?: TestKind[];
  deliveryModes?: OfferingDeliveryMode[];
  maxPrice?: number;
  /** Include centres that do not meet the listing publication rule. */
  includeUnpublishable?: boolean;
  /** When set, results can be sorted and limited by distance from here. */
  near?: { lat: number; lng: number };
  withinKm?: number;
}

export type SortKey = 'name' | 'price' | 'distance' | 'city';

/** A map viewport in WGS-84 degrees. */
export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface CentreWithDistance extends Centre {
  /** Populated only when `filter.near` is supplied and the centre has coords. */
  distanceKm?: number;
}

const WRITING_ON_PAPER = /writing\s+on\s+paper/i;
const ALL_DELIVERY_MODES: OfferingDeliveryMode[] = [
  'computer_delivered',
  'paper_based',
  'writing_on_paper',
];

/** Normalize source format + label into the choices exposed by the directory. */
export function offeringDeliveryMode(
  offering: Pick<
    TestOffering,
    'kind' | 'label' | 'format' | 'module' | 'category'
  >,
): OfferingDeliveryMode | null {
  // IELTS.org publishes no delivery icon for Life Skills. Those rows carry a
  // legacy computer fallback in stored data, but the UI must not present that
  // fallback as source-confirmed delivery information.
  if (offeringModule(offering) === 'life_skills') return null;
  if (WRITING_ON_PAPER.test(offering.label)) return 'writing_on_paper';
  return offering.format;
}

export function deliveryModesIn(
  offerings: readonly Pick<
    TestOffering,
    'kind' | 'label' | 'format' | 'module' | 'category'
  >[],
): OfferingDeliveryMode[] {
  const present = new Set(offerings.map(offeringDeliveryMode));
  return ([
    'computer_delivered',
    'writing_on_paper',
    'paper_based',
  ] as OfferingDeliveryMode[]).filter((mode) => present.has(mode));
}

/**
 * Whether a coordinate is inside a map viewport.
 *
 * The longitude branch handles viewports that cross the antimeridian, where
 * west is numerically greater than east (for example 170°E to 170°W).
 */
export function geoWithinBounds(
  point: { lat: number; lng: number },
  bounds: GeoBounds,
): boolean {
  if (point.lat < bounds.south || point.lat > bounds.north) return false;
  if (bounds.east - bounds.west >= 360) return true;

  const lng = normaliseLongitude(point.lng);
  const west = normaliseLongitude(bounds.west);
  const east = normaliseLongitude(bounds.east);
  return west <= east ? lng >= west && lng <= east : lng >= west || lng <= east;
}

function normaliseLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function filterCentres(
  centres: Centre[],
  filter: CentreFilter = {},
): CentreWithDistance[] {
  const q = filter.q ? normaliseText(filter.q) : '';
  const operators = filter.operators?.length ? new Set(filter.operators) : null;
  const formats = filter.formats?.length ? new Set(filter.formats) : null;
  const testKinds =
    filter.testKinds === undefined ? null : new Set(filter.testKinds);
  const testModules =
    filter.testModules === undefined ? null : new Set(filter.testModules);
  const testCategories =
    filter.testCategories === undefined
      ? null
      : new Set(filter.testCategories);
  const deliveryModes =
    filter.deliveryModes === undefined ? null : new Set(filter.deliveryModes);
  const deliveryIsUnrestricted =
    deliveryModes === null ||
    ALL_DELIVERY_MODES.every((mode) => deliveryModes.has(mode));
  const offeringFilterActive =
    testKinds !== null ||
    testModules !== null ||
    testCategories !== null ||
    deliveryModes !== null;
  const city = filter.city ? normaliseText(filter.city) : '';
  const country = filter.country?.toUpperCase();

  const out: CentreWithDistance[] = [];

  for (const c of centres) {
    if (!filter.includeUnpublishable && !isDirectoryVisible(c)) continue;
    if (country && c.address.country?.toUpperCase() !== country) continue;
    if (operators && !operators.has(c.operator)) continue;
    if (formats && !c.formats.some((f) => formats.has(f))) continue;
    if (city && normaliseText(c.address.city ?? '') !== city) continue;

    const matchingOfferings = offeringFilterActive
      ? c.offerings.filter((offering) => {
          if (testKinds && !testKinds.has(offering.kind)) return false;
          if (testModules && !testModules.has(offeringModule(offering))) {
            return false;
          }
          if (
            testCategories &&
            !testCategories.has(offeringCategory(offering))
          ) {
            return false;
          }
          if (!deliveryModes) return true;
          const delivery = offeringDeliveryMode(offering);
          // Life Skills has no source-published delivery mode. It participates
          // only while delivery is unrestricted, never in a specific-mode
          // result that would imply evidence we do not have.
          return delivery === null
            ? deliveryIsUnrestricted
            : deliveryModes.has(delivery);
        })
      : c.offerings;
    if (offeringFilterActive && matchingOfferings.length === 0) continue;

    // Project the centre summary onto the offerings the reader selected. This
    // keeps "from", price sorting and format labels from leaking a cheaper
    // Life Skills fee into an Academic-only result.
    const projected = offeringFilterActive
      ? projectCentreOfferings(c, matchingOfferings)
      : c;

    if (filter.maxPrice !== undefined) {
      if (
        projected.parsedPriceFrom === null ||
        projected.parsedPriceFrom > filter.maxPrice
      ) {
        continue;
      }
    }
    if (q) {
      const contact = projected.contact ?? {
        phones: projected.phone ? [projected.phone] : [],
        emails: [],
        websites: [],
      };
      const localized = (projected.localizations ?? [])
        .flatMap((entry) => [entry.name, entry.address])
        .filter(Boolean)
        .join(' ');
      const haystack = normaliseText(
        `${projected.name} ${projected.address.raw} ${projected.address.city ?? ''} ${projected.address.postcode ?? ''} ` +
          `${contact.phones.join(' ')} ${contact.emails.join(' ')} ` +
          `${contact.websites.join(' ')} ${localized}`,
      );
      if (!haystack.includes(q)) continue;
    }

    let distanceKm: number | undefined;
    if (filter.near && isPinnable(projected.geo)) {
      distanceKm = haversineKm(filter.near, projected.geo!);
      if (filter.withinKm !== undefined && distanceKm > filter.withinKm) continue;
    } else if (filter.near && filter.withinKm !== undefined) {
      // No coordinate means we cannot honour a radius filter — exclude rather
      // than silently pretend the centre is nearby.
      continue;
    }

    out.push(
      distanceKm === undefined
        ? projected
        : { ...projected, distanceKm },
    );
  }

  return out;
}

function projectCentreOfferings(
  centre: Centre,
  offerings: TestOffering[],
): Centre {
  const published = offerings.filter((offering) => Boolean(offering.priceText));
  const parsed = published.filter(
    (offering) =>
      offering.priceParseStatus === 'verified' &&
      offering.parsedPrice !== null &&
      offering.parsedCurrency !== null,
  );
  const currencies = new Set(parsed.map((offering) => offering.parsedCurrency!));

  let priceFromText: string | null = null;
  let parsedPriceFrom: number | null = null;
  let parsedCurrency: string | null = null;
  if (parsed.length > 0 && currencies.size === 1) {
    const cheapest = [...parsed].sort(
      (left, right) => left.parsedPrice! - right.parsedPrice!,
    )[0]!;
    priceFromText = cheapest.priceText;
    parsedPriceFrom = cheapest.parsedPrice;
    parsedCurrency = cheapest.parsedCurrency;
  } else if (published.length > 0) {
    priceFromText = published[0]!.priceText;
  }

  return {
    ...centre,
    offerings,
    formats: [...new Set(offerings.map((offering) => offering.format))],
    priceFromText,
    parsedPriceFrom,
    parsedCurrency,
  };
}

export function sortCentres(
  centres: CentreWithDistance[],
  key: SortKey = 'name',
): CentreWithDistance[] {
  const sorted = [...centres];
  switch (key) {
    case 'price':
      // Centres with no published price sort last rather than as free.
      sorted.sort(
        (a, b) =>
          nullsLast(a.parsedPriceFrom, b.parsedPriceFrom) ||
          a.name.localeCompare(b.name),
      );
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
    if (!isDirectoryVisible(c)) continue;
    const city = c.address.city;
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

/** Distinct countries present, with counts, for a country filter. */
export function countryFacets(centres: Centre[]): { country: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of centres) {
    if (!isDirectoryVisible(c)) continue;
    const country = c.address.country;
    if (!country) continue;
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

/**
 * Distinct currencies present, for the price filter. A raw numeric comparison
 * only means anything within one currency — CAD 400 and IDR 400 are nowhere
 * near comparable — so the caller uses this to decide whether "max price" can
 * be shown at all for the current result set.
 */
export function currenciesIn(centres: Centre[]): string[] {
  return [
    ...new Set(
      centres
        .map((c) => c.parsedCurrency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ].sort();
}

export function operatorFacets(centres: Centre[]): { operator: Operator; count: number }[] {
  const counts = new Map<Operator, number>();
  for (const c of centres) {
    if (!isDirectoryVisible(c)) continue;
    counts.set(c.operator, (counts.get(c.operator) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([operator, count]) => ({ operator, count }))
    .sort((a, b) => b.count - a.count);
}
