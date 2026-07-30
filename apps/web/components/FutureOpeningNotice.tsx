import type { Centre } from '@ielts-map/core';
import { isHttpUrl } from '@/lib/url-safety';

export function FutureOpeningNotice({
  centre,
  compact = false,
}: {
  centre: Pick<Centre, 'futureOpening'>;
  compact?: boolean;
}) {
  const opening = centre.futureOpening;
  if (!opening) return null;

  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      <span
        className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-medium text-amber-900"
      >
        Future opening
      </span>
      {!compact && (
        <p className="mt-2 text-muted">
          This location has not opened yet and does not have scheduled test dates. You can use
          the official IELTS USA form to register your interest.{' '}
          {isHttpUrl(opening.sourceUrl) && (
            <a
              href={opening.sourceUrl}
              target="_blank"
              rel="noreferrer nofollow"
              className="whitespace-nowrap underline hover:text-ink"
            >
              Operator source ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}
