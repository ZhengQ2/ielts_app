'use client';

import { useEffect, useRef, useState } from 'react';
import { importPlacesLibrary } from '@/lib/google-maps';

export interface CitySearchSelection {
  label: string;
  center: { lat: number; lng: number };
  bounds: google.maps.LatLngBoundsLiteral | null;
}

interface Props {
  value: string;
  country: string;
  selected: boolean;
  onValueChange: (value: string) => void;
  onCitySelect: (selection: CitySearchSelection) => void;
}

/**
 * One field serves two purposes without trusting our inconsistent city column:
 * ordinary text still searches centre records, while Google supplies explicit
 * city choices that become a map/distance origin only after the user selects
 * one. A failed or disabled Places API therefore never breaks normal search.
 */
export function CitySearch({
  value,
  country,
  selected,
  onValueChange,
  onCitySelect,
}: Props) {
  const [predictions, setPredictions] = useState<google.maps.places.PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [placesUnavailable, setPlacesUnavailable] = useState(false);
  const requestId = useRef(0);
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    setSelecting(false);
    const input = value.trim();
    if (selected || input.length < 2) {
      requestId.current += 1;
      setPredictions([]);
      setOpen(false);
      if (!input) sessionToken.current = null;
      return;
    }

    const currentRequest = ++requestId.current;
    setPlacesUnavailable(false);
    const timer = window.setTimeout(() => {
      importPlacesLibrary()
        .then(async ({ AutocompleteSessionToken, AutocompleteSuggestion }) => {
          sessionToken.current ??= new AutocompleteSessionToken();
          const request: google.maps.places.AutocompleteRequest = {
            input,
            includedPrimaryTypes: ['(cities)'],
            sessionToken: sessionToken.current,
            language: navigator.language,
          };
          if (country) {
            request.includedRegionCodes = [country.toLowerCase()];
            request.region = country.toLowerCase();
          }
          const response = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
          if (currentRequest !== requestId.current) return;
          setPredictions(
            response.suggestions
              .map((suggestion) => suggestion.placePrediction)
              .filter((prediction): prediction is google.maps.places.PlacePrediction =>
                Boolean(prediction),
              ),
          );
          setPlacesUnavailable(false);
          setOpen(true);
        })
        .catch((error: unknown) => {
          // Plain centre/address search remains available when Places is not.
          if (currentRequest !== requestId.current) return;
          console.error('Google Places city suggestions are unavailable', error);
          setPredictions([]);
          setOpen(false);
          setPlacesUnavailable(true);
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [country, selected, value]);

  async function choose(prediction: google.maps.places.PlacePrediction): Promise<void> {
    const selectionRequest = ++requestId.current;
    setSelecting(true);
    setOpen(false);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
      });
      if (selectionRequest !== requestId.current) return;
      if (!place.location) return;
      const label = prediction.text.toString();
      onCitySelect({
        label,
        center: { lat: place.location.lat(), lng: place.location.lng() },
        bounds: place.viewport?.toJSON() ?? null,
      });
      sessionToken.current = null;
      setPredictions([]);
    } catch {
      // Keep the typed value as a normal directory search on a details error.
    } finally {
      if (selectionRequest === requestId.current) setSelecting(false);
    }
  }

  return (
    <div
      className="relative flex flex-col gap-1 text-sm"
      onFocus={() => {
        if (predictions.length > 0) setOpen(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label className="font-medium" htmlFor="directory-search">Search</label>
      <input
        id="directory-search"
        type="search"
        value={value}
        autoComplete="off"
        onChange={(event) => {
          requestId.current += 1;
          setSelecting(false);
          onValueChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Centre name, city or postal code"
        aria-describedby="directory-search-hint"
        aria-expanded={open && predictions.length > 0}
        aria-controls="directory-city-suggestions"
        aria-autocomplete="list"
        role="combobox"
        className="rounded-md border border-line px-3 py-2 outline-none focus:border-brand"
      />
      <span
        id="directory-search-hint"
        className="text-xs text-muted"
        aria-live="polite"
      >
        {placesUnavailable
          ? 'City hints are temporarily unavailable. Text search still works.'
          : 'Choose a Google Maps city hint to search nearby.'}
      </span>

      {open && predictions.length > 0 && (
        <div
          id="directory-city-suggestions"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-line bg-white shadow-lg"
        >
          <ul aria-label="City suggestions">
            {predictions.map((prediction) => (
              <li key={prediction.placeId}>
                <button
                  type="button"
                  disabled={selecting}
                  onClick={() => void choose(prediction)}
                  className="w-full border-b border-line px-3 py-2 text-left hover:bg-surface disabled:opacity-50"
                >
                  <span className="block font-medium">
                    {prediction.mainText?.toString() ?? prediction.text.toString()}
                  </span>
                  {prediction.secondaryText && (
                    <span className="block text-xs text-muted">
                      {prediction.secondaryText.toString()}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="px-3 py-1.5 text-right text-[0.65rem] text-muted">Google Maps</p>
        </div>
      )}
    </div>
  );
}
