'use client';

const SCRIPT_ID = 'ielts-google-maps';
const CALLBACK_NAME = '__ieltsGoogleMapsReady';

let loader: Promise<void> | null = null;

declare global {
  interface Window {
    __ieltsGoogleMapsReady?: () => void;
  }
}

export const googleMapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? '';

/**
 * Load Google Maps once, on demand. The browser key is intentionally separate
 * from the private ingest-time geocoding key and must be HTTP-referrer
 * restricted in Google Cloud.
 */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser'));
  }
  if (typeof google !== 'undefined') return Promise.resolve();
  if (loader) return loader;

  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Promise.reject(
      new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured'),
    );
  }
  if (!googleMapId) {
    return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAP_ID is not configured'));
  }

  loader = new Promise<void>((resolve, reject) => {
    window[CALLBACK_NAME] = () => {
      delete window[CALLBACK_NAME];
      resolve();
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) return;

    const url = new URL('https://maps.googleapis.com/maps/api/js');
    url.searchParams.set('key', key);
    url.searchParams.set('loading', 'async');
    url.searchParams.set('v', 'weekly');
    url.searchParams.set('callback', CALLBACK_NAME);
    url.searchParams.set('auth_referrer_policy', 'origin');

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = url.toString();
    script.onerror = () => {
      loader = null;
      delete window[CALLBACK_NAME];
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export async function importGoogleMapLibraries(): Promise<{
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
}> {
  await loadGoogleMaps();
  const [maps, marker] = await Promise.all([
    google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
    google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
  ]);
  return { maps, marker };
}
