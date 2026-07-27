import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeoCandidate, GeoPrecision } from '@ielts-map/core';
import {
  GEOCODE_CACHE,
  GOOGLE_GEOCODE_URL,
  NOMINATIM_DELAY_MS,
  NOMINATIM_URL,
  USER_AGENT,
} from './config.ts';

/**
 * Geocoding provider registry (DEV_PLAN §5.3).
 *
 * Nominatim needs no key, so a clone with no credentials still builds the whole
 * dataset — the MVP is never gated on a paid provider. Google is used when
 * GOOGLE_MAPS_API_KEY is set, because its Canadian street coverage is
 * materially better on the addresses Nominatim cannot resolve. Amap and Kakao
 * slot in behind the same interface if CN/KR ever come into scope.
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
}

export interface GeocodeProvider {
  name: GeoCandidate['source'];
  lookup(q: GeocodeQuery): Promise<GeocodeCandidateRaw[]>;
}

export interface GeocodeCandidateRaw {
  lat: number;
  lng: number;
  precision: GeoPrecision;
  echoedPostcode: string | null;
  echoedCity: string | null;
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

    const res = await serialise(() =>
      fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }),
    );
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for ${url.search}`);
    const hits = (await res.json()) as NominatimHit[];

    return hits.map((h) => {
      const echoedCity =
        h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? null;
      return {
        lat: Number(h.lat),
        lng: Number(h.lon),
        precision: precisionFrom(h, echoedCity),
        echoedPostcode: h.address?.postcode ?? null,
        echoedCity,
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

interface GoogleResult {
  formatted_address?: string;
  place_id?: string;
  types?: string[];
  geometry?: { location?: { lat: number; lng: number }; location_type?: string };
  address_components?: { long_name: string; short_name: string; types: string[] }[];
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
  async lookup(q) {
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

    const res = await fetch(url, { headers: { accept: 'application/json' } });
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
          precision: googlePrecision(r),
          echoedPostcode: component(r, 'postal_code'),
          echoedCity:
            component(r, 'locality') ??
            component(r, 'postal_town') ??
            component(r, 'sublocality') ??
            component(r, 'administrative_area_level_2'),
          echoedCountry: component(r, 'country', true),
          placeId: r.place_id ?? null,
        },
      ];
    });
  },
};

/**
 * Provider chain per country (DEV_PLAN §5.3). Google first where a key exists —
 * its Canadian coverage is materially better — with Nominatim as the always
 * available fallback. Local providers (Amap, Kakao) slot in here per country
 * when those markets come into scope.
 */
export function providerChain(_country: string | null | undefined): GeocodeProvider[] {
  return process.env.GOOGLE_MAPS_API_KEY ? [google, nominatim] : [nominatim];
}

/** Disk-backed memo so re-runs never re-hit the geocoder. */
export class GeocodeCache {
  private map = new Map<string, GeocodeCandidateRaw[]>();
  private dirty = false;
  /** When disabled, every lookup returns nothing and no request is made. */
  private readonly disabled: boolean;

  constructor(opts: { disabled?: boolean } = {}) {
    this.disabled = opts.disabled ?? false;
  }

  async load(): Promise<void> {
    try {
      const json = JSON.parse(await fs.readFile(GEOCODE_CACHE, 'utf8')) as Record<
        string,
        GeocodeCandidateRaw[]
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
    const key = `v${MAPPING_VERSION}|${provider.name}|${q.country ?? ''}|${
      q.structured ? `s:${JSON.stringify(q.structured)}` : q.text
    }`;
    const hit = this.map.get(key);
    if (hit) return hit;

    let result: GeocodeCandidateRaw[];
    try {
      result = await provider.lookup(q);
    } catch (err) {
      // Deliberately NOT cached. A rate-limited or failed request is not the
      // same as "this address has no match", and storing it as an empty result
      // poisons the cache permanently — the next run would skip the lookup and
      // silently leave the centre unlocated.
      console.warn(`    geocode failed (not cached): ${(err as Error).message}`);
      return [];
    }

    this.map.set(key, result);
    this.dirty = true;
    return result;
  }
}

/** Attach the provider name so scored candidates carry their provenance. */
export function toCandidates(
  raws: GeocodeCandidateRaw[],
  source: GeoCandidate['source'],
): GeoCandidate[] {
  return raws.map((r) => ({ ...r, source }));
}
