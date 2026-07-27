import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeoCandidate, GeoPrecision } from '@ielts-map/core';
import { GEOCODE_CACHE, NOMINATIM_DELAY_MS, NOMINATIM_URL, USER_AGENT } from './config.ts';

/**
 * Geocoding provider registry (DEV_PLAN §5.3). Only Nominatim is wired up:
 * Canada geocodes cleanly with it and it needs no key, so the MVP is not gated
 * on a paid provider. Google/Mapbox/Amap/Kakao slot in behind the same
 * interface when a country needs them.
 */

export interface GeocodeQuery {
  /** Free-text query — either the full address or the centre name + city. */
  text: string;
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

function precisionFromRank(hit: NominatimHit): GeoPrecision {
  if (hit.type === 'postcode') return 'postcode';
  const rank = hit.place_rank ?? 0;
  if (rank >= 30) return 'rooftop';
  if (rank >= 26) return 'street';
  if (rank >= 21) return 'postcode';
  if (rank >= 13) return 'city';
  return 'country';
}

export const nominatim: GeocodeProvider = {
  name: 'nominatim',
  async lookup(q) {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', q.text);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '3');
    if (q.country) url.searchParams.set('countrycodes', q.country.toLowerCase());

    const res = await serialise(() =>
      fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }),
    );
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status} for "${q.text}"`);
    const hits = (await res.json()) as NominatimHit[];

    return hits.map((h) => ({
      lat: Number(h.lat),
      lng: Number(h.lon),
      precision: precisionFromRank(h),
      echoedPostcode: h.address?.postcode ?? null,
      echoedCity:
        h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? null,
      echoedCountry: h.address?.country_code?.toUpperCase() ?? null,
    }));
  },
};

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
    const key = `${provider.name}|${q.country ?? ''}|${q.text}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    let result: GeocodeCandidateRaw[];
    try {
      result = await provider.lookup(q);
    } catch (err) {
      console.warn(`    geocode failed: ${(err as Error).message}`);
      result = [];
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
