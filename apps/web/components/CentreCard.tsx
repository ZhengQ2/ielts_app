import Link from 'next/link';
import {
  deliveryModesIn,
  formatDistance,
  formatDeliveryMode,
  formatPublishedPrice,
  type CentreWithDistance,
} from '@ielts-map/core';
import { OperatorBadge } from './OperatorBadge';
import { centreDetailHref } from '@/lib/offering-filter';
import { FutureOpeningNotice } from './FutureOpeningNotice';
import { OneSkillRetakeOnlyNotice } from './OneSkillRetakeOnlyNotice';

interface Props {
  centre: CentreWithDistance;
  selected?: boolean;
  detailFilterSearch: string;
  displayMode?: 'full_test' | 'osr';
  onHover?: () => void;
  onSelect?: () => void;
}

export function CentreCard({
  centre,
  selected,
  detailFilterSearch,
  displayMode = 'full_test',
  onHover,
  onSelect,
}: Props) {
  const distance = formatDistance(centre.distanceKm);
  const detailHref = centreDetailHref(
    centre.ieltsOrgSlug,
    detailFilterSearch,
    centre.id,
  );
  return (
    <li
      onMouseEnter={onHover}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`cursor-pointer rounded-lg border bg-white p-4 transition ${
        selected ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-muted'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium leading-snug">
          <Link href={detailHref} className="hover:underline">
            {centre.name}
          </Link>
        </h3>
        <OperatorBadge operator={centre.operator} />
      </div>

      <p className="mt-1 text-sm text-muted">
        {centre.address.raw}
        {distance && <span className="ml-2 text-ink">· {distance}</span>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">
          {displayMode === 'osr'
            ? 'One Skill Retake available'
            : centre.oneSkillRetakeOnly
            ? 'One Skill Retake only'
            : centre.priceFromText !== null
            ? `from ${formatPublishedPrice(centre.priceFromText)}`
            : 'Price not published'}
        </span>
        <span className="text-muted">
          {displayMode === 'osr'
            ? 'Check your test portal for dates and price'
            : centre.oneSkillRetakeOnly
            ? 'No full IELTS test published'
            : deliveryModesIn(centre.offerings).map(formatDeliveryMode).join(' · ')}
        </span>
      </div>
      {centre.oneSkillRetakeOnly && (
        <div className="mt-3">
          <OneSkillRetakeOnlyNotice compact />
        </div>
      )}
      {centre.futureOpening && (
        <div className="mt-3">
          <FutureOpeningNotice centre={centre} compact />
        </div>
      )}
    </li>
  );
}
