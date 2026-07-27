'use client';

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';

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

interface Props {
  lat: number;
  lng: number;
  /** False for coarse coordinates — drawn as a radius, not a point. */
  precise: boolean;
  label: string;
}

export function DetailMap({ lat, lng, precise, label }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: OSM_STYLE,
      center: [lng, lat],
      // Zoom out for a coarse location so the view matches the real precision.
      zoom: precise ? 15 : 11,
      attributionControl: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.current = instance;

    if (precise) {
      new maplibregl.Marker({ color: '#3b5bdb' }).setLngLat([lng, lat]).addTo(instance);
    } else {
      // An approximate coordinate gets an area, never a pin that implies a door.
      instance.on('load', () => {
        instance.addSource('area', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} },
        });
        instance.addLayer({
          id: 'area-fill',
          type: 'circle',
          source: 'area',
          paint: {
            'circle-radius': 48,
            'circle-color': '#3b5bdb',
            'circle-opacity': 0.15,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#3b5bdb',
            'circle-stroke-opacity': 0.5,
          },
        });
      });
    }

    return () => {
      instance.remove();
      map.current = null;
    };
  }, [lat, lng, precise]);

  return <div ref={container} aria-label={`Map showing ${label}`} className="h-full w-full" />;
}
