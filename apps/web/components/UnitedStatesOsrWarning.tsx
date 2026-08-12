'use client';

import { useEffect, useState } from 'react';
import { afterTestPolicy, type AfterTestPolicy } from '@ielts-map/core';

export function UnitedStatesOsrWarning({
  compact = false,
  showCentreAvailabilityFallback = false,
}: {
  compact?: boolean;
  showCentreAvailabilityFallback?: boolean;
}) {
  const [policy, setPolicy] = useState<AfterTestPolicy>(afterTestPolicy);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/after-test-policy.json', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Policy feed returned ${response.status}`);
        return response.json() as Promise<AfterTestPolicy>;
      })
      .then((candidate) => {
        if (
          candidate.version === 1 &&
          typeof candidate.britishCouncilUnitedStates?.oneSkillRetakeUnavailable === 'boolean' &&
          typeof candidate.britishCouncilUnitedStates?.sourceUrl === 'string'
        ) {
          setPolicy(candidate);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Keep the build-time policy as the fail-safe fallback.
      });
    return () => controller.abort();
  }, []);

  const unitedStatesPolicy = policy.britishCouncilUnitedStates;
  if (!unitedStatesPolicy.oneSkillRetakeUnavailable) {
    return showCentreAvailabilityFallback ? (
      <p className="mt-3 text-sm text-muted">
        One Skill Retake may not be available at this test centre. Check your test portal for
        eligible centres and dates.
      </p>
    ) : null;
  }

  return (
    <p
      className={
        compact
          ? 'mt-3 text-xs text-muted'
          : 'mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950'
      }
    >
      IELTS One Skill Retake is not currently available for full IELTS tests taken in the United
      States, including exams booked at this centre.{' '}
      <a
        href={unitedStatesPolicy.sourceUrl}
        target="_blank"
        rel="noreferrer nofollow"
        className="whitespace-nowrap font-medium underline"
      >
        Official guidance ↗
      </a>
    </p>
  );
}
