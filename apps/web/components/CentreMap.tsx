'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import {
  isPinnable,
  operatorShape,
  operatorStyle,
  type Centre,
  type Operator,
} from '@ielts-map/core';

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
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

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
      const href = `/centres/${centre.ieltsOrgSlug}`;

      // A real anchor, not a button: it gives keyboard activation, cmd-click to
      // open in a new tab and the browser's own context menu for free — none of
      // which a click handler on a <button> would provide.
      const el = document.createElement('a');
      el.href = href;
      // The operator is in the label too — a screen reader gets no colour.
      el.setAttribute('aria-label', `${centre.name} (${centre.operator})`);
      el.className = 'maplibre-pin';
      el.style.setProperty('--pin', operatorStyle(centre.operator).base);
      el.dataset.shape = operatorShape(centre.operator);
      // A coarse coordinate gets a hollow, softer marker so the map never
      // implies more precision than the data supports.
      el.dataset.precise = String(isPinnable(centre.geo));

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        // Let the browser handle cmd/ctrl/shift-click and middle-click so
        // "open in a new tab" keeps working.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // A plain single click selects; opening the page is the double click.
        e.preventDefault();
        onSelectRef.current(centre.id);
      });

      el.addEventListener('dblclick', (e) => {
        // Without this the map's own double-click-to-zoom also fires.
        e.stopPropagation();
        e.preventDefault();
        routerRef.current.push(href);
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

  // Only show operators that are actually on screen.
  const legend = [...new Set(centres.map((c) => c.operator))].sort();
  const approximate = centres.filter((c) => c.geo && !isPinnable(c.geo)).length;

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />

      {legend.length > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[15rem] rounded-lg border border-line bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
          <ul className="flex flex-col gap-1.5">
            {legend.map((operator) => (
              <li key={operator} className="flex items-center gap-2 text-xs">
                <LegendSwatch operator={operator} />
                <span>{operator}</span>
              </li>
            ))}
            {approximate > 0 && (
              <li className="flex items-center gap-2 border-t border-line pt-1.5 text-xs">
                <LegendSwatch operator={legend[0] ?? 'unknown'} hollow />
                <span className="text-muted">
                  Approximate location ({approximate})
                </span>
              </li>
            )}
          </ul>
          <p className="mt-1.5 border-t border-line pt-1.5 text-[0.6875rem] leading-tight text-muted">
            Double-click a marker to open the centre
          </p>
        </div>
      )}

      <style>{`
        .maplibre-pin {
          --scale: 1;
          --rotate: 0deg;
          /* An <a> is inline by default, which would ignore width/height. */
          display: block;
          /* Stops the double-click from selecting surrounding text. */
          user-select: none; -webkit-user-select: none;
          width: 16px; height: 16px; cursor: pointer;
          background: var(--pin); border: 2px solid white; border-radius: 9999px;
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
          transform: rotate(var(--rotate)) scale(var(--scale));
          transition: transform .12s ease;
        }
        .maplibre-pin:focus-visible {
          outline: 2px solid #0f172a;
          outline-offset: 2px;
        }
        /* Shape carries the operator alongside colour, so the distinction
           survives colour blindness and greyscale. Rotated squares are sized
           down: a 16px square turned 45° has a ~22px diagonal, which would read
           as a heavier mark than the circles it sits beside. */
        .maplibre-pin[data-shape="diamond"] {
          width: 13px; height: 13px; border-radius: 2px; --rotate: 45deg;
        }
        .maplibre-pin[data-shape="square"]  { width: 14px; height: 14px; border-radius: 2px; }
        .maplibre-pin[data-precise="false"] {
          background: transparent;
          border-style: dashed;
          border-color: var(--pin);
          box-shadow: none;
        }
        /* Selection is scale plus a dark ring — never a colour change, which
           would collide with the operator colours. */
        .maplibre-pin[data-selected="true"] {
          --scale: 1.5;
          box-shadow: 0 0 0 3px rgb(15 23 42 / 0.45), 0 1px 4px rgb(0 0 0 / 0.35);
          z-index: 1;
        }
      `}</style>
    </div>
  );
}

/** `hollow` mirrors the dashed marker used for coarse coordinates. */
function LegendSwatch({ operator, hollow }: { operator: Operator; hollow?: boolean }) {
  const shape = operatorShape(operator);
  const color = operatorStyle(operator).base;
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0"
      style={{
        background: hollow ? 'transparent' : color,
        border: hollow ? `1.5px dashed ${color}` : '2px solid white',
        borderRadius: shape === 'circle' ? '9999px' : '2px',
        transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        boxShadow: hollow ? undefined : '0 0 0 1px rgb(0 0 0 / 0.15)',
      }}
    />
  );
}
