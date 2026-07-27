/**
 * Domain types. These mirror the Postgres schema in `supabase/migrations` so the
 * JSON-dataset phase and the eventual Supabase phase speak the same shapes.
 */

/** Who runs the centre. Derived from the booking-link domain, never the slug. */
export type Operator = 'IDP' | 'British Council' | 'IELTS USA' | 'unknown';

/**
 * How the operator was determined. `booking_domain` is the only reliable signal;
 * the others are recorded so low-trust rows can be audited or hidden.
 */
export type OperatorSource = 'booking_domain' | 'slug' | 'name' | 'unknown';

/** Coarseness of a coordinate. Never render a confident pin below `street`. */
export type GeoPrecision =
  | 'rooftop'
  | 'street'
  | 'postcode'
  | 'city'
  | 'country'
  | 'approximate';

export type GeoSource =
  | 'page_embed'
  | 'google'
  | 'mapbox'
  | 'nominatim'
  | 'amap'
  | 'kakao'
  | 'naver'
  | 'crowd'
  | 'admin';

export type TestFormat = 'computer_delivered' | 'paper_based';

/** A single bookable product at a centre, as listed on the IELTS.org page. */
export interface TestOffering {
  /** e.g. "IELTS Academic on computer" */
  label: string;
  /** 'academic' | 'general_training' | 'ukvi' | 'osr' | 'life_skills' | 'other' */
  kind: TestKind;
  format: TestFormat;
  /** ISO 4217, e.g. 'CAD'. Null when the page lists no fee. */
  currency: string | null;
  price: number | null;
}

export type TestKind =
  | 'academic'
  | 'general_training'
  | 'ukvi'
  | 'osr'
  | 'life_skills'
  | 'other';

/** A normalised address. `raw` is the source-of-truth text always shown to users. */
export interface CentreAddress {
  /** Address lines exactly as the page listed them, joined with ', '. */
  raw: string;
  lines: string[];
  /** Derived from the address block — NOT from IELTS.org's broken city field. */
  city: string | null;
  region: string | null;
  postcode: string | null;
  /** ISO 3166-1 alpha-2, inferred from postcode/region shape. */
  country: string | null;
}

export interface Geo {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  source: GeoSource;
  /** 0..1 from the scoring rule in DEV_PLAN §5.3. */
  confidence: number;
  /**
   * Internal: carried out of the scoring step so the caller can lift it onto
   * `Centre.googlePlaceId`. Not persisted here — see that field.
   */
  placeId?: string | null;
}

/** Provenance: which source listed this centre, and when we last saw it. */
export interface CentreSourceRef {
  source: string;
  externalSlug: string;
  url: string;
  seenAt: string;
  stillPresent: boolean;
}

/** A fully resolved centre — one row of the directory. */
export interface Centre {
  /** Stable synthetic id, derived from the identity key (see dedup.ts). */
  id: string;
  name: string;
  operator: Operator;
  operatorSource: OperatorSource;
  /** BC only: the `location=` id from the booking link. IDP links carry none. */
  externalId: string | null;
  /** Canonical IELTS.org page slug for this centre. */
  ieltsOrgSlug: string;
  /** Slugs merged into this record by dedup (§5.4). */
  mergedSlugs: string[];
  address: CentreAddress;
  phone: string | null;
  /** Null when no coordinate could be resolved at any precision. */
  geo: Geo | null;
  /**
   * The only Google-derived value we store durably. Google's terms cap caching
   * of their Content but exempt Place IDs, and this is the key that later
   * unlocks live ratings and photos (DEV_PLAN §7) without persisting any of
   * that content itself.
   */
  googlePlaceId: string | null;
  formats: TestFormat[];
  offerings: TestOffering[];
  /** Lowest listed fee, for list-view sorting. */
  priceFrom: number | null;
  currency: string | null;
  bookingUrl: string | null;
  /** Derived, not manual — see §5.5. */
  isActive: boolean;
  /** Cross-source agreement, 0..1. */
  confidence: number;
  sources: CentreSourceRef[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * One IELTS.org page, parsed but not yet deduped or geocoded. This is the
 * "common normalised record" of DEV_PLAN §5.2 and the input to dedup.
 */
export interface ParsedCentre {
  slug: string;
  url: string;
  name: string;
  operator: Operator;
  operatorSource: OperatorSource;
  externalId: string | null;
  address: CentreAddress;
  phone: string | null;
  /** Coordinate lifted from the page's Google static-map URL, if present. */
  embeddedGeo: { lat: number; lng: number } | null;
  offerings: TestOffering[];
  bookingUrl: string | null;
  fetchedAt: string;
}

/** The committed dataset envelope. */
export interface CentreDataset {
  /** Schema version of this file, bumped on breaking shape changes. */
  version: number;
  /** ISO 3166-1 alpha-2 the crawl was filtered to. */
  country: string;
  generatedAt: string;
  /** Counts and quality metrics for the run that produced this file. */
  stats: DatasetStats;
  centres: Centre[];
}

export interface DatasetStats {
  sitemapSlugs: number;
  pagesParsed: number;
  matchedCountry: number;
  afterDedup: number;
  active: number;
  byOperator: Record<string, number>;
  byGeoPrecision: Record<string, number>;
  /** Records with no coordinate at all — listed, but not mappable. */
  ungeocoded: number;
}
