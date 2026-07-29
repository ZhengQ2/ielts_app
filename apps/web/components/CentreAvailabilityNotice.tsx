import {
  availabilityGuidance,
  type Centre,
} from '@ielts-map/core';
import { isHttpUrl } from '@/lib/url-safety';

export function CentreAvailabilityNotice({
  centre,
  compact = false,
}: {
  centre: Pick<Centre, 'availability' | 'bookingUrl' | 'operator'>;
  compact?: boolean;
}) {
  const guidance = availabilityGuidance(centre);
  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      <span
        className={`inline-flex rounded-full border px-2.5 py-1 font-medium ${statusClass(guidance.status)}`}
      >
        {guidance.label}
      </span>
      {!compact && (
        <p className="mt-2 text-muted">
          {guidance.message}{' '}
          {isHttpUrl(guidance.evidenceUrl) && (
            <a
              href={guidance.evidenceUrl!}
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

function statusClass(status: ReturnType<typeof availabilityGuidance>['status']): string {
  if (status === 'future_location') {
    return 'border-amber-300 bg-amber-50 text-amber-900';
  }
  if (status === 'not_accepting_registrations') {
    return 'border-red-300 bg-red-50 text-red-800';
  }
  if (status === 'registration_available') {
    return 'border-brand/30 bg-brand-soft text-brand';
  }
  return 'border-line bg-white text-muted';
}
