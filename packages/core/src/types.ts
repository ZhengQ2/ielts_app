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
  | 'google_places'
  | 'overture'
  | 'amap_places'
  | 'mapbox'
  | 'nominatim'
  | 'amap'
  | 'mappls'
  | 'kakao'
  | 'naver'
  | 'crowd'
  | 'admin';

export type TestFormat = 'computer_delivered' | 'paper_based';

/**
 * Reader-facing delivery choices. IELTS.org models hybrid tests as
 * `paper_based`, so "Writing on paper" is derived from the source label rather
 * than persisted as a third source format.
 */
export type OfferingDeliveryMode =
  | 'computer_delivered'
  | 'paper_based'
  | 'writing_on_paper';

export type PriceParseStatus = 'verified' | 'unparsed' | 'missing';

/** The content module assessed by a bookable IELTS product. */
export type TestModule =
  | 'academic'
  | 'general_training'
  | 'life_skills'
  | 'other';

/** Whether the product uses the standard or UKVI secure testing route. */
export type TestCategory = 'standard' | 'ukvi_selt';

/** A single bookable product at a centre, as listed on the IELTS.org page. */
export interface TestOffering {
  /** e.g. "IELTS Academic on computer" */
  label: string;
  /**
   * Legacy single-axis classification retained while committed datasets roll
   * forward. New filtering uses `module` + `category` instead.
   */
  kind: TestKind;
  /** Derived from the source label; absent only in pre-migration datasets. */
  module?: TestModule;
  /** Derived from the source label; absent only in pre-migration datasets. */
  category?: TestCategory;
  format: TestFormat;
  /**
   * Fee text exactly as rendered by the source page after HTML entity
   * decoding. This is the authoritative value shown to readers.
   */
  priceText: string | null;
  /** ISO 4217 derived from `priceText`; never used as the display value. */
  parsedCurrency: string | null;
  /** Numeric amount derived from `priceText`, for sorting/filtering only. */
  parsedPrice: number | null;
  /** Whether the derived fields passed the lossless parser's checks. */
  priceParseStatus: PriceParseStatus;
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
  /** Derived by a country rule, a verified geocoder, or a reviewed override. */
  city: string | null;
  citySource?: 'address_rule' | 'geocoder' | 'legacy' | 'admin' | null;
  region: string | null;
  postcode: string | null;
  /** ISO 3166-1 alpha-2, inferred from postcode/region shape. */
  country: string | null;
}

export type CentreLocalizationLocale = 'zh-CN' | 'hi-IN';
export type CentreLocalizationSource = 'amap' | 'mappls' | 'admin';

export type CoordinateSystem = 'WGS84' | 'GCJ02' | 'unknown';

export type GeoEvidencePath =
  | 'page_embed'
  | 'address'
  | 'venue_name'
  | 'plus_code'
  | 'operator_map'
  | 'admin';

export type GeoVerification = 'verified' | 'approximate' | 'unverified' | 'conflicted';

/**
 * The legal/provenance boundary for a coordinate is separate from its
 * accuracy. A rooftop-quality Google point may still be unusable on Apple
 * Maps, while a less precise open-data point may be portable.
 */
export type GeoOrigin =
  | 'ielts_org'
  | 'google_maps_platform'
  | 'overture_maps'
  | 'openstreetmap'
  | 'community_submission'
  | 'administrator'
  | 'third_party_provider'
  | 'unknown';

export type GeoDisplayRights =
  | 'any_basemap'
  | 'google_maps_only'
  | 'provider_review_required';

export interface GeoProvenance {
  origin: GeoOrigin;
  displayRights: GeoDisplayRights;
  /** Dataset/provider licence identifier when the source publishes one. */
  license: string | null;
  /** Attribution that must travel with a portable coordinate, if applicable. */
  attribution: string | null;
  /** Durable source record identifier, such as an Overture feature ID. */
  sourceRecordId: string | null;
}

/**
 * Local-language display text layered on top of IELTS.org's English record.
 *
 * The English name/address remain canonical so a provider lookup can never
 * silently rewrite the source listing. Name and address provenance are kept
 * separately because a reviewed name can be combined with a provider-derived
 * reverse-geocoded address.
 */
export interface CentreLocalization {
  locale: CentreLocalizationLocale;
  name: string | null;
  address: string | null;
  nameSource: CentreLocalizationSource | null;
  addressSource: CentreLocalizationSource | null;
}

export interface Geo {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  source: GeoSource;
  /** All persisted coordinates are normalized to WGS-84. */
  coordinateSystem: 'WGS84';
  /**
   * `verified` requires corroboration by two different evidence paths. An
   * administrator override is the sole single-path exception.
   */
  verification: GeoVerification;
  /** Evidence paths that support the selected point. */
  evidencePaths: GeoEvidencePath[];
  /** Distance between the two corroborating paths, when available. */
  agreementKm: number | null;
  /** 0..1 from the scoring rule in DEV_PLAN §5.3. */
  confidence: number;
  /**
   * Explicit on newly acquired coordinates. Older committed rows are handled
   * by the fail-closed source mapping in geo-policy.ts until they are migrated.
   */
  provenance?: GeoProvenance;
  /**
   * Internal: carried out of the scoring step so the caller can lift it onto
   * `Centre.googlePlaceId`. Not persisted here — see that field.
   */
  placeId?: string | null;
  /** Internal structured components carried out of candidate resolution. */
  resolvedCity?: string | null;
  resolvedRegion?: string | null;
  resolvedPostcode?: string | null;
}

/** Provenance: which source listed this centre, and when we last saw it. */
export interface CentreSourceRef {
  source: string;
  externalSlug: string;
  url: string;
  seenAt: string;
  stillPresent: boolean;
}

/** Contact values exactly as published by the source page, deduplicated by identity. */
export interface CentreContactInformation {
  phones: string[];
  emails: string[];
  websites: string[];
}

/** A manually curated operator-declared location that has not opened yet. */
export interface FutureOpening {
  source: 'ielts_usa_network';
  sourceUrl: string;
  sourceLabel: string;
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
  /**
   * Optional local-language evidence for search and matching. It is never
   * rendered as centre identity or address because provider text can be stale.
   */
  localizations?: CentreLocalization[];
  /** All contact values found across every IELTS.org page merged into this centre. */
  contact: CentreContactInformation;
  /** @deprecated Use `contact.phones`; retained for dataset compatibility. */
  phone: string | null;
  /** Null when no coordinate could be resolved at any precision. */
  geo: Geo | null;
  /**
   * A durably storable opaque Google identifier. Legacy datasets also contain
   * restricted Google coordinates during migration; geo-policy.ts prevents
   * those coordinates and this identifier from leaking into non-Google feeds.
   */
  googlePlaceId: string | null;
  formats: TestFormat[];
  offerings: TestOffering[];
  /** Original fee string belonging to the lowest verified parsed amount. */
  priceFromText: string | null;
  /** Lowest verified parsed amount, for list-view sorting only. */
  parsedPriceFrom: number | null;
  parsedCurrency: string | null;
  bookingUrl: string | null;
  /** True only when IELTS.org's country listing marks this centre for One Skill Retake. */
  offersOneSkillRetake?: boolean;
  /**
   * IELTS.org publishes OSR for this venue but no full Academic, General
   * Training, UKVI or SELT test after all duplicate source pages are merged.
   */
  oneSkillRetakeOnly?: boolean;
  /** Present only when the operator identifies this as a future opening. */
  futureOpening?: FutureOpening;
  /**
   * Listing eligibility, not evidence that a centre is currently open.
   * Requires at least one offering carrying source-published fee text, except
   * for an explicit IELTS.org OSR-only listing.
   */
  isPublishable: boolean;
  /** Cross-source agreement, 0..1. */
  confidence: number;
  sources: CentreSourceRef[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export type MapDisplayTarget = 'google' | 'apple' | 'neutral';
export type GeoExportStatus = 'displayable' | 'suppressed' | 'missing';

export interface CentreGeoPolicy {
  target: MapDisplayTarget;
  status: GeoExportStatus;
  provenance: GeoProvenance | null;
  reason: string;
}

/**
 * A provider-safe client record. Restricted coordinates and provider
 * identifiers are removed rather than relying on each client to remember the
 * policy.
 */
export interface CentreMapExport
  extends Omit<Centre, 'geo' | 'googlePlaceId'> {
  geo: Geo | null;
  geoPolicy: CentreGeoPolicy;
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
  contact: CentreContactInformation;
  /** @deprecated Use `contact.phones`; retained for compatibility with overrides. */
  phone: string | null;
  /** Coordinate lifted from the page's static-map URL, if present. */
  embeddedGeo: {
    lat: number;
    lng: number;
    coordinateSystem: CoordinateSystem;
  } | null;
  offerings: TestOffering[];
  bookingUrl: string | null;
  /** Filled from IELTS.org's country listing after the detail page is parsed. */
  offersOneSkillRetake?: boolean;
  /** Source card publishes OSR without a full-test delivery format. */
  oneSkillRetakeOnly?: boolean;
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
  /** Unique centre slugs discovered specifically through the XML sitemap. */
  sitemapSlugs: number;
  /** Unique centre slugs in the union of sitemap and country-listing discovery. */
  discoveredSlugs?: number;
  pagesParsed: number;
  matchedCountry: number;
  afterDedup: number;
  publishable: number;
  byOperator: Record<string, number>;
  byGeoPrecision: Record<string, number>;
  /** Records with no coordinate at all — listed, but not mappable. */
  ungeocoded: number;
}
