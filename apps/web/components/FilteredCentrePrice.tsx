'use client';

import { useSearchParams } from 'next/navigation';
import {
  deliveryModesIn,
  filterCentres,
  formatDeliveryMode,
  formatPublishedPrice,
  type Centre,
} from '@ielts-map/core';
import {
  centreDetailHref,
  offeringFilterFromSearch,
} from '@/lib/offering-filter';
import { CentreOfferingsTable } from './CentreOfferingsTable';

/**
 * The canonical centre page lists every offering, but its headline fee should
 * retain the test/delivery context from the directory link that opened it.
 */
export function FilteredCentrePrice({ centre }: { centre: Centre }) {
  const { offeringFilter, projected } = useOfferingProjection(centre);

  return (
    <span data-filtered-price={offeringFilter ? 'true' : 'false'}>
      <span>
        {projected
          ? formatPublishedPrice(projected.priceFromText)
          : 'No matching fee published'}
      </span>
      {offeringFilter && (
        <span className="mt-0.5 block text-xs font-normal text-muted">
          For selected test filters
        </span>
      )}
    </span>
  );
}

export function FilteredCentreFormats({ centre }: { centre: Centre }) {
  const { offeringFilter, projected } = useOfferingProjection(centre);
  const formats = projected
    ? deliveryModesIn(projected.offerings).map(formatDeliveryMode)
    : [];

  return (
    <span data-filtered-formats={offeringFilter ? 'true' : 'false'}>
      {formats.join(' · ') || 'Not published'}
    </span>
  );
}

export function FilteredCentreOfferings({ centre }: { centre: Centre }) {
  const { offeringFilter, projected } = useOfferingProjection(centre);
  return (
    <CentreOfferingsTable
      offerings={projected?.offerings ?? []}
      filtered={Boolean(offeringFilter)}
      clearHref={centreDetailHref(centre.ieltsOrgSlug, '', centre.id)}
    />
  );
}

function useOfferingProjection(centre: Centre): {
  offeringFilter: ReturnType<typeof offeringFilterFromSearch>;
  projected: Centre | undefined;
} {
  const searchParams = useSearchParams();
  const offeringFilter = offeringFilterFromSearch(searchParams);
  const projected = offeringFilter
    ? filterCentres([centre], {
        ...offeringFilter,
        includeUnpublishable: true,
      })[0]
    : centre;

  return { offeringFilter, projected };
}
