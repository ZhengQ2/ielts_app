import Link from 'next/link';
import {
  formatDistance,
  formatFormat,
  formatPrice,
  isPinnable,
  type CentreWithDistance,
} from '@ielts-map/core';
import { OperatorBadge } from './OperatorBadge';

interface Props {
  centre: CentreWithDistance;
  selected?: boolean;
  onHover?: () => void;
  onSelect?: () => void;
}

export function CentreCard({ centre, selected, onHover, onSelect }: Props) {
  const distance = formatDistance(centre.distanceKm);

  return (
    <li
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`rounded-lg border bg-white p-4 transition ${
        selected ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-muted'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium leading-snug">
          <Link href={`/centres/${centre.ieltsOrgSlug}`} className="hover:underline">
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
          {centre.priceFrom !== null ? `from ${formatPrice(centre.priceFrom, centre.currency)}` : 'Price not published'}
        </span>
        <span className="text-muted">{centre.formats.map(formatFormat).join(' · ')}</span>
        {!isPinnable(centre.geo) && (
          <span className="text-xs text-muted italic">approximate location</span>
        )}
      </div>
    </li>
  );
}
