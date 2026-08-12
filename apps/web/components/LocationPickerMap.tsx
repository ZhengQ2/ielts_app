'use client';

import { useEffect, useRef, useState } from 'react';
import { googleMapId, importGoogleMapLibraries } from '@/lib/google-maps';

export interface PickedLocation {
  lat: number;
  lng: number;
}

interface Props {
  initialCenter: PickedLocation;
  initialZoom: number;
  selected: PickedLocation | null;
  onChange: (location: PickedLocation) => void;
}

/**
 * A deliberately small map editor for user-submitted corrections. The centre's
 * existing point only chooses the initial view; it is never treated as the
 * user's answer. A report cannot continue until the reporter places a new pin.
 */
export function LocationPickerMap({
  initialCenter,
  initialZoom,
  selected,
  onChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const clickListener = useRef<google.maps.MapsEventListener | null>(null);
  const dragListener = useRef<google.maps.MapsEventListener | null>(null);
  const onChangeRef = useRef(onChange);
  const [loadError, setLoadError] = useState(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    const containerElement = container.current;
    if (!containerElement || map.current) return;
    let cancelled = false;

    importGoogleMapLibraries()
      .then(({ maps, marker: markerLibrary }) => {
        if (cancelled) return;

        const instance = new maps.Map(containerElement, {
          center: initialCenter,
          zoom: initialZoom,
          mapId: googleMapId,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.current = instance;

        const pickedMarker = new markerLibrary.AdvancedMarkerElement({
          map: null,
          gmpDraggable: true,
          title: 'Suggested exact test centre location',
        });
        marker.current = pickedMarker;

        const pick = (event: google.maps.MapMouseEvent) => {
          const point = event.latLng;
          if (!point) return;
          const location = { lat: point.lat(), lng: point.lng() };
          pickedMarker.position = location;
          pickedMarker.map = instance;
          onChangeRef.current(location);
        };

        clickListener.current = instance.addListener('click', pick);
        dragListener.current = pickedMarker.addListener('dragend', pick);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      clickListener.current?.remove();
      dragListener.current?.remove();
      clickListener.current = null;
      dragListener.current = null;
      if (marker.current) marker.current.map = null;
      marker.current = null;
      map.current = null;
      containerElement.replaceChildren();
    };
  }, [initialCenter, initialZoom]);

  useEffect(() => {
    if (!map.current || !marker.current || !selected) return;
    marker.current.position = selected;
    marker.current.map = map.current;
  }, [selected]);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-line px-6 text-center text-sm text-muted">
        The location picker could not be loaded. Please try again after refreshing the page.
      </div>
    );
  }

  return (
    <div
      ref={container}
      aria-label="Map for choosing the exact test centre location"
      className="h-full w-full"
    />
  );
}
