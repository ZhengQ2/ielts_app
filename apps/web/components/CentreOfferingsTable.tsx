import Link from 'next/link';
import {
  formatDeliveryMode,
  formatPublishedPrice,
  offeringCategory,
  offeringDeliveryMode,
  offeringModule,
  type TestOffering,
} from '@ielts-map/core';

export function CentreOfferingsTable({
  offerings,
  filtered = false,
  clearHref,
}: {
  offerings: TestOffering[];
  filtered?: boolean;
  clearHref?: string;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Tests available</h2>
      <p className="mt-1 text-sm text-muted">
        {filtered
          ? 'Showing fees that match the test filters selected in the directory.'
          : 'Fees as published on IELTS.org. Prices vary over time and may be subject to local tax — confirm with the centre before booking.'}
        {filtered && clearHref && (
          <>
            {' '}
            <Link href={clearHref} className="text-brand underline">
              Show every test and fee
            </Link>
            .
          </>
        )}
      </p>

      {offerings.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line p-6 text-sm text-muted">
          No published offering matches these filters.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 font-medium">Test</th>
                <th className="py-2 font-medium">Format</th>
                <th className="py-2 text-right font-medium">Fee</th>
              </tr>
            </thead>
            <tbody>
              {offerings.map((offering, index) => {
                const delivery = offeringDeliveryMode(offering);
                return (
                  <tr
                    key={`${offeringModule(offering)}-${offeringCategory(offering)}-${offering.format}-${offering.label}-${offering.priceText ?? 'none'}-${index}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="py-2.5">{offering.label}</td>
                    <td className="py-2.5 text-muted">
                      {delivery
                        ? formatDeliveryMode(delivery)
                        : 'Not published'}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatPublishedPrice(offering.priceText)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
