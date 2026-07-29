'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from 'maplibre-gl';
import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
} from 'geojson';

type MatchStatus = 'strong_candidate' | 'possible_candidate';
type StatusFilter = 'all' | MatchStatus | 'no_candidate';

interface PilotCandidate {
  kind?: 'place' | 'address';
  id: string;
  name: string;
  address: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string;
  lng: number;
  lat: number;
  confidence: number;
  sourceLicenses: string[];
}

type MatchDecision = 'accept' | 'review' | 'reject';

interface CandidateMatch {
  status: MatchStatus | 'no_candidate';
  decision?: MatchDecision;
  decisionReasons?: string[];
  score: number;
  nameScore: number;
  addressScore: number;
  cityMatches: boolean;
  postcodeMatches: boolean;
  contactMatches: boolean;
  distanceKm: number;
  evidencePaths: string[];
  candidate: PilotCandidate;
}

interface PilotRecord {
  centre: {
    id: string;
    name: string;
    address: string;
    city: string;
    region: string | null;
    postcode: string | null;
    country: string;
    restrictedCoordinate: { lat: number; lng: number };
    restrictedSource: string;
  };
  match: CandidateMatch | null;
  candidates?: CandidateMatch[];
  diagnosticOnly: true;
  eligibleForMigration: false;
}

interface PilotPayload {
  localOnly: true;
  available: boolean;
  message?: string;
  generatedAt?: string;
  overtureRelease?: string;
  summary?: {
    sampleSize: number;
    countries: number;
    strongCandidates?: number;
    possibleCandidates?: number;
    acceptedCandidates?: number;
    reviewCandidates?: number;
    noCandidates: number;
  };
  records: PilotRecord[];
}

type ComparisonProperties = {
  pilotId: string;
  status: Exclude<StatusFilter, 'all'>;
  selected: boolean;
};

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'strong_candidate', label: 'Accepted' },
  { value: 'possible_candidate', label: 'Review' },
  { value: 'no_candidate', label: 'No candidate' },
];

const EMPTY_COLLECTION: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

function statusOf(record: PilotRecord): StatusFilter {
  return record.match?.status ?? 'no_candidate';
}

function statusLabel(status: StatusFilter): string {
  if (status === 'strong_candidate') return 'Accepted candidate';
  if (status === 'possible_candidate') return 'Review candidate';
  if (status === 'no_candidate') return 'No candidate';
  return 'All';
}

function statusTone(status: StatusFilter): string {
  if (status === 'strong_candidate') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'possible_candidate') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-line bg-white text-muted';
}

function distanceLabel(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 2 : 1)} km`;
}

function comparisonCollections(
  records: PilotRecord[],
  selectedId: string | null,
): {
  current: FeatureCollection<Point, ComparisonProperties>;
  candidates: FeatureCollection<Point, ComparisonProperties>;
  lines: FeatureCollection<LineString, ComparisonProperties>;
} {
  const current: Feature<Point, ComparisonProperties>[] = [];
  const candidates: Feature<Point, ComparisonProperties>[] = [];
  const lines: Feature<LineString, ComparisonProperties>[] = [];

  for (const record of records) {
    if (!record.match) continue;
    const properties: ComparisonProperties = {
      pilotId: record.centre.id,
      status: record.match.status,
      selected: record.centre.id === selectedId,
    };
    const currentCoordinate: [number, number] = [
      record.centre.restrictedCoordinate.lng,
      record.centre.restrictedCoordinate.lat,
    ];
    const candidateCoordinate: [number, number] = [
      record.match.candidate.lng,
      record.match.candidate.lat,
    ];

    current.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: currentCoordinate },
    });
    candidates.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: candidateCoordinate },
    });
    lines.push({
      type: 'Feature',
      properties,
      geometry: {
        type: 'LineString',
        coordinates: [currentCoordinate, candidateCoordinate],
      },
    });
  }

  return {
    current: { type: 'FeatureCollection', features: current },
    candidates: { type: 'FeatureCollection', features: candidates },
    lines: { type: 'FeatureCollection', features: lines },
  };
}

export function NeutralComparisonMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const recordsById = useRef(new Map<string, PilotRecord>());
  const [payload, setPayload] = useState<PilotPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [country, setCountry] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/neutral-pilot.json', { signal: controller.signal })
      .then(async (response) => {
        const next = (await response.json()) as PilotPayload;
        if (!response.ok || !next.available) {
          throw new Error(next.message ?? 'Neutral pilot data is unavailable.');
        }
        if (!Array.isArray(next.records)) {
          throw new Error('Neutral pilot data contains no records.');
        }
        setPayload(next);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Neutral pilot data could not be loaded.',
        );
      });

    return () => controller.abort();
  }, []);

  const countries = useMemo(
    () =>
      [...new Set(payload?.records.map((record) => record.centre.country) ?? [])]
        .sort((a, b) => a.localeCompare(b)),
    [payload],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<StatusFilter, number>([['all', payload?.records.length ?? 0]]);
    for (const record of payload?.records ?? []) {
      const recordStatus = statusOf(record);
      counts.set(recordStatus, (counts.get(recordStatus) ?? 0) + 1);
    }
    return counts;
  }, [payload]);

  const filteredRecords = useMemo(
    () =>
      (payload?.records ?? [])
        .filter((record) => status === 'all' || statusOf(record) === status)
        .filter((record) => !country || record.centre.country === country)
        .sort((a, b) => {
          if (!a.match && !b.match) {
            return a.centre.name.localeCompare(b.centre.name);
          }
          if (!a.match) return 1;
          if (!b.match) return -1;
          return b.match.distanceKm - a.match.distanceKm;
        }),
    [country, payload, status],
  );

  const plottedRecords = useMemo(
    () => filteredRecords.filter((record) => record.match),
    [filteredRecords],
  );

  recordsById.current = new Map(
    (payload?.records ?? []).map((record) => [record.centre.id, record]),
  );

  const fitRecords = useCallback((records: PilotRecord[], maxZoom = 13) => {
    const map = mapRef.current;
    const coordinates = records.flatMap((record) =>
      record.match
        ? [
            [
              record.centre.restrictedCoordinate.lng,
              record.centre.restrictedCoordinate.lat,
            ] as [number, number],
            [
              record.match.candidate.lng,
              record.match.candidate.lat,
            ] as [number, number],
          ]
        : [],
    );
    if (!map || coordinates.length === 0) return;

    let west = coordinates[0]![0];
    let east = west;
    let south = coordinates[0]![1];
    let north = south;
    for (const [lng, lat] of coordinates.slice(1)) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 70, maxZoom },
    );
  }, []);

  useEffect(() => {
    if (!payload?.available || !mapContainer.current || mapRef.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;

    import('maplibre-gl')
      .then((maplibregl) => {
        if (cancelled || !mapContainer.current) return;
        map = new maplibregl.Map({
          container: mapContainer.current,
          center: [5, 18],
          zoom: 1.4,
          minZoom: 1,
          maxZoom: 19,
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution:
                  '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
              },
            },
            layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
          },
        });
        mapRef.current = map;
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          'top-right',
        );

        map.on('load', () => {
          if (!map || cancelled) return;
          map.addSource('comparison-lines', {
            type: 'geojson',
            data: EMPTY_COLLECTION,
          });
          map.addSource('current-points', {
            type: 'geojson',
            data: EMPTY_COLLECTION,
          });
          map.addSource('candidate-points', {
            type: 'geojson',
            data: EMPTY_COLLECTION,
          });
          map.addLayer({
            id: 'comparison-lines',
            type: 'line',
            source: 'comparison-lines',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'selected'], true],
                '#111827',
                '#f59e0b',
              ],
              'line-width': [
                'case',
                ['==', ['get', 'selected'], true],
                4,
                2,
              ],
              'line-opacity': 0.8,
            },
          });
          map.addLayer({
            id: 'current-points',
            type: 'circle',
            source: 'current-points',
            paint: {
              'circle-radius': [
                'case',
                ['==', ['get', 'selected'], true],
                9,
                6,
              ],
              'circle-color': '#c026d3',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });
          map.addLayer({
            id: 'candidate-points',
            type: 'circle',
            source: 'candidate-points',
            paint: {
              'circle-radius': [
                'case',
                ['==', ['get', 'selected'], true],
                9,
                6,
              ],
              'circle-color': [
                'case',
                ['==', ['get', 'status'], 'strong_candidate'],
                '#059669',
                '#d97706',
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2,
            },
          });

          const selectFeature = (event: MapLayerMouseEvent) => {
            const pilotId = event.features?.[0]?.properties?.pilotId;
            if (typeof pilotId === 'string') setSelectedId(pilotId);
          };
          map.on('click', 'current-points', selectFeature);
          map.on('click', 'candidate-points', selectFeature);
          for (const layer of ['current-points', 'candidate-points']) {
            map.on('mouseenter', layer, () => {
              if (map) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layer, () => {
              if (map) map.getCanvas().style.cursor = '';
            });
          }
          setMapReady(true);
        });
        map.on('error', (event) => {
          if (event.error) {
            setMapError('A map tile could not be loaded. The comparison data is still listed.');
          }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMapError(
            error instanceof Error
              ? `The local map could not be loaded: ${error.message}`
              : 'The local map could not be loaded.',
          );
        }
      });

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [payload?.available]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const collections = comparisonCollections(plottedRecords, selectedId);
    (map.getSource('comparison-lines') as GeoJSONSource).setData(
      collections.lines,
    );
    (map.getSource('current-points') as GeoJSONSource).setData(
      collections.current,
    );
    (map.getSource('candidate-points') as GeoJSONSource).setData(
      collections.candidates,
    );
  }, [mapReady, plottedRecords, selectedId]);

  useEffect(() => {
    if (!mapReady) return;
    setSelectedId((current) =>
      current &&
      filteredRecords.some((record) => record.centre.id === current)
        ? current
        : null,
    );
    fitRecords(plottedRecords, plottedRecords.length === 1 ? 17 : 13);
  }, [fitRecords, filteredRecords, mapReady, plottedRecords]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!selectedId) return;

    const record = recordsById.current.get(selectedId);
    if (!record?.match) return;
    fitRecords([record], 17);

    import('maplibre-gl').then((maplibregl) => {
      if (mapRef.current !== map || !record.match) return;
      const content = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = record.centre.name;
      const detail = document.createElement('div');
      detail.textContent = `${distanceLabel(record.match.distanceKm)} discrepancy · ${statusLabel(record.match.status)}`;
      detail.className = 'mt-1 text-xs';
      content.append(title, detail);
      popupRef.current = new maplibregl.Popup({ offset: 12 })
        .setLngLat([
          record.match.candidate.lng,
          record.match.candidate.lat,
        ])
        .setDOMContent(content)
        .addTo(map);
    });
  }, [fitRecords, mapReady, selectedId]);

  if (loadError) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold">Neutral coordinate comparison</h1>
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          {loadError}
        </p>
      </section>
    );
  }

  if (!payload) {
    return (
      <section
        className="mx-auto max-w-6xl px-4 py-10"
        aria-busy="true"
        aria-live="polite"
      >
        <div className="h-9 w-96 max-w-full animate-pulse rounded bg-line" />
        <div className="mt-6 h-[38rem] animate-pulse rounded-xl bg-line" />
        <span className="sr-only">Loading neutral comparison</span>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-[96rem] px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Local-only diagnostic · not production data
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Neutral coordinate comparison
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Compare each current Google-derived pilot point with its
            independently discovered Overture candidate. Distance is diagnostic
            only; acceptance requires two independent identity evidence paths.
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>Overture {payload.overtureRelease}</p>
          {payload.generatedAt ? (
            <p>{new Date(payload.generatedAt).toLocaleString()}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Pilot centres', payload.summary?.sampleSize ?? payload.records.length],
          [
            'Accepted candidates',
            payload.summary?.acceptedCandidates ??
              payload.summary?.strongCandidates ??
              0,
          ],
          [
            'Review candidates',
            payload.summary?.reviewCandidates ??
              payload.summary?.possibleCandidates ??
              0,
          ],
          ['No candidates', payload.summary?.noCandidates ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4">
            <p className="text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((option) => {
          const active = status === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-white hover:border-brand'
              }`}
            >
              {option.label} ({statusCounts.get(option.value) ?? 0})
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          Country
          <select
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-ink"
          >
            <option value="">All countries</option>
            {countries.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid min-h-[42rem] overflow-hidden rounded-xl border border-line bg-white lg:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
        <div className="order-2 max-h-[42rem] overflow-y-auto border-t border-line lg:order-1 lg:border-r lg:border-t-0">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/95 px-4 py-3 backdrop-blur">
            <p className="text-sm font-medium">
              {filteredRecords.length} pilot centre
              {filteredRecords.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted">Largest discrepancy first</p>
          </div>
          <ol className="divide-y divide-line">
            {filteredRecords.map((record) => {
              const selected = selectedId === record.centre.id;
              const recordStatus = statusOf(record);
              return (
                <li key={record.centre.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(record.centre.id)}
                    className={`w-full px-4 py-4 text-left transition ${
                      selected
                        ? 'bg-brand-soft'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium leading-5">
                          {record.centre.name}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {record.centre.city}, {record.centre.country}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium ${statusTone(recordStatus)}`}
                      >
                        {statusLabel(recordStatus)}
                      </span>
                    </div>

                    {record.match ? (
                      <>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <span>
                            <span className="block text-muted">Discrepancy</span>
                            <strong>
                              {distanceLabel(record.match.distanceKm)}
                            </strong>
                          </span>
                          <span>
                            <span className="block text-muted">Match score</span>
                            <strong>
                              {(record.match.score * 100).toFixed(1)}%
                            </strong>
                          </span>
                          <span>
                            <span className="block text-muted">Evidence</span>
                            <strong>{record.match.evidencePaths.length} paths</strong>
                          </span>
                        </div>
                        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                          <p className="font-medium">
                            Overture {record.match.candidate.kind ?? 'place'} candidate
                          </p>
                          <p className="mt-1 text-muted">
                            ID {record.match.candidate.id}
                          </p>
                          <p className="mt-2 text-muted">
                            Name {(record.match.nameScore * 100).toFixed(0)}% ·
                            address {(record.match.addressScore * 100).toFixed(0)}
                            % · {record.match.candidate.sourceLicenses.join(', ')}
                          </p>
                          {record.match.decisionReasons?.length ? (
                            <p className="mt-2 text-muted">
                              {record.match.decisionReasons.join(' · ')}
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-muted">
                        No candidate met the pilot threshold.{' '}
                        {record.candidates?.length
                          ? `${record.candidates.length} rejected alternatives were retained with reasons.`
                          : 'Nothing is drawn as a neutral location.'}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative order-1 h-[32rem] bg-slate-100 lg:order-2 lg:h-[42rem]">
          <div className="absolute inset-0">
            <div ref={mapContainer} className="h-full w-full" />
          </div>
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-line bg-white/95 p-3 text-xs shadow-sm backdrop-blur">
            <p className="font-medium">Coordinate evidence</p>
            <p className="mt-2 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white bg-fuchsia-600 shadow" />
              Current Google-derived point
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white bg-emerald-600 shadow" />
              Strong neutral candidate
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white bg-amber-600 shadow" />
              Possible neutral candidate
            </p>
          </div>
          {plottedRecords.length === 0 ? (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white/75 p-8 text-center text-sm text-muted backdrop-blur-sm">
              No neutral candidates match these filters.
            </div>
          ) : null}
          {mapError ? (
            <p className="absolute bottom-8 left-1/2 z-20 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-xs text-amber-900 shadow">
              {mapError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
