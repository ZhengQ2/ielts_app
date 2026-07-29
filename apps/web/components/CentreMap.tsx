'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import {
  formatPublishedPrice,
  offeringCategory,
  offeringModule,
  operatorShape,
  operatorStyle,
  type Centre,
  type GeoBounds,
  type Operator,
} from '@ielts-map/core';
import { googleMapId, importGoogleMapLibraries } from '@/lib/google-maps';
import { centreDetailHref } from '@/lib/offering-filter';

interface Props {
  centres: Centre[];
  /** Visual emphasis only; hovering a list card must never move the map. */
  highlightedId: string | null;
  /** Explicit selection from a user click; this is the only focus trigger. */
  selectedId: string | null;
  detailFilterSearch: string;
  onSelect: (id: string | null) => void;
  onViewportChange: (
    viewport: GeoBounds & { zoom: number; center: { lat: number; lng: number } },
  ) => void;
}

export default function CentreMap({
  centres,
  highlightedId,
  selectedId,
  detailFilterSearch,
  onSelect,
  onViewportChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef(
    new Map<string, google.maps.marker.AdvancedMarkerElement>(),
  );
  const clusterer = useRef<MarkerClusterer | null>(null);
  const popup = useRef<google.maps.InfoWindow | null>(null);
  const mapListeners = useRef<google.maps.MapsEventListener[]>([]);
  const centresRef = useRef(centres);
  const selectedIdRef = useRef(selectedId);
  const detailFilterSearchRef = useRef(detailFilterSearch);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  centresRef.current = centres;
  selectedIdRef.current = selectedId;
  detailFilterSearchRef.current = detailFilterSearch;

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const markerSignature = useMemo(
    () =>
      centres
        .map((centre) =>
          [
            centre.id,
            centre.name,
            centre.operator,
            centre.ieltsOrgSlug,
            centre.geo?.lat ?? '',
            centre.geo?.lng ?? '',
          ].join(':'),
        )
        .join('|'),
    [centres],
  );
  const selectedPopupSignature = useMemo(() => {
    const selected = centres.find((centre) => centre.id === selectedId);
    if (!selected) return '';
    return [
      selected.id,
      selected.priceFromText ?? '',
      ...selected.offerings.map(
        (offering) =>
          `${offeringModule(offering)}:${offeringCategory(offering)}:${offering.format}:${offering.label}:${offering.priceText ?? ''}`,
      ),
    ].join('|');
  }, [centres, selectedId]);

  useEffect(() => {
    if (!container.current || map.current) return;
    let cancelled = false;

    importGoogleMapLibraries()
      .then(({ maps }) => {
        if (cancelled || !container.current) return;
        const instance = new maps.Map(container.current, {
          center: { lat: 18, lng: 5 },
          zoom: 2,
          minZoom: 2,
          mapId: googleMapId,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.current = instance;

        const reportViewport = () => {
          const bounds = instance.getBounds();
          const center = instance.getCenter();
          if (!bounds || !center) return;
          const json = bounds.toJSON();
          onViewportChangeRef.current({
            north: json.north,
            south: json.south,
            east: json.east,
            west: json.west,
            zoom: instance.getZoom() ?? 2,
            center: { lat: center.lat(), lng: center.lng() },
          });
        };

        mapListeners.current = [
          instance.addListener('idle', reportViewport),
          instance.addListener(
            'click',
            (event: google.maps.MapMouseEvent) => {
              // AdvancedMarker content lives inside Google's overlay panes.
              // Depending on the input/browser, Google can surface the same
              // pointer interaction as both a DOM click on the marker and a
              // MapMouseEvent on the map. Never let that second event clear a
              // selection which the marker has just made.
              const target = event.domEvent.target;
              if (
                event.domEvent.defaultPrevented ||
                (target instanceof Element &&
                  target.closest('.google-map-pin'))
              ) {
                return;
              }
              onSelectRef.current(null);
            },
          ),
        ];
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      for (const listener of mapListeners.current) listener.remove();
      mapListeners.current = [];
      clusterer.current?.clearMarkers();
      clusterer.current?.setMap(null);
      clusterer.current = null;
      for (const marker of markers.current.values()) marker.map = null;
      markers.current.clear();
      popup.current?.close();
      popup.current = null;
      map.current = null;
      container.current?.replaceChildren();
    };
  }, []);

  // Rebuild markers whenever the filtered set changes.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !mapReady) return;
    let cancelled = false;

    importGoogleMapLibraries().then(({ marker: markerLibrary }) => {
      if (cancelled || !map.current) return;
      clusterer.current?.clearMarkers();
      clusterer.current?.setMap(null);
      clusterer.current = null;
      for (const marker of markers.current.values()) marker.map = null;
      markers.current.clear();

      const currentCentres = centresRef.current;
      const located = currentCentres.filter((centre) => centre.geo);
      const bounds = new google.maps.LatLngBounds();
      const markerElements: google.maps.marker.AdvancedMarkerElement[] = [];

      for (const centre of located) {
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('aria-label', `${centre.name} (${centre.operator})`);
        el.className = 'google-map-pin';
        el.style.setProperty('--pin', operatorStyle(centre.operator).base);
        el.dataset.shape = operatorShape(centre.operator);

        el.addEventListener('click', (event) => {
          // Prevent the same native event from being interpreted as a map
          // background click. A marker used to be an anchor; when Maps
          // remapped a later touch/pointer click, its default navigation could
          // win and make the page appear to jump to the top.
          event.preventDefault();
          event.stopPropagation();
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.button !== 0
          ) {
            return;
          }
          onSelectRef.current(centre.id);
        });
        el.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          event.preventDefault();
          routerRef.current.push(
            centreDetailHref(
              centre.ieltsOrgSlug,
              detailFilterSearchRef.current,
            ),
          );
        });

        const advancedMarker = new markerLibrary.AdvancedMarkerElement({
          position: { lat: centre.geo!.lat, lng: centre.geo!.lng },
          content: el,
          title: centre.name,
        });
        markers.current.set(centre.id, advancedMarker);
        markerElements.push(advancedMarker);
        bounds.extend({ lat: centre.geo!.lat, lng: centre.geo!.lng });
      }

      const openId = selectedIdRef.current;
      const selectedLocated = openId
        ? located.find((centre) => centre.id === openId)
        : null;
      if (located.length > 0) {
        clusterer.current = new MarkerClusterer({
          map: instance,
          markers: markerElements,
          algorithmOptions: { maxZoom: 14 },
        });
        // A selected centre is an explicit camera position chosen by the
        // reader. Filtering must not pull them away from it just because the
        // marker set was rebuilt.
        if (!selectedLocated) {
          instance.fitBounds(bounds, 60);
          google.maps.event.addListenerOnce(instance, 'idle', () => {
            if ((instance.getZoom() ?? 2) > 13) instance.setZoom(13);
          });
        }
      }

      // Filtering replaces each Centre with a projection containing only the
      // matching offerings and their recalculated price. Keep an already-open
      // popup in sync with that projection and re-anchor it to the rebuilt
      // marker, but deliberately do not pan or zoom: only a fresh user
      // selection is allowed to move the camera.
      if (openId && popup.current) {
        const selectedCentre = currentCentres.find(
          (centre) => centre.id === openId,
        );
        const selectedMarker = markers.current.get(openId);
        if (selectedCentre?.geo && selectedMarker) {
          popup.current.setContent(
            popupContent(
              selectedCentre,
              centreDetailHref(
                selectedCentre.ieltsOrgSlug,
                detailFilterSearchRef.current,
              ),
            ),
          );
          // The clusterer may temporarily hide the selected marker after a
          // rebuild. Positioning the existing InfoWindow at the centre keeps
          // it visible without another camera move; the next explicit marker
          // click will anchor it normally again.
          popup.current.setPosition({
            lat: selectedCentre.geo.lat,
            lng: selectedCentre.geo.lng,
          });
          popup.current.open({ map: instance, shouldFocus: false });
        } else {
          popup.current.close();
          popup.current = null;
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [markerSignature, mapReady]);

  // Hover changes marker emphasis only; it never changes the camera.
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      const element = marker.content;
      if (element instanceof HTMLElement) {
        element.dataset.selected = String(id === highlightedId);
      }
    }
  }, [highlightedId, centres, mapReady]);

  // Only an explicit marker/list click changes selectedId and moves the map.
  useEffect(() => {
    popup.current?.close();
    popup.current = null;
    if (!selectedId || !map.current || !mapReady) return;

    const centre = centresRef.current.find((item) => item.id === selectedId);
    const marker = markers.current.get(selectedId);
    if (!centre?.geo || !marker) return;

    map.current.panTo({ lat: centre.geo.lat, lng: centre.geo.lng });
    if ((map.current.getZoom() ?? 0) < 12) map.current.setZoom(12);

    const infoWindow = new google.maps.InfoWindow({
      content: popupContent(
        centre,
        centreDetailHref(
          centre.ieltsOrgSlug,
          detailFilterSearchRef.current,
        ),
      ),
      ariaLabel: centre.name,
    });
    infoWindow.addListener('closeclick', () => onSelectRef.current(null));
    infoWindow.open({ map: map.current, anchor: marker, shouldFocus: false });
    popup.current = infoWindow;
  }, [selectedId, mapReady]);

  // Price/type filters replace the selected centre with an offering-level
  // projection. Refresh only the popup content; unlike the selection effect
  // above, this must never move the camera.
  useEffect(() => {
    if (!selectedId || !map.current || !mapReady || !popup.current) return;
    const centre = centresRef.current.find((item) => item.id === selectedId);
    if (!centre?.geo) {
      popup.current.close();
      popup.current = null;
      return;
    }
    popup.current.setContent(
      popupContent(
        centre,
        centreDetailHref(centre.ieltsOrgSlug, detailFilterSearch),
      ),
    );
  }, [
    selectedId,
    selectedPopupSignature,
    detailFilterSearch,
    mapReady,
  ]);

  const legend = [...new Set(centres.map((centre) => centre.operator))].sort();

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-line px-8 text-center text-sm text-muted">
        The map could not be loaded. Test centres are still available in the list.
      </div>
    );
  }

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
          </ul>
          <p className="mt-1.5 border-t border-line pt-1.5 text-[0.6875rem] leading-tight text-muted">
            Double-click a marker to open the centre
          </p>
        </div>
      )}

      <style>{`
        .google-map-pin {
          --scale: 1;
          --rotate: 0deg;
          display: block;
          appearance: none;
          padding: 0;
          user-select: none;
          -webkit-user-select: none;
          width: 16px;
          height: 16px;
          cursor: pointer;
          background: var(--pin);
          border: 2px solid white;
          border-radius: 9999px;
          box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
          transform: rotate(var(--rotate)) scale(var(--scale));
          transition: transform .12s ease;
        }
        .google-map-pin:focus-visible {
          outline: 2px solid #0f172a;
          outline-offset: 2px;
        }
        .google-map-pin[data-shape="diamond"] {
          width: 13px;
          height: 13px;
          border-radius: 2px;
          --rotate: 45deg;
        }
        .google-map-pin[data-shape="square"] {
          width: 14px;
          height: 14px;
          border-radius: 2px;
        }
        .google-map-pin[data-selected="true"] {
          --scale: 1.5;
          box-shadow: 0 0 0 3px rgb(15 23 42 / 0.45), 0 1px 4px rgb(0 0 0 / 0.35);
          z-index: 1;
        }
        .centre-popup__operator {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.1rem 0.5rem;
          border-radius: 9999px;
          font-size: 0.6875rem;
          font-weight: 500;
        }
        .centre-popup__operator-swatch {
          display: inline-block;
          width: 0.5rem;
          height: 0.5rem;
          flex-shrink: 0;
        }
        .centre-popup__name {
          display: block;
          margin-top: 0.4rem;
          font-size: 0.8125rem;
          font-weight: 500;
          line-height: 1.25;
          color: inherit;
          text-decoration: none;
        }
        .centre-popup__name:hover { text-decoration: underline; }
        .centre-popup__address {
          margin-top: 0.25rem;
          font-size: 0.75rem;
          line-height: 1.3;
          color: oklch(0.52 0.015 250);
        }
        .centre-popup__price {
          margin-top: 0.35rem;
          font-size: 0.8125rem;
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}

function popupContent(centre: Centre, detailHref: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'centre-popup';
  root.appendChild(popupOperatorBadge(centre.operator));

  const name = document.createElement('a');
  name.href = detailHref;
  name.className = 'centre-popup__name';
  name.textContent = centre.name;
  root.appendChild(name);

  const address = document.createElement('p');
  address.className = 'centre-popup__address';
  address.textContent = centre.address.raw;
  root.appendChild(address);

  const price = document.createElement('p');
  price.className = 'centre-popup__price';
  price.textContent = formatPublishedPrice(centre.priceFromText);
  root.appendChild(price);

  return root;
}

function popupOperatorBadge(operator: Operator): HTMLElement {
  const style = operatorStyle(operator);
  const shape = operatorShape(operator);

  const badge = document.createElement('span');
  badge.className = 'centre-popup__operator';
  badge.style.background = style.soft;
  badge.style.color = style.text;

  const swatch = document.createElement('span');
  swatch.className = 'centre-popup__operator-swatch';
  swatch.style.background = style.base;
  swatch.style.borderRadius = shape === 'circle' ? '9999px' : '2px';
  if (shape === 'diamond') swatch.style.transform = 'rotate(45deg)';
  badge.appendChild(swatch);
  badge.appendChild(document.createTextNode(operator));
  return badge;
}

function LegendSwatch({ operator }: { operator: Operator }) {
  const shape = operatorShape(operator);
  const color = operatorStyle(operator).base;
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0"
      style={{
        background: color,
        border: '2px solid white',
        borderRadius: shape === 'circle' ? '9999px' : '2px',
        transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        boxShadow: '0 0 0 1px rgb(0 0 0 / 0.15)',
      }}
    />
  );
}
