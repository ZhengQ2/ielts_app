import type { Metadata } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NeutralComparisonMap } from '@/components/NeutralComparisonMap';

export const metadata: Metadata = {
  title: 'Neutral coordinate comparison',
  description:
    'Local-only diagnostic comparing current centre coordinates with neutral Overture candidates.',
};

export default function NeutralMapPage() {
  const localDevelopment = process.env.NODE_ENV === 'development';

  if (!localDevelopment) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          Local diagnostic
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Neutral coordinate comparison
        </h1>
        <p className="mt-4 text-muted">
          This page is disabled outside local development. It never publishes
          restricted comparison coordinates.
        </p>
      </section>
    );
  }

  return <NeutralComparisonMap />;
}
