'use client';

import { useEffect, useRef, useState } from 'react';
import { googleMapId, importGoogleMapLibraries } from '@/lib/google-maps';

interface Props {
  lat: number;
  lng: number;
  /** False for coarse or unverified coordinates — drawn as an area. */
  precise: boolean;
  label: string;
  /** Operator colour, so the marker matches the badge above it. */
  color: string;
}

export function DetailMap({ lat, lng, precise, label, color }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const containerElement = container.current;
    if (!containerElement) return;
    let cancelled = false;
    let marker: google.maps.marker.AdvancedMarkerElement | null = null;
    let circle: google.maps.Circle | null = null;

    importGoogleMapLibraries()
      .then(({ maps, marker: markerLibrary }) => {
        if (cancelled) return;
        const position = { lat, lng };
        const map = new maps.Map(containerElement, {
          center: position,
          zoom: precise ? 15 : 11,
          mapId: googleMapId,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });

        if (precise) {
          const content = document.createElement('div');
          content.className = 'google-detail-pin';
          content.style.setProperty('--pin', color);
          content.title = label;
          marker = new markerLibrary.AdvancedMarkerElement({
            map,
            position,
            content,
            title: label,
          });
        } else {
          // An unverified coordinate gets an area, never a pin implying a door.
          circle = new google.maps.Circle({
            map,
            center: position,
            radius: 1500,
            fillColor: color,
            fillOpacity: 0.15,
            strokeColor: color,
            strokeOpacity: 0.55,
            strokeWeight: 2,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      if (marker) marker.map = null;
      circle?.setMap(null);
      containerElement.replaceChildren();
    };
  }, [lat, lng, precise, label, color]);

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-line px-6 text-center text-sm text-muted">
        The map could not be loaded. Use the published address above.
      </div>
    );
  }

  return (
    <>
      <div
        ref={container}
        aria-label={`Map showing ${label}`}
        className="h-full w-full"
      />
      <style>{`
        .google-detail-pin {
          width: 20px;
          height: 20px;
          border: 3px solid white;
          border-radius: 9999px;
          background: var(--pin);
          box-shadow: 0 1px 5px rgb(0 0 0 / 0.4);
        }
      `}</style>
    </>
  );
}
