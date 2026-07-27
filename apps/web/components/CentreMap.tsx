'use client';

import { useEffect, useRef } from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import { isPinnable, type Centre } from '@ielts-map/core';

/**
 * Raster OpenStreetMap tiles, so the map works with no API key and no account.
 * MapLibre keeps the Mapbox GL API shape, so moving to Mapbox (or any vector
 * provider) later is a style change rather than a rewrite.
 *
 * Note: tile.openstreetmap.org is fine for development and low traffic, but its
 * usage policy rules out a production launch — swap in a proper tile host
 * before going live.
 */
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

/** Canada, roughly, for the empty state. */
const FALLBACK_BOUNDS: LngLatBoundsLike = [
  [-141, 41.5],
  [-52, 61],
];

interface Props {
  centres: Centre[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function CentreMap({ centres, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  // Keep the latest callback without re-running the marker effect on every render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: OSM_STYLE,
      bounds: FALLBACK_BOUNDS,
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  // Rebuild markers whenever the filtered set changes.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();

    const located = centres.filter((c) => c.geo);
    for (const centre of located) {
      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', centre.name);
      el.className = 'maplibre-pin';
      // A coarse coordinate gets a hollow, softer marker so the map never
      // implies more precision than the data supports.
      el.dataset.precise = String(isPinnable(centre.geo));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(centre.id);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([centre.geo!.lng, centre.geo!.lat])
        .addTo(instance);
      markers.current.set(centre.id, marker);
    }

    if (located.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const c of located) bounds.extend([c.geo!.lng, c.geo!.lat]);
      instance.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 400 });
    }
  }, [centres]);

  // Reflect selection, and pan to the chosen centre.
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.getElement().dataset.selected = String(id === selectedId);
    }
    if (!selectedId || !map.current) return;
    const centre = centres.find((c) => c.id === selectedId);
    if (centre?.geo) {
      map.current.easeTo({
        center: [centre.geo.lng, centre.geo.lat],
        zoom: Math.max(map.current.getZoom(), 12),
        duration: 400,
      });
    }
  }, [selectedId, centres]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />
      <style>{`
        .maplibre-pin {
          width: 18px; height: 18px; border-radius: 9999px; cursor: pointer;
          background: oklch(0.52 0.14 250); border: 2px solid white;
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35); transition: transform .12s ease;
        }
        .maplibre-pin[data-precise="false"] {
          background: transparent;
          border: 2px dashed oklch(0.52 0.14 250);
          box-shadow: none;
        }
        .maplibre-pin[data-selected="true"] {
          transform: scale(1.45);
          background: oklch(0.55 0.19 25);
          border-color: white;
        }
      `}</style>
    </div>
  );
}
