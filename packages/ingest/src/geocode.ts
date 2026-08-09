import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import type {
  GeoCandidate,
  GeoEvidencePath,
  GeoPrecision,
} from '@ielts-map/core';
import {
  AMAP_GEOCODE_URL,
  AMAP_MIN_INTERVAL_MS,
  AMAP_POI_TEXT_URL,
  AMAP_REQUEST_TIMEOUT_MS,
  GEOCODE_CACHE,
  GOOGLE_GEOCODE_URL,
  GOOGLE_PLACE_DETAILS_URL,
  GOOGLE_PLACES_TEXT_SEARCH_URL,
  MAPPLS_GEOCODE_URL,
  MAPPLS_MIN_INTERVAL_MS,
  MAPPLS_PLACE_URL,
  NOMINATIM_DELAY_MS,
  NOMINATIM_URL,
  PROVIDER_REQUEST_TIMEOUT_MS,
  USER_AGENT,
} from './config.ts';

/**
 * Geocoding provider registry (DEV_PLAN §5.3).
 *
 * A configured production run uses Google. Nominatim remains a deliberately
 * slow, no-key development fallback so contributors can exercise the pipeline
 * without credentials. AMap and Mappls are country-specific corroborating
 * providers for China and India.
 */

export interface GeocodeQuery {
  /** Free-text query — either the full address or the centre name + city. */
  text?: string;
  /**
   * Structured components. Far more accurate than free text for addresses
   * carrying unit/suite noise, but Nominatim forbids mixing the two, so a query
   * uses either `text` or `structured`, never both.
   */
  structured?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postalcode?: string | null;
  };
  /** ISO 3166-1 alpha-2 to constrain the search to. */
  country?: string | null;
  /**
   * A durable Google Place ID used only to request transient localized text.
   * Google permits Place IDs to be stored; returned place content is never
   * included in our cache or published dataset.
   */
  placeId?: string | null;
}

/**
 * Gates the per-request budgets for providers that can issue more than one
 * billable request per lookup (Mappls geocode + Place Details, AMap POI
 * search). `GeocodeCache` implements this so a lookup's actual HTTP requests,
 * not just its logical call, count against the ceiling.
 */
export interface ProviderContext {
  /** Consumes one unit of Google request budget per physical HTTP attempt. */
  allowGoogleRequest(kind: 'geocode' | 'places' | 'amap_places'): boolean;
  /** Consumes one unit of AMap request budget; false once exhausted for this run. */
  allowAmapRequest(): boolean;
  /** Consumes one unit of Mappls request budget; false once exhausted for this run. */
  allowMapplsRequest(): boolean;
}

/** Used when a provider is exercised directly (e.g. tests) outside a GeocodeCache. */
const UNLIMITED_CONTEXT: ProviderContext = {
  allowGoogleRequest: () => true,
  allowAmapRequest: () => true,
  allowMapplsRequest: () => true,
};

export interface GeocodeProvider {
  name: GeoCandidate['source'];
  lookup(q: GeocodeQuery, ctx?: ProviderContext): Promise<GeocodeCandidateRaw[]>;
}

class ProviderUnavailableError extends Error {}
export class ProviderBudgetExhaustedError extends Error {
  readonly provider: 'google' | 'amap' | 'mappls';

  constructor(provider: 'google' | 'amap' | 'mappls') {
    super(`${provider} request budget exhausted`);
    this.provider = provider;
  }
}

export interface GeocodeCandidateRaw {
  lat: number;
  lng: number;
  coordinateSystem: 'WGS84';
  precision: GeoPrecision;
  echoedPostcode: string | null;
  echoedCity: string | null;
  echoedRegion: string | null;
  echoedCountry: string | null;
  /**
   * Google only. Per DEV_PLAN §7 this is the one Google-derived value we treat
   * as durably storable — Google's terms exempt Place IDs from the caching
   * limit that applies to everything else they return.
   */
  placeId?: string | null;
}

interface NominatimHit {
  lat: string;
  lon: string;
  place_rank?: number;
  type?: string;
  address?: {
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country_code?: string;
  };
}

/** Serialises every Nominatim call — their policy is a hard 1 req/second. */
let nominatimChain: Promise<unknown> = Promise.resolve();
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(fn, fn);
  nominatimChain = run.then(
    () => new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS)),
    () => new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS)),
  );
  return run;
}

/** Keep AMap below its per-key QPS ceiling even when centres resolve concurrently. */
let amapChain: Promise<unknown> = Promise.resolve();
export function serialiseAmap<T>(fn: () => Promise<T>): Promise<T> {
  const run = amapChain.then(fn, fn);
  amapChain = run.then(
    () => new Promise((resolve) => setTimeout(resolve, AMAP_MIN_INTERVAL_MS)),
    () => new Promise((resolve) => setTimeout(resolve, AMAP_MIN_INTERVAL_MS)),
  );
  return run;
}

/** Keep Mappls below its per-key QPS ceiling even when centres resolve concurrently. */
let mapplsChain: Promise<unknown> = Promise.resolve();
export function serialiseMappls<T>(fn: () => Promise<T>): Promise<T> {
  const run = mapplsChain.then(fn, fn);
  mapplsChain = run.then(
    () => new Promise((resolve) => setTimeout(resolve, MAPPLS_MIN_INTERVAL_MS)),
    () => new Promise((resolve) => setTimeout(resolve, MAPPLS_MIN_INTERVAL_MS)),
  );
  return run;
}

const platformFetch = globalThis.fetch;
const amapAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: 1,
});
const RESOLVE_PROVIDER_SOCKETS = 8;
const providerAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: RESOLVE_PROVIDER_SOCKETS,
});

/**
 * AMap currently advertises IPv6 addresses that are intermittently unreachable
 * from GitHub/AWS runners. Node's fetch waits for those connection attempts,
 * whereas an IPv4 HTTPS request is stable. Tests still use the injected global
 * fetch so provider behavior remains straightforward to mock.
 */
export async function fetchAmapResponse(url: URL): Promise<Response> {
  if (globalThis.fetch !== platformFetch) {
    return fetch(url, { headers: { accept: 'application/json' } });
  }

  return new Promise<Response>((resolve, reject) => {
    const request = https.get(
      url,
      {
        agent: amapAgent,
        family: 4,
        timeout: AMAP_REQUEST_TIMEOUT_MS,
        headers: { accept: 'application/json' },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              headers,
            }),
          );
        });
      },
    );
    request.on('timeout', () =>
      request.destroy(
        new Error(`AMap request exceeded ${AMAP_REQUEST_TIMEOUT_MS}ms`),
      ),
    );
    request.on('error', reject);
  });
}

/**
 * Retry transport failures and explicitly transient HTTP responses only.
 * Provider-declared data errors are handled by each provider and are never
 * retried, so malformed addresses do not consume the request budget.
 */
export async function fetchProviderResponse(
  input: string | URL,
  init?: RequestInit,
  control: {
    beforeAttempt?: () => void;
    schedule?: (fn: () => Promise<Response>) => Promise<Response>;
  } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const issueRequest = async () => {
        control.beforeAttempt?.();
        return globalThis.fetch !== platformFetch
          ? fetch(input, {
              ...init,
              signal: init?.signal ?? AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
            })
          : fetchProviderIpv4(input, init);
      };
      const response = control.schedule
        ? await control.schedule(issueRequest)
        : await issueRequest();
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 2) {
        return response;
      }
    } catch (error) {
      if (error instanceof ProviderBudgetExhaustedError) throw error;
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 3 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error('Provider request failed');
}

function fetchProviderIpv4(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const body =
    typeof init?.body === 'string' || Buffer.isBuffer(init?.body)
      ? init.body
      : undefined;

  return new Promise<Response>((resolve, reject) => {
    const request = https.request(
      url,
      {
        agent: providerAgent,
        family: 4,
        method: init?.method ?? 'GET',
        timeout: PROVIDER_REQUEST_TIMEOUT_MS,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(name, item);
            } else if (value !== undefined) {
              responseHeaders.set(name, String(value));
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    request.on('timeout', () =>
      request.destroy(
        new Error(`Provider request exceeded ${PROVIDER_REQUEST_TIMEOUT_MS}ms`),
      ),
    );
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * `place_rank` alone is not enough: Nominatim returns large municipalities as
 * administrative boundaries with a rank low enough to look country-level, which
 * would label Edmonton's centroid 'country' and render a pin in the middle of
 * Canada. The floor is therefore set by what the result actually resolved — a
 * hit that echoes a city is city-level by definition.
 */
function precisionFrom(hit: NominatimHit, city: string | null): GeoPrecision {
  if (hit.type === 'postcode') return 'postcode';
  const rank = hit.place_rank ?? 0;
  if (rank >= 30) return 'rooftop';
  if (rank >= 26) return 'street';
  if (rank >= 21) return 'postcode';
  if (rank >= 13 || city) return 'city';
  return 'country';
}

export const nominatim: GeocodeProvider = {
  name: 'nominatim',
  async lookup(q) {
    const url = new URL(NOMINATIM_URL);
    if (q.structured) {
      for (const [key, value] of Object.entries(q.structured)) {
        if (value) url.searchParams.set(key, value);
      }
    } else if (q.text) {
      url.searchParams.set('q', q.text);
    } else {
      return [];
    }
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '3');
    if (q.country) url.searchParams.set('countrycodes', q.country.toLowerCase());

    const res = await fetchProviderResponse(
      url,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
      { schedule: serialise },
    );
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for ${url.search}`);
    const hits = (await res.json()) as NominatimHit[];

    return hits.map((h) => {
      const echoedCity =
        h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? null;
      return {
        lat: Number(h.lat),
        lng: Number(h.lon),
        coordinateSystem: 'WGS84',
        precision: precisionFrom(h, echoedCity),
        echoedPostcode: h.address?.postcode ?? null,
        echoedCity,
        echoedRegion: h.address?.state ?? null,
        echoedCountry: h.address?.country_code?.toUpperCase() ?? null,
      };
    });
  },
};

/**
 * Bump when the raw-response → candidate mapping changes. Cached entries store
 * the *mapped* result, so without this a mapping fix would be silently ignored
 * for every query already on disk.
 */
const MAPPING_VERSION = 2;
const EMPTY_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface GeocodeCacheRecord {
  results: GeocodeCandidateRaw[];
  cachedAt: string;
}

type GeocodeCacheEntry = GeocodeCandidateRaw[] | GeocodeCacheRecord;

interface GoogleResult {
  formatted_address?: string;
  place_id?: string;
  types?: string[];
  geometry?: { location?: { lat: number; lng: number }; location_type?: string };
  address_components?: { long_name: string; short_name: string; types: string[] }[];
}

interface GooglePlace {
  id?: string;
  types?: string[];
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: {
    longText?: string;
    shortText?: string;
    types?: string[];
  }[];
}

function component(r: GoogleResult, type: string, short = false): string | null {
  const c = r.address_components?.find((a) => a.types.includes(type));
  return c ? (short ? c.short_name : c.long_name) : null;
}

/**
 * Google's `location_type` alone is too coarse: APPROXIMATE covers everything
 * from a postcode to a country. The result's `types` say what was actually
 * resolved, so they set the floor.
 */
function googlePrecision(r: GoogleResult): GeoPrecision {
  const types = r.types ?? [];
  if (types.some((t) => ['street_address', 'premise', 'subpremise'].includes(t))) {
    return r.geometry?.location_type === 'ROOFTOP' ? 'rooftop' : 'street';
  }
  if (types.includes('route') || types.includes('intersection')) return 'street';
  if (types.some((t) => t.startsWith('postal_code'))) return 'postcode';
  if (types.some((t) => ['locality', 'sublocality', 'neighborhood', 'postal_town'].includes(t))) {
    return 'city';
  }
  if (types.includes('country')) return 'country';

  switch (r.geometry?.location_type) {
    case 'ROOFTOP':
      return 'rooftop';
    case 'RANGE_INTERPOLATED':
      return 'street';
    case 'GEOMETRIC_CENTER':
      return 'street';
    default:
      return 'city';
  }
}

/**
 * Google Geocoding. Optional: enabled only when GOOGLE_MAPS_API_KEY is present,
 * so a clone with no key still builds the dataset from Nominatim alone.
 *
 * The key is read from the environment and never written to the dataset, the
 * cache or the logs.
 */
export const google: GeocodeProvider = {
  name: 'google',
  async lookup(q, ctx = UNLIMITED_CONTEXT) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return [];

    // Google takes one address string; `components` constrains the country the
    // way Nominatim's countrycodes does.
    const address =
      q.text ??
      [q.structured?.street, q.structured?.city, q.structured?.state, q.structured?.postalcode]
        .filter(Boolean)
        .join(', ');
    if (!address) return [];

    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set('address', address);
    if (q.country) url.searchParams.set('components', `country:${q.country.toUpperCase()}`);
    url.searchParams.set('key', key);

    const res = await fetchProviderResponse(
      url,
      { headers: { accept: 'application/json' } },
      {
        beforeAttempt() {
          if (!ctx.allowGoogleRequest('geocode')) {
            throw new ProviderBudgetExhaustedError('google');
          }
        },
      },
    );
    if (!res.ok) throw new Error(`Google HTTP ${res.status} for "${address}"`);

    const body = (await res.json()) as { status?: string; results?: GoogleResult[]; error_message?: string };
    if (body.status === 'ZERO_RESULTS') return [];
    if (body.status !== 'OK') {
      // Surface the status, never the key.
      throw new Error(`Google ${body.status ?? 'UNKNOWN'} for "${address}"${body.error_message ? `: ${body.error_message}` : ''}`);
    }

    return (body.results ?? []).slice(0, 3).flatMap((r) => {
      const loc = r.geometry?.location;
      if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return [];
      return [
        {
          lat: loc.lat,
          lng: loc.lng,
          coordinateSystem: 'WGS84',
          precision: googlePrecision(r),
          echoedPostcode: component(r, 'postal_code'),
          echoedCity:
            component(r, 'locality') ??
            component(r, 'postal_town') ??
            component(r, 'sublocality') ??
            component(r, 'administrative_area_level_2'),
          echoedRegion: component(r, 'administrative_area_level_1'),
          echoedCountry: component(r, 'country', true),
          placeId: r.place_id ?? null,
        },
      ];
    });
  },

};

function placeComponent(
  place: GooglePlace,
  type: string,
  short = false,
): string | null {
  const component = place.addressComponents?.find((item) =>
    item.types?.includes(type),
  );
  return component ? (short ? component.shortText ?? null : component.longText ?? null) : null;
}

function googlePlacePrecision(place: GooglePlace): GeoPrecision {
  const types = place.types ?? [];
  if (types.includes('country')) return 'country';
  if (
    types.some((type) =>
      [
        'administrative_area_level_1',
        'administrative_area_level_2',
        'locality',
        'postal_town',
      ].includes(type),
    )
  ) {
    return 'city';
  }
  if (types.some((type) => type.startsWith('postal_code'))) return 'postcode';
  if (types.some((type) => ['route', 'intersection'].includes(type))) return 'street';
  // A Places result represents a specific establishment/POI unless its types
  // explicitly identify an administrative area above.
  return 'rooftop';
}

/**
 * Venue-name lookup through Places Text Search (New).
 *
 * This is intentionally separate from Google address geocoding. The resolver
 * supplies a centre/venue name plus coarse locality context, never the full
 * street address, so agreement with an address or page-embedded point is an
 * independent evidence path rather than the same address parsed twice.
 */
export const googlePlaces: GeocodeProvider = {
  name: 'google_places',
  async lookup(q, ctx = UNLIMITED_CONTEXT) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    const textQuery = queryText(q);
    if (!key || !textQuery) return [];

    const body: {
      textQuery: string;
      pageSize: number;
      languageCode: string;
      regionCode?: string;
    } = {
      textQuery,
      pageSize: 3,
      languageCode: 'en',
    };
    if (q.country) body.regionCode = q.country.toUpperCase();

    const res = await fetchProviderResponse(
      GOOGLE_PLACES_TEXT_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'places.id,places.types,places.location,places.addressComponents',
        },
        body: JSON.stringify(body),
      },
      {
        beforeAttempt() {
          if (!ctx.allowGoogleRequest('places')) {
            throw new ProviderBudgetExhaustedError('google');
          }
        },
      },
    );
    if (!res.ok) {
      const error = (await res.json().catch(() => null)) as {
        error?: { status?: string; message?: string };
      } | null;
      throw new Error(
        `Google Places ${error?.error?.status ?? `HTTP ${res.status}`} for "${textQuery}"`,
      );
    }

    const response = (await res.json()) as { places?: GooglePlace[] };
    return (response.places ?? []).slice(0, 3).flatMap((place) => {
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [{
        lat: lat!,
        lng: lng!,
        coordinateSystem: 'WGS84' as const,
        precision: googlePlacePrecision(place),
        echoedPostcode: placeComponent(place, 'postal_code'),
        echoedCity:
          placeComponent(place, 'locality') ??
          placeComponent(place, 'postal_town') ??
          placeComponent(place, 'sublocality') ??
          placeComponent(place, 'administrative_area_level_2'),
        echoedRegion: placeComponent(place, 'administrative_area_level_1'),
        echoedCountry: placeComponent(place, 'country', true),
        placeId: place.id ?? null,
      }];
    });
  },
};

function queryText(q: GeocodeQuery): string {
  return (
    q.text ??
    [q.structured?.street, q.structured?.city, q.structured?.state, q.structured?.postalcode]
      .filter(Boolean)
      .join(', ')
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * AMap returns its mainland-China coordinate system, while the rest of this
 * dataset and Google Maps use WGS-84. Iteratively invert the public
 * WGS-84 → GCJ-02 transform so AMap results do not render several hundred
 * metres away from the roads underneath them.
 */
export function gcj02ToWgs84(lat: number, lng: number): { lat: number; lng: number } {
  let wgsLat = lat;
  let wgsLng = lng;
  for (let i = 0; i < 8; i++) {
    const projected = wgs84ToGcj02(wgsLat, wgsLng);
    wgsLat -= projected.lat - lat;
    wgsLng -= projected.lng - lng;
  }
  return { lat: wgsLat, lng: wgsLng };
}

export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return { lat, lng };
  }

  const pi = Math.PI;
  const a = 6378245;
  const eccentricity = 0.006693421622965943;
  const x = lng - 105;
  const y = lat - 35;
  let dLat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  dLat +=
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3 +
    ((20 * Math.sin(y * pi) + 40 * Math.sin((y / 3) * pi)) * 2) / 3 +
    ((160 * Math.sin((y / 12) * pi) + 320 * Math.sin((y * pi) / 30)) * 2) / 3;
  let dLng =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  dLng +=
    ((20 * Math.sin(6 * x * pi) + 20 * Math.sin(2 * x * pi)) * 2) / 3 +
    ((20 * Math.sin(x * pi) + 40 * Math.sin((x / 3) * pi)) * 2) / 3 +
    ((150 * Math.sin((x / 12) * pi) + 300 * Math.sin((x / 30) * pi)) * 2) / 3;

  const radLat = (lat / 180) * pi;
  const magic = 1 - eccentricity * Math.sin(radLat) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((a * (1 - eccentricity)) / (magic * sqrtMagic)) * pi);
  dLng = (dLng * 180) / ((a / sqrtMagic) * Math.cos(radLat) * pi);
  return { lat: lat + dLat, lng: lng + dLng };
}

interface AmapGeocode {
  country?: unknown;
  province?: unknown;
  city?: unknown;
  district?: unknown;
  street?: unknown;
  number?: unknown;
  location?: unknown;
  level?: unknown;
}

function amapPrecision(level: string | null): GeoPrecision {
  if (!level) return 'city';
  if (/(门牌|兴趣点|楼|建筑)/.test(level)) return 'rooftop';
  if (/(道路|交叉口)/.test(level)) return 'street';
  if (/(省|国家)/.test(level)) return 'country';
  return 'city';
}

/** AMap/Gaode, enabled only for coarse mainland-China records. */
export const amap: GeocodeProvider = {
  name: 'amap',
  async lookup(q, ctx = UNLIMITED_CONTEXT) {
    const key = process.env.AMAP_API_KEY;
    if (!key || q.country?.toUpperCase() !== 'CN') return [];
    const address = queryText(q);
    if (!address) return [];
    if (!ctx.allowAmapRequest()) throw new ProviderBudgetExhaustedError('amap');

    const url = new URL(AMAP_GEOCODE_URL);
    url.searchParams.set('address', address);
    const city = q.structured?.city;
    if (city) url.searchParams.set('city', city);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('key', key);

    const res = await serialiseAmap(() => fetchAmapResponse(url));
    if (!res.ok) throw new Error(`AMap HTTP ${res.status} for "${address}"`);
    const body = (await res.json()) as {
      status?: string;
      info?: string;
      geocodes?: AmapGeocode[];
    };
    if (body.status !== '1') {
      throw new Error(`AMap ${body.info ?? 'UNKNOWN'} for "${address}"`);
    }

    // The API orders geocodes by relevance. Alternatives are not independent
    // evidence and can refer to similarly named places in other provinces.
    return (body.geocodes ?? []).slice(0, 1).flatMap((hit) => {
      const location = stringValue(hit.location);
      if (!location) return [];
      const parts = location.split(',');
      const rawLng = Number(parts[0]);
      const rawLat = Number(parts[1]);
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return [];
      const converted = gcj02ToWgs84(rawLat, rawLng);
      return [{
        lat: converted.lat,
        lng: converted.lng,
        coordinateSystem: 'WGS84',
        precision: amapPrecision(stringValue(hit.level)),
        echoedPostcode: null,
        echoedCity: stringValue(hit.city) ?? stringValue(hit.province),
        echoedRegion: stringValue(hit.province),
        echoedCountry: 'CN',
      }];
    });
  },
};

interface AmapPlace {
  name?: unknown;
  address?: unknown;
  location?: unknown;
  type?: unknown;
  pname?: unknown;
  cityname?: unknown;
  adname?: unknown;
}

const HAN = /[\u3400-\u9fff]/u;

function normalizedPlaceName(value: string): string {
  return value
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•・()（）[\]【】\-—_,，.。&＆/／]/gu, '');
}

function sameLocalizedPlace(a: string, b: string): boolean {
  const left = normalizedPlaceName(a);
  const right = normalizedPlaceName(b);
  return (
    left.length >= 4 &&
    right.length >= 4 &&
    (left === right || left.includes(right) || right.includes(left))
  );
}

/**
 * Chinese venue lookup with no persisted Google content.
 *
 * Google Place IDs are durable and may be stored. We use one to request a
 * Chinese display name transiently, then submit that name to AMap's domestic
 * POI index. Only the resulting AMap coordinate is returned to the disk cache.
 * This fixes English-name recall without pretending that a coordinate-system
 * conversion can repair a lookup for the wrong venue.
 */
export const amapPlaces: GeocodeProvider = {
  name: 'amap_places',
  async lookup(q, ctx = UNLIMITED_CONTEXT) {
    const amapKey = process.env.AMAP_API_KEY;
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (
      !amapKey ||
      !googleKey ||
      q.country?.toUpperCase() !== 'CN' ||
      !q.placeId
    ) {
      return [];
    }

    const detailsUrl = new URL(
      `${GOOGLE_PLACE_DETAILS_URL}/${encodeURIComponent(q.placeId)}`,
    );
    detailsUrl.searchParams.set('languageCode', 'zh-CN');
    detailsUrl.searchParams.set('regionCode', 'CN');
    const detailsResponse = await fetchProviderResponse(
      detailsUrl,
      {
        headers: {
          accept: 'application/json',
          'X-Goog-Api-Key': googleKey,
          'X-Goog-FieldMask': 'displayName,addressComponents',
        },
      },
      {
        beforeAttempt() {
          if (!ctx.allowGoogleRequest('amap_places')) {
            throw new ProviderBudgetExhaustedError('google');
          }
        },
      },
    );
    if (!detailsResponse.ok) {
      const error = (await detailsResponse.json().catch(() => null)) as {
        error?: { status?: string };
      } | null;
      throw new Error(
        `Google Place Details ${error?.error?.status ?? `HTTP ${detailsResponse.status}`}`,
      );
    }

    const localized = (await detailsResponse.json()) as GooglePlace;
    const localizedName = stringValue(localized.displayName?.text);
    if (!localizedName || !HAN.test(localizedName)) return [];
    const localizedRegion =
      placeComponent(localized, 'locality') ??
      placeComponent(localized, 'administrative_area_level_2') ??
      placeComponent(localized, 'administrative_area_level_1');

    if (!ctx.allowAmapRequest()) throw new ProviderBudgetExhaustedError('amap');

    const url = new URL(AMAP_POI_TEXT_URL);
    url.searchParams.set('key', amapKey);
    url.searchParams.set('keywords', localizedName.slice(0, 80));
    if (localizedRegion) {
      url.searchParams.set('region', localizedRegion);
      url.searchParams.set('city_limit', 'true');
    }
    url.searchParams.set('page_size', '5');

    const response = await serialiseAmap(() => fetchAmapResponse(url));
    if (!response.ok) throw new Error(`AMap POI HTTP ${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      info?: string;
      pois?: AmapPlace[];
    };
    if (body.status !== '1') {
      throw new Error(`AMap POI ${body.info ?? 'UNKNOWN'}`);
    }

    return (body.pois ?? []).slice(0, 5).flatMap((hit) => {
      const name = stringValue(hit.name);
      const location = stringValue(hit.location);
      if (!name || !location || !sameLocalizedPlace(localizedName, name)) return [];
      const parts = location.split(',');
      const rawLng = Number(parts[0]);
      const rawLat = Number(parts[1]);
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return [];
      const converted = gcj02ToWgs84(rawLat, rawLng);
      return [{
        lat: converted.lat,
        lng: converted.lng,
        coordinateSystem: 'WGS84' as const,
        // A named POI is a specific establishment, campus or building.
        precision: 'rooftop' as const,
        echoedPostcode: null,
        echoedCity: stringValue(hit.cityname),
        echoedRegion: stringValue(hit.pname),
        echoedCountry: 'CN',
      }];
    });
  },
};

interface MapplsHit {
  eLoc?: unknown;
  eloc?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  lat?: unknown;
  lng?: unknown;
  houseNumber?: unknown;
  houseName?: unknown;
  poi?: unknown;
  street?: unknown;
  locality?: unknown;
  city?: unknown;
  pincode?: unknown;
  geocodeLevel?: unknown;
  actualGeoLevel?: unknown;
  elocAdminType?: unknown;
  type?: unknown;
}

function mapplsPrecision(level: string | null): GeoPrecision {
  const normal = (level ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['housenumber', 'housename', 'poi'].includes(normal)) return 'rooftop';
  if (normal === 'street') return 'street';
  if (['pincode', 'postcode'].includes(normal)) return 'postcode';
  if (['state', 'country'].includes(normal)) return 'country';
  return 'city';
}

function coordinateFromMappls(hit: MapplsHit): { lat: number; lng: number } | null {
  const lat = Number(hit.latitude ?? hit.lat);
  const lng = Number(hit.longitude ?? hit.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function mapplsRequestControl(ctx: ProviderContext): {
  beforeAttempt: () => void;
  schedule: (fn: () => Promise<Response>) => Promise<Response>;
} {
  return {
    beforeAttempt() {
      if (!ctx.allowMapplsRequest()) {
        throw new ProviderBudgetExhaustedError('mappls');
      }
    },
    schedule: serialiseMappls,
  };
}

async function mapplsPlaceDetails(
  eLoc: string,
  key: string,
  ctx: ProviderContext,
): Promise<MapplsHit | null> {
  const url = new URL(`${MAPPLS_PLACE_URL}/${encodeURIComponent(eLoc)}`);
  url.searchParams.set('access_token', key);
  const res = await fetchProviderResponse(
    url,
    { headers: { accept: 'application/json' } },
    mapplsRequestControl(ctx),
  );
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Mappls place details HTTP ${res.status} for eLoc ${eLoc}`);
  return (await res.json()) as MapplsHit;
}

/** Mappls, enabled only for coarse Indian records. */
export const mappls: GeocodeProvider = {
  name: 'mappls',
  async lookup(q, ctx = UNLIMITED_CONTEXT) {
    const key = process.env.MAPPLS_API_KEY;
    if (!key || q.country?.toUpperCase() !== 'IN') return [];
    const address = queryText(q);
    if (!address) return [];
    const url = new URL(MAPPLS_GEOCODE_URL);
    url.searchParams.set('address', address);
    // One best match per query. The caller independently tries structured,
    // raw-address and centre-name queries; treating Mappls' alternate search
    // results as corroborating lookups would incorrectly manufacture
    // agreement or disagreement.
    url.searchParams.set('itemCount', '1');
    url.searchParams.set('actualGeoLevel', '');
    url.searchParams.set('access_token', key);

    const res = await fetchProviderResponse(
      url,
      { headers: { accept: 'application/json' } },
      mapplsRequestControl(ctx),
    );
    if (res.status === 204) return [];
    if (!res.ok) throw new Error(`Mappls HTTP ${res.status} for "${address}"`);
    const body = (await res.json()) as { copResults?: MapplsHit | MapplsHit[] };
    const hits = Array.isArray(body.copResults)
      ? body.copResults
      : body.copResults
        ? [body.copResults]
        : [];

    const candidates: GeocodeCandidateRaw[] = [];
    let coordinateEntitlementMissing = false;
    for (const hit of hits.slice(0, 1)) {
      const eLoc = stringValue(hit.eLoc) ?? stringValue(hit.eloc);
      let detail = coordinateFromMappls(hit) ? hit : null;
      if (!detail && eLoc) {
        detail = await mapplsPlaceDetails(eLoc, key, ctx);
      }
      if (!detail) continue;
      const coordinate = coordinateFromMappls(detail);
      if (!coordinate) {
        if (eLoc) coordinateEntitlementMissing = true;
        continue;
      }
      const level =
        stringValue(hit.geocodeLevel) ??
        stringValue(hit.actualGeoLevel) ??
        stringValue(hit.elocAdminType) ??
        stringValue(detail.type);
      candidates.push({
        ...coordinate,
        coordinateSystem: 'WGS84',
        precision: mapplsPrecision(level),
        echoedPostcode: stringValue(hit.pincode) ?? stringValue(detail.pincode),
        echoedCity: stringValue(hit.city) ?? stringValue(detail.city),
        echoedRegion: null,
        echoedCountry: 'IN',
      });
    }
    if (coordinateEntitlementMissing && candidates.length === 0) {
      // Do not let GeocodeCache persist this as a genuine zero-result lookup.
      // Enabling Mappls' "Location Coordinates" Place Details subtemplate
      // later must cause the same address to be retried.
      throw new ProviderUnavailableError(
        'Mappls Place Details omitted Location Coordinates; enable that subtemplate for this key',
      );
    }
    return candidates;
  },
};

/**
 * Provider chain per country (DEV_PLAN §5.3).
 *
 * A configured production crawler uses Google only. Public Nominatim is a
 * no-key development fallback, not part of recurring bulk automation. Local
 * providers are invoked separately as country-specific corroboration.
 */
export function providerChain(
  _country: string | null | undefined,
  _preferGoogle = false,
): GeocodeProvider[] {
  if (!process.env.GOOGLE_MAPS_API_KEY) return [nominatim];
  // A configured production crawler uses Google only. The public Nominatim
  // service is a development/no-key fallback, never part of a recurring bulk
  // production job.
  return [google];
}

/** A country-specific provider used only after a result remains coarse. */
export function localProviderFor(
  country: string | null | undefined,
): GeocodeProvider | null {
  switch (country?.toUpperCase()) {
    case 'CN':
      return process.env.AMAP_API_KEY ? amap : null;
    case 'IN':
      return process.env.MAPPLS_API_KEY ? mappls : null;
    default:
      return null;
  }
}

/** Disk-backed memo; positive hits persist and empty hits expire after one week. */
export class GeocodeCache implements ProviderContext {
  private map = new Map<string, GeocodeCacheEntry>();
  private dirty = false;
  /** When disabled, every lookup returns nothing and no request is made. */
  private readonly disabled: boolean;
  /** Hard ceiling on billable Google requests for one run. */
  private readonly googleBudget: number;
  /** Hard ceiling on AMap requests for one run (geocode + POI search). */
  private readonly amapBudget: number;
  /** Hard ceiling on Mappls requests for one run (geocode + Place Details). */
  private readonly mapplsBudget: number;
  private readonly emptyResultTtlMs: number;
  private readonly now: () => number;
  private budgetWarned = false;
  private amapBudgetWarned = false;
  private mapplsBudgetWarned = false;
  private unavailableProviders = new Set<GeoCandidate['source']>();

  /** Billable requests actually issued, and lookups served from disk. */
  readonly stats = {
    googleCalls: 0,
    placesCalls: 0,
    nominatimCalls: 0,
    amapCalls: 0,
    amapPlacesCalls: 0,
    mapplsCalls: 0,
    cacheHits: 0,
    budgetSkips: 0,
  };

  constructor(
    opts: {
      disabled?: boolean;
      googleBudget?: number;
      amapBudget?: number;
      mapplsBudget?: number;
      emptyResultTtlMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.disabled = opts.disabled ?? false;
    this.googleBudget = opts.googleBudget ?? Number.POSITIVE_INFINITY;
    this.amapBudget = opts.amapBudget ?? Number.POSITIVE_INFINITY;
    this.mapplsBudget = opts.mapplsBudget ?? Number.POSITIVE_INFINITY;
    this.emptyResultTtlMs = opts.emptyResultTtlMs ?? EMPTY_RESULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Google budget, consumed by every actual attempt, including retries. */
  allowGoogleRequest(kind: 'geocode' | 'places' | 'amap_places'): boolean {
    if (this.stats.googleCalls + this.stats.placesCalls >= this.googleBudget) {
      this.stats.budgetSkips++;
      if (!this.budgetWarned) {
        console.warn(
          `\n    ⚠ Google budget of ${this.googleBudget} requests reached — remaining lookups fall back to what is already cached.`,
        );
        this.budgetWarned = true;
      }
      return false;
    }
    if (kind === 'geocode') {
      this.stats.googleCalls++;
    } else {
      this.stats.placesCalls++;
      if (kind === 'amap_places') this.stats.amapPlacesCalls++;
    }
    return true;
  }

  /** AMap request budget, consumed per actual HTTP request (geocode or POI search). */
  allowAmapRequest(): boolean {
    if (this.stats.amapCalls >= this.amapBudget) {
      this.stats.budgetSkips++;
      if (!this.amapBudgetWarned) {
        console.warn(
          `\n    ⚠ AMap budget of ${this.amapBudget} requests reached — remaining lookups fall back to what is already cached.`,
        );
        this.amapBudgetWarned = true;
      }
      return false;
    }
    this.stats.amapCalls++;
    return true;
  }

  /** Mappls request budget, consumed per actual HTTP request (geocode or Place Details). */
  allowMapplsRequest(): boolean {
    if (this.stats.mapplsCalls >= this.mapplsBudget) {
      this.stats.budgetSkips++;
      if (!this.mapplsBudgetWarned) {
        console.warn(
          `\n    ⚠ Mappls budget of ${this.mapplsBudget} requests reached — remaining lookups fall back to what is already cached.`,
        );
        this.mapplsBudgetWarned = true;
      }
      return false;
    }
    this.stats.mapplsCalls++;
    return true;
  }

  async load(): Promise<void> {
    try {
      const json = JSON.parse(await fs.readFile(GEOCODE_CACHE, 'utf8')) as Record<
        string,
        GeocodeCacheEntry
      >;
      this.map = new Map(Object.entries(json));
    } catch {
      this.map = new Map();
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await fs.mkdir(path.dirname(GEOCODE_CACHE), { recursive: true });
    await fs.writeFile(GEOCODE_CACHE, JSON.stringify(Object.fromEntries(this.map), null, 0), 'utf8');
    this.dirty = false;
  }

  async lookup(provider: GeocodeProvider, q: GeocodeQuery): Promise<GeocodeCandidateRaw[]> {
    if (this.disabled) return [];
    if (this.unavailableProviders.has(provider.name)) return [];
    const key = `v${MAPPING_VERSION}|${provider.name}|${q.country ?? ''}|${
      q.structured ? `s:${JSON.stringify(q.structured)}` : q.text
    }${q.placeId ? `|pid:${q.placeId}` : ''}`;
    const hit = this.map.get(key);
    if (hit !== undefined) {
      const results = Array.isArray(hit) ? hit : hit.results;
      const cachedAt = Array.isArray(hit) ? Number.NaN : Date.parse(hit.cachedAt);
      const emptyResultIsFresh =
        results.length > 0 ||
        (Number.isFinite(cachedAt) && this.now() - cachedAt < this.emptyResultTtlMs);
      if (emptyResultIsFresh) {
        this.stats.cacheHits++;
        return results;
      }
      // Legacy empty arrays had no age and are therefore treated as expired.
      this.map.delete(key);
      this.dirty = true;
    }

    // Paid-provider budgets are consumed inside each transport attempt so a
    // retry can never exceed the hard ceiling.
    if (provider.name === 'nominatim') {
      this.stats.nominatimCalls++;
    }

    let result: GeocodeCandidateRaw[];
    try {
      result = await provider.lookup(q, this);
    } catch (err) {
      // Deliberately NOT cached. A rate-limited or failed request is not the
      // same as "this address has no match", and storing it as an empty result
      // poisons the cache permanently — the next run would skip the lookup and
      // silently leave the centre unlocated.
      if (err instanceof ProviderBudgetExhaustedError) {
        return [];
      } else if (err instanceof ProviderUnavailableError) {
        this.unavailableProviders.add(provider.name);
        console.warn(
          `    ${provider.name} disabled for this run: ${err.message}`,
        );
      } else {
        console.warn(
          `    ${provider.name} failed (not cached): ${(err as Error).message}`,
        );
      }
      return [];
    }

    this.map.set(key, {
      results: result,
      cachedAt: new Date(this.now()).toISOString(),
    });
    this.dirty = true;
    return result;
  }
}

/** Attach the provider name so scored candidates carry their provenance. */
export function toCandidates(
  raws: GeocodeCandidateRaw[],
  source: GeoCandidate['source'],
  evidencePath: GeoEvidencePath,
): GeoCandidate[] {
  return raws.map((r) => ({
    ...r,
    coordinateSystem: 'WGS84',
    echoedRegion: r.echoedRegion ?? null,
    source,
    evidencePath,
  }));
}
