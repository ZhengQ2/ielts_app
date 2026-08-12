'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Centre } from '@ielts-map/core';
import { LiveCentrePage } from './LiveCentrePage';

interface CentreFeed {
  centres: Centre[];
}

export function AddedCentrePage() {
  const centreId = useSearchParams().get('id');
  const [centre, setCentre] = useState<Centre | null>(null);
  const [feedCentres, setFeedCentres] = useState<Centre[] | null>(null);
  const [resolvedCentreId, setResolvedCentreId] = useState<string | null | undefined>();

  useEffect(() => {
    setCentre(null);
    setFeedCentres(null);
    setResolvedCentreId(undefined);
    if (!centreId) {
      setResolvedCentreId(null);
      return;
    }
    const controller = new AbortController();
    fetch('/data/centres.json', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Centre feed returned ${response.status}`);
        return response.json() as Promise<CentreFeed>;
      })
      .then((feed) => {
        if (controller.signal.aborted) return;
        setFeedCentres(feed.centres);
        setCentre(
          feed.centres.find(
            (candidate) =>
              candidate.id === centreId && candidate.ieltsOrgSlug === 'added',
          ) ?? null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setCentre(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolvedCentreId(centreId);
      });
    return () => controller.abort();
  }, [centreId]);

  if (centre && centre.id === centreId && feedCentres) {
    return <LiveCentrePage initialCentre={centre} initialFeedCentres={feedCentres} />;
  }
  const finished = resolvedCentreId === centreId;

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <Link href="/" className="text-sm text-muted hover:text-ink">← All centres</Link>
      <h1 className="mt-4 text-2xl font-semibold">
        {finished ? 'Centre not found' : 'Loading centre…'}
      </h1>
      {finished && (
        <p className="mt-2 text-muted">
          This manually added centre is not currently published.
        </p>
      )}
    </main>
  );
}
