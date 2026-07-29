'use client';

import dynamic from 'next/dynamic';

/**
 * Google Maps loads on demand. The centre detail page is the SEO surface, so
 * the map loads on its own chunk after the content rather than blocking first paint.
 * A server component can't call `next/dynamic` with `ssr: false`, hence this
 * thin client wrapper.
 */
const DetailMap = dynamic(() => import('./DetailMap').then((m) => m.DetailMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-line" />,
});

export default DetailMap;
