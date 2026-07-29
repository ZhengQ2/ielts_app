import type {
  Centre,
  CentreLocalization,
  CentreLocalizationLocale,
} from '@ielts-map/core';
import {
  DEFAULT_AMAP_REQUEST_BUDGET,
  DEFAULT_MAPPLS_REQUEST_BUDGET,
  AMAP_POI_AROUND_URL,
  MAPPLS_REVERSE_GEOCODE_URL,
} from './config.ts';
import {
  fetchAmapResponse,
  fetchProviderResponse,
  GeocodeCache,
  mapplsRequestControl,
  ProviderBudgetExhaustedError,
  serialiseAmap,
  wgs84ToGcj02,
  type ProviderContext,
} from './geocode.ts';
import { isPinnable } from '@ielts-map/core';

export interface LocalizationStats {
  updated: number;
  alreadyLocalized: number;
  skippedCoarse: number;
  skippedNoKey: number;
  skippedBudget: number;
  unmatched: number;
  failed: number;
}

export interface LocalizeOptions {
  concurrency?: number;
  force?: boolean;
  /** Share the ingest run's provider budgets; a finite local budget is used when omitted. */
  providerContext?: ProviderContext;
  onProgress?: (done: number, total: number) => void;
}

const LOCALIZABLE_PRECISIONS = new Set(['rooftop', 'street']);
const HAN = /\p{Script=Han}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;

/**
 * Add local-language matching evidence without changing canonical source text
 * or coordinates. Localized addresses are searchable but never displayed.
 * Reverse geocoding is deliberately restricted to precise pins so a
 * city-centroid result cannot masquerade as street-level evidence.
 */
export async function localizeCentres(
  centres: Centre[],
  options: LocalizeOptions = {},
): Promise<LocalizationStats> {
  const stats: LocalizationStats = {
    updated: 0,
    alreadyLocalized: 0,
    skippedCoarse: 0,
    skippedNoKey: 0,
    skippedBudget: 0,
    unmatched: 0,
    failed: 0,
  };
  const candidates = centres.filter((centre) => ['CN', 'IN'].includes(centre.address.country ?? ''));
  let cursor = 0;
  let done = 0;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const providerContext =
    options.providerContext ??
    new GeocodeCache({
      amapBudget: DEFAULT_AMAP_REQUEST_BUDGET,
      mapplsBudget: DEFAULT_MAPPLS_REQUEST_BUDGET,
    });

  const worker = async () => {
    while (cursor < candidates.length) {
      const centre = candidates[cursor++]!;
      try {
        const outcome = await localizeCentre(
          centre,
          options.force ?? false,
          providerContext,
        );
        stats[outcome]++;
      } catch (error) {
        stats.failed++;
        console.warn(`    localization failed for "${centre.name}": ${(error as Error).message}`);
      } finally {
        done++;
        options.onProgress?.(done, candidates.length);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return stats;
}

type LocalizationOutcome = Exclude<keyof LocalizationStats, 'failed'>;

async function localizeCentre(
  centre: Centre,
  force: boolean,
  providerContext: ProviderContext,
): Promise<LocalizationOutcome> {
  if (
    !centre.geo ||
    !LOCALIZABLE_PRECISIONS.has(centre.geo.precision) ||
    !isPinnable(centre.geo)
  ) {
    return 'skippedCoarse';
  }

  const locale = localeFor(centre);
  if (!locale) return 'skippedNoKey';
  const existing = centre.localizations?.find((entry) => entry.locale === locale);
  if (!force && existing?.address) return 'alreadyLocalized';

  let address: string | null;
  let addressSource: CentreLocalization['addressSource'];
  if (locale === 'zh-CN') {
    if (!process.env.AMAP_API_KEY) return 'skippedNoKey';
    const poi = await searchAmapPoi(centre, providerContext);
    if (poi === BUDGET_EXHAUSTED) return 'skippedBudget';
    if (!poi) return 'unmatched';
    const next: CentreLocalization = {
      locale,
      // English-to-Chinese POI lookup is strong enough to corroborate an
      // address, but nearby sub-POIs often have a more specific name than the
      // actual test centre. Only reviewed names are published automatically.
      name: existing?.nameSource === 'admin' ? existing.name : null,
      address: existing?.addressSource === 'admin' ? existing.address : poi.address,
      nameSource: existing?.nameSource === 'admin' ? 'admin' : null,
      addressSource: existing?.addressSource === 'admin' ? 'admin' : 'amap',
    };
    centre.localizations = replaceLocalization(centre.localizations, next);
    return 'updated';
  } else {
    if (!process.env.MAPPLS_API_KEY) return 'skippedNoKey';
    const localized = await reverseMappls(centre, providerContext);
    if (localized === BUDGET_EXHAUSTED) return 'skippedBudget';
    address = localized;
    addressSource = 'mappls';
  }
  if (!address) return 'unmatched';

  const next: CentreLocalization = {
    locale,
    name: existing?.name ?? null,
    address,
    nameSource: existing?.nameSource ?? null,
    addressSource,
  };
  centre.localizations = replaceLocalization(centre.localizations, next);
  return 'updated';
}

function localeFor(centre: Centre): CentreLocalizationLocale | null {
  switch (centre.address.country) {
    case 'CN':
      return 'zh-CN';
    case 'IN':
      return 'hi-IN';
    default:
      return null;
  }
}

interface AmapPoi {
  name: string;
  address: string;
}

const BUDGET_EXHAUSTED = Symbol('provider budget exhausted');

/**
 * AMap understands many specific English institution names and returns the
 * domestic Chinese POI. Requiring a nearby, category-compatible POI prevents
 * a merely fluent reverse-geocoded address from legitimising a wrong campus.
 */
async function searchAmapPoi(
  centre: Centre,
  providerContext: ProviderContext,
): Promise<AmapPoi | null | typeof BUDGET_EXHAUSTED> {
  const key = process.env.AMAP_API_KEY!;
  const geo = centre.geo!;
  const educationQuery = /\b(university|college|school|institute|academy)\b/i.test(centre.name);
  const ieltsQuery = /\bIELTS\b/i.test(centre.name);
  if (!educationQuery && !ieltsQuery) return null;
  if (!providerContext.allowAmapRequest()) return BUDGET_EXHAUSTED;

  // The persisted dataset has one coordinate contract: WGS-84. AMap expects
  // GCJ-02, so conversion happens exactly at this provider boundary.
  const gcj = wgs84ToGcj02(geo.lat, geo.lng);
  const url = new URL(AMAP_POI_AROUND_URL);
  url.searchParams.set('key', key);
  url.searchParams.set('keywords', centre.name);
  url.searchParams.set('location', `${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`);
  url.searchParams.set('radius', '5000');
  url.searchParams.set('sortrule', 'weight');
  url.searchParams.set('page_size', '10');

  const response = await serialiseAmap(() => fetchAmapResponse(url));
  if (!response.ok) throw new Error(`AMap HTTP ${response.status}`);
  const body = (await response.json()) as {
    status?: string;
    info?: string;
    pois?: Array<{
      name?: unknown;
      address?: unknown;
      distance?: unknown;
      type?: unknown;
      pname?: unknown;
      cityname?: unknown;
      adname?: unknown;
    }>;
  };
  if (body.status !== '1') throw new Error(`AMap ${body.info ?? 'UNKNOWN'}`);

  const expectedNumbers = sourceStreetNumbers(centre.address.lines);

  for (const hit of body.pois ?? []) {
    const name = text(hit.name);
    const distance = Number(hit.distance);
    const type = text(hit.type) ?? '';
    if (!name || !HAN.test(name) || !Number.isFinite(distance) || distance > 5000) continue;
    const isSchool = /科教文化服务;学校/.test(type);
    const isIeltsVenue = /(?:雅思|IELTS).*(?:考点|考试|机考|中心)/i.test(name);
    if (!isSchool && !isIeltsVenue) continue;

    const address = joinChineseAddress([
      text(hit.pname),
      text(hit.cityname),
      text(hit.adname),
      text(hit.address),
    ]);
    if (!address || !HAN.test(address)) continue;
    if (
      expectedNumbers.length > 0 &&
      !expectedNumbers.some((number) => address.includes(`${number}号`))
    ) {
      continue;
    }
    return { name, address };
  }
  return null;
}

async function reverseMappls(
  centre: Centre,
  providerContext: ProviderContext,
): Promise<string | null | typeof BUDGET_EXHAUSTED> {
  const key = process.env.MAPPLS_API_KEY!;
  const geo = centre.geo!;
  const url = new URL(MAPPLS_REVERSE_GEOCODE_URL);
  url.searchParams.set('access_token', key);
  url.searchParams.set('lat', String(geo.lat));
  url.searchParams.set('lng', String(geo.lng));
  url.searchParams.set('lang', 'hi');

  let response: Response;
  try {
    response = await fetchProviderResponse(
      url,
      { headers: { accept: 'application/json' } },
      mapplsRequestControl(providerContext),
    );
  } catch (error) {
    if (error instanceof ProviderBudgetExhaustedError) return BUDGET_EXHAUSTED;
    throw error;
  }
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Mappls HTTP ${response.status}`);
  const body = (await response.json()) as {
    responseCode?: number;
    results?: Array<{ formatted_address?: unknown; pincode?: unknown }>;
  };
  if (body.responseCode !== 200) {
    throw new Error(`Mappls response ${body.responseCode ?? 'UNKNOWN'}`);
  }
  const result = body.results?.[0];
  const expectedPostcode = centre.address.postcode?.replace(/\D/g, '') ?? '';
  const actualPostcode = text(result?.pincode)?.replace(/\D/g, '') ?? '';
  if (expectedPostcode && expectedPostcode !== actualPostcode) return null;
  const address = text(result?.formatted_address);
  return address && DEVANAGARI.test(address) ? address : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function joinChineseAddress(parts: Array<string | null>): string {
  let joined = '';
  for (const part of parts) {
    if (!part) continue;
    if (!joined.includes(part)) joined += part;
  }
  return joined;
}

function replaceLocalization(
  entries: CentreLocalization[] | undefined,
  next: CentreLocalization,
): CentreLocalization[] {
  return [
    ...(entries ?? []).filter((entry) => entry.locale !== next.locale),
    next,
  ].sort((a, b) => a.locale.localeCompare(b.locale));
}

function streetNumbers(value: string | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/\d{1,5}/g)]
    .map((match) => match[0]!)
    .filter((number) => !/^0+$/.test(number));
}

function sourceStreetNumbers(lines: string[]): string[] {
  const streetish = lines.filter((line) =>
    /(?:\b(?:road|rd|street|st|avenue|ave|boulevard|lane|highway|expressway|route)\b|(?:lu|jie|dadao)\b)/i.test(line),
  );
  return streetNumbers(streetish.join(' '));
}
