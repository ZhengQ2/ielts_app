import Link from 'next/link';
import {
  deliveryModesIn,
  formatDeliveryMode,
  formatPublishedPrice,
  type Centre,
} from '@ielts-map/core';
import { OperatorBadge } from './OperatorBadge';
import { CentreContactDetails } from './CentreContactDetails';
import { centreDetailHref } from '@/lib/offering-filter';
import { isHttpUrl } from '@/lib/url-safety';
import { FutureOpeningNotice } from './FutureOpeningNotice';
import { OneSkillRetakeOnlyNotice } from './OneSkillRetakeOnlyNotice';
import { UnitedStatesOsrWarning } from './UnitedStatesOsrWarning';

/**
 * The centre picked on the map, summarised at the top of the list column.
 *
 * An earlier attempt scrolled the matching card into view instead, but the
 * results page is ~19,000px tall, and a smooth scroll that far is cancelled the
 * moment the layout shifts. Surfacing the summary next to the map is both more
 * reliable and less work for the reader than being thrown down the page.
 */
export function SelectedCentrePanel({
  centre,
  detailFilterSearch,
  onClose,
}: {
  centre: Centre;
  detailFilterSearch: string;
  onClose: () => void;
}) {
  const detailHref = centreDetailHref(
    centre.ieltsOrgSlug,
    detailFilterSearch,
  );
  return (
    <section
      aria-label={`Selected centre: ${centre.name}`}
      className="mb-4 rounded-lg border border-brand bg-white p-4 shadow-sm ring-1 ring-brand"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium leading-snug">
            <Link href={detailHref} className="hover:underline">
              {centre.name}
            </Link>
          </h2>
          <p className="mt-1 text-sm text-muted">
            {centre.address.raw}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OperatorBadge operator={centre.operator} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Clear selection"
            className="rounded p-1 leading-none text-muted hover:bg-line hover:text-ink"
          >
            ✕
          </button>
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-line pt-3 text-sm sm:grid-cols-3">
        <Detail label="From">
          {centre.oneSkillRetakeOnly
            ? 'One Skill Retake only'
            : formatPublishedPrice(centre.priceFromText)}
        </Detail>
        <Detail label="Formats">
          {deliveryModesIn(centre.offerings).map(formatDeliveryMode).join(' · ') || '—'}
        </Detail>
        <Detail label="Contact information">
          <CentreContactDetails centre={centre} />
        </Detail>
        <Detail label="City">{centre.address.city ?? '—'}</Detail>
        <Detail label="Tests offered">
          {centre.offerings.length} {centre.offerings.length === 1 ? 'option' : 'options'}
        </Detail>
      </dl>

      {centre.futureOpening && (
        <div className="mt-3">
          <FutureOpeningNotice centre={centre} compact />
        </div>
      )}
      {centre.oneSkillRetakeOnly && (
        <div className="mt-3">
          <OneSkillRetakeOnlyNotice />
        </div>
      )}
      {centre.address.country?.toUpperCase() === 'US' && (
        <UnitedStatesOsrWarning compact />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <Link
          href={detailHref}
          className="font-medium text-brand hover:underline"
        >
          View full details →
        </Link>
        {!centre.oneSkillRetakeOnly && isHttpUrl(centre.bookingUrl) && (
          <a
            href={centre.bookingUrl!}
            target="_blank"
            rel="noreferrer nofollow"
            className="text-muted hover:text-ink hover:underline"
          >
            {centre.futureOpening
              ? 'Register interest with IELTS USA'
              : 'Check dates and book'}{' '}
            ↗
          </a>
        )}
      </div>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="sm:mt-0.5">{children}</dd>
    </div>
  );
}
