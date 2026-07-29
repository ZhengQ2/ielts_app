'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { correctionReportUrl, type Centre } from '@ielts-map/core';
import type { PickedLocation } from './LocationPickerMap';

const LocationPickerMap = dynamic(
  () => import('./LocationPickerMap').then((module) => module.LocationPickerMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-line" />,
  },
);

interface Props {
  centre: Pick<Centre, 'name' | 'ieltsOrgSlug' | 'sources'>;
  initialCenter: PickedLocation;
  initialZoom: number;
  hasLocation: boolean;
}

export function LocationCorrectionReport({
  centre,
  initialCenter,
  initialZoom,
  hasLocation,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PickedLocation | null>(null);
  const reportUrl = useMemo(
    () => (selected ? correctionReportUrl(centre, { location: selected }) : null),
    [centre, selected],
  );

  return (
    <div className="mt-4 rounded-lg border border-line bg-white p-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
      >
        {hasLocation ? 'Suggest a more accurate map location' : 'Add the exact map location'}
      </button>
      <p className="mt-1 text-xs text-muted">
        Your suggestion will be reviewed before it changes this listing.
      </p>

      {open && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="font-medium">Pick the exact entrance or building</h3>
          <p className="mt-1 text-sm text-muted">
            Click or tap the map to place a pin. You can drag the pin to fine-tune it.
          </p>

          <div className="mt-3 h-80 overflow-hidden rounded-lg border border-line">
            <LocationPickerMap
              initialCenter={initialCenter}
              initialZoom={initialZoom}
              selected={selected}
              onChange={setSelected}
            />
          </div>

          {selected ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted" aria-live="polite">
                Selected: {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
              </p>
              <a
                href={reportUrl ?? undefined}
                target="_blank"
                rel="noreferrer nofollow"
                className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 font-medium text-white hover:opacity-90"
              >
                Continue to submit report
                <span aria-hidden>↗</span>
              </a>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted" aria-live="polite">
              Place a pin to continue.
            </p>
          )}

          <p className="mt-3 text-xs text-muted">
            The selected coordinates will be added to a pre-filled GitHub report. GitHub sign-in
            is required to submit it.
          </p>
        </div>
      )}
    </div>
  );
}
