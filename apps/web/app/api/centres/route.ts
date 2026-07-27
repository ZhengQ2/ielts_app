import { NextResponse } from 'next/server';
import { dataset } from '@ielts-map/core/dataset';
import { filterCentres, sortCentres, type Operator, type SortKey } from '@ielts-map/core';

/**
 * Read-only JSON feed of the directory.
 *
 * This is the seam the mobile app will use: it runs the same `filterCentres` /
 * `sortCentres` from `@ielts-map/core` that the web UI does, so an iOS or
 * Android client gets identical results without reimplementing the rules.
 *
 * The dataset is bundled at build time, so this reads no database and does no
 * I/O — it is a pure function of the query string.
 */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const operators = params.getAll('operator') as Operator[];
  const maxPriceParam = params.get('maxPrice');
  const latParam = params.get('lat');
  const lngParam = params.get('lng');
  const withinKmParam = params.get('withinKm');

  const near =
    latParam && lngParam && Number.isFinite(Number(latParam)) && Number.isFinite(Number(lngParam))
      ? { lat: Number(latParam), lng: Number(lngParam) }
      : undefined;

  const centres = sortCentres(
    filterCentres(dataset.centres, {
      q: params.get('q') ?? undefined,
      city: params.get('city') ?? undefined,
      operators: operators.length ? operators : undefined,
      maxPrice: maxPriceParam ? Number(maxPriceParam) : undefined,
      includeInactive: params.get('includeInactive') === 'true',
      near,
      withinKm: withinKmParam ? Number(withinKmParam) : undefined,
    }),
    (params.get('sort') as SortKey | null) ?? (near ? 'distance' : 'name'),
  );

  return NextResponse.json({
    version: dataset.version,
    country: dataset.country,
    generatedAt: dataset.generatedAt,
    count: centres.length,
    centres,
  });
}
