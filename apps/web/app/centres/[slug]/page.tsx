import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { centres, getCentreBySlug } from '@ielts-map/core/dataset';
import {
  availabilityGuidance,
  boundsFor,
  confidenceLabel,
  correctionReportUrl,
  deliveryModesIn,
  formatDeliveryMode,
  formatPublishedPrice,
  geoCaveat,
  isPinnable,
  operatorStyle,
  rawScoreInquiryUrl,
  resultPortalUrl,
} from '@ielts-map/core';
import { isHttpUrl } from '@/lib/url-safety';
import DetailMap from '@/components/LazyDetailMap';
import { OperatorBadge } from '@/components/OperatorBadge';
import { CentreContactDetails } from '@/components/CentreContactDetails';
import { LocationCorrectionReport } from '@/components/LocationCorrectionReport';
import {
  FilteredCentreFormats,
  FilteredCentreOfferings,
  FilteredCentrePrice,
} from '@/components/FilteredCentrePrice';
import { CentreOfferingsTable } from '@/components/CentreOfferingsTable';
import { CentreAvailabilityNotice } from '@/components/CentreAvailabilityNotice';

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return centres.map((c) => ({ slug: c.ieltsOrgSlug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const centre = getCentreBySlug(slug);
  if (!centre) return { title: 'Centre not found' };

  const where = centre.address.city ? ` in ${centre.address.city}` : '';
  return {
    title: `${centre.name} — IELTS test centre${where}`,
    description: `${centre.name}${where}: address, test formats, published fees and how to book. Operated by ${centre.operator}.`,
    // Merged duplicate slugs still resolve, so point them at the canonical page
    // rather than letting them compete with it in search results.
    alternates: { canonical: `/centres/${centre.ieltsOrgSlug}` },
  };
}

export default async function CentrePage({ params }: Props) {
  const { slug } = await params;
  const centre = getCentreBySlug(slug);
  if (!centre) notFound();

  const caveat = geoCaveat(centre);
  const trust = confidenceLabel(centre);
  const resultsUrl = resultPortalUrl(centre);
  const rawScoreUrl = rawScoreInquiryUrl(centre);
  const correctionUrl = correctionReportUrl(centre);
  const pickerStart = locationPickerStart(centre);
  const availability = availabilityGuidance(centre);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← All centres
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{centre.name}</h1>
          <p className="mt-1 text-muted">
            {centre.address.raw}
          </p>
        </div>
        <OperatorBadge operator={centre.operator} size="md" />
      </header>

      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Fact label="From">
          <Suspense fallback={formatPublishedPrice(centre.priceFromText)}>
            <FilteredCentrePrice centre={centre} />
          </Suspense>
        </Fact>
        <Fact label="Formats">
          <Suspense
            fallback={
              deliveryModesIn(centre.offerings)
                .map(formatDeliveryMode)
                .join(' · ') || 'Not published'
            }
          >
            <FilteredCentreFormats centre={centre} />
          </Suspense>
        </Fact>
        <Fact label="Contact information">
          <CentreContactDetails centre={centre} />
        </Fact>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {isHttpUrl(availability.actionUrl) && availability.actionLabel && (
          <a
            href={availability.actionUrl!}
            target="_blank"
            rel="noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 font-medium text-white hover:opacity-90"
          >
            {availability.actionLabel}
            <span aria-hidden>↗</span>
          </a>
        )}
        {resultsUrl && (
          <a
            href={resultsUrl}
            target="_blank"
            rel="noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-md border border-brand bg-white px-4 py-2.5 font-medium text-brand hover:bg-brand-soft"
          >
            Check results
            <span aria-hidden>↗</span>
          </a>
        )}
        {rawScoreUrl && (
          <a
            href={rawScoreUrl}
            target={rawScoreUrl.startsWith('https:') ? '_blank' : undefined}
            rel={rawScoreUrl.startsWith('https:') ? 'noreferrer nofollow' : undefined}
            className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-4 py-2.5 font-medium hover:border-muted"
          >
            Inquire about raw score
            <span aria-hidden>{rawScoreUrl.startsWith('https:') ? '↗' : '✉'}</span>
          </a>
        )}
      </div>
      <div className="mt-3 rounded-lg border border-line bg-surface p-3">
        <CentreAvailabilityNotice centre={centre} />
      </div>
      <p className="mt-3 text-sm text-muted">
        For other after-test services, please contact the test centre.
      </p>

      {centre.offerings.length > 0 && (
        <Suspense
          fallback={<CentreOfferingsTable offerings={centre.offerings} />}
        >
          <FilteredCentreOfferings centre={centre} />
        </Suspense>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-medium">Location</h2>
        {caveat && <p className="mt-1 text-sm text-muted">{caveat}</p>}
        {centre.geo ? (
          <div className="mt-3 h-72 overflow-hidden rounded-lg border border-line">
            <DetailMap
              lat={centre.geo.lat}
              lng={centre.geo.lng}
              precise={isPinnable(centre.geo)}
              label={centre.name}
              color={operatorStyle(centre.operator).base}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-line p-6 text-sm text-muted">
            We could not resolve a reliable map location for this centre. The address above is the
            source of truth.
          </p>
        )}
        <LocationCorrectionReport
          centre={{
            name: centre.name,
            ieltsOrgSlug: centre.ieltsOrgSlug,
            sources: centre.sources,
          }}
          initialCenter={pickerStart.center}
          initialZoom={pickerStart.zoom}
          hasLocation={Boolean(centre.geo)}
        />
      </section>

      <section className="mt-10 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-medium">Where this listing comes from</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Operator determined by">{operatorSourceLabel(centre.operatorSource)}</Row>
          <Row label="Listing confidence">
            <span className={trustClass(trust)}>{trust}</span>{' '}
            <span className="text-muted">({centre.confidence.toFixed(2)})</span>
          </Row>
          {centre.geo && (
            <Row label="Location precision">
              {centre.geo.verification} · {centre.geo.precision} · via{' '}
              {centre.geo.source.replace('_', ' ')}
            </Row>
          )}
          <Row label="Availability evidence">
            {availability.operatorVerified
              ? 'Operator-published status'
              : 'No fresh supported status'}
          </Row>
          <Row label="Source pages">{centre.sources.length}</Row>
        </dl>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {centre.sources.map((s) =>
            isHttpUrl(s.url) ? (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline hover:text-ink"
                >
                  {s.source}: /{s.externalSlug}
                </a>
              </li>
            ) : (
              <li key={s.url} className="text-muted">
                {s.source}: /{s.externalSlug}
              </li>
            ),
          )}
        </ul>
        {centre.mergedSlugs.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {centre.mergedSlugs.length} duplicate listing
            {centre.mergedSlugs.length === 1 ? '' : 's'} merged into this record.
          </p>
        )}
        {centre.geo?.source === 'admin' && (
          <p className="mt-3 text-xs text-muted">
            A reviewed correction overrides location information known to be wrong on the source
            listing.
          </p>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <a
            href={correctionUrl}
            target="_blank"
            rel="noreferrer nofollow"
            className="font-medium text-brand underline decoration-brand/30 underline-offset-4 hover:decoration-brand"
          >
            Report another type of incorrect information
            <span aria-hidden> ↗</span>
          </a>
          <p className="mt-1 text-xs text-muted">
            Opening status, contact details and other corrections are reviewed manually before
            publication. GitHub sign-in is required to submit.
          </p>
        </div>
      </section>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 sm:block">
      <dt className="text-muted">{label}</dt>
      <dd className="sm:mt-0.5">{children}</dd>
    </div>
  );
}

function operatorSourceLabel(source: string): string {
  switch (source) {
    case 'booking_domain':
      return 'booking link domain (reliable)';
    case 'slug':
      return 'page slug (weak)';
    case 'name':
      return 'centre name (weak)';
    default:
      return 'not determined';
  }
}

function trustClass(trust: string): string {
  if (trust === 'high') return 'font-medium text-emerald-700';
  if (trust === 'medium') return 'font-medium text-amber-700';
  return 'font-medium text-red-700';
}

function locationPickerStart(centre: (typeof centres)[number]): {
  center: { lat: number; lng: number };
  zoom: number;
} {
  if (centre.geo) {
    const zoomByPrecision = {
      rooftop: 16,
      street: 15,
      postcode: 13,
      city: 11,
      country: 6,
      approximate: 8,
    } as const;
    return {
      center: { lat: centre.geo.lat, lng: centre.geo.lng },
      zoom: zoomByPrecision[centre.geo.precision],
    };
  }

  const city = centre.address.city?.trim().toLocaleLowerCase();
  const cityPeers = city
    ? centres.filter(
        (candidate) =>
          candidate.geo &&
          candidate.address.country === centre.address.country &&
          candidate.address.city?.trim().toLocaleLowerCase() === city,
      )
    : [];
  if (cityPeers.length > 0) {
    return { center: averageLocation(cityPeers), zoom: 11 };
  }

  const bounds = boundsFor(centre.address.country);
  if (bounds) {
    const span = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLng - bounds.minLng);
    return {
      center: {
        lat: (bounds.minLat + bounds.maxLat) / 2,
        lng: (bounds.minLng + bounds.maxLng) / 2,
      },
      zoom: span > 80 ? 3 : span > 35 ? 4 : span > 15 ? 5 : 6,
    };
  }

  const countryPeers = centres.filter(
    (candidate) =>
      candidate.geo && candidate.address.country === centre.address.country,
  );
  if (countryPeers.length > 0) {
    return { center: averageLocation(countryPeers), zoom: 5 };
  }

  return { center: { lat: 18, lng: 5 }, zoom: 2 };
}

function averageLocation(located: (typeof centres)[number][]): {
  lat: number;
  lng: number;
} {
  const total = located.reduce(
    (sum, centre) => ({
      lat: sum.lat + (centre.geo?.lat ?? 0),
      lng: sum.lng + (centre.geo?.lng ?? 0),
    }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: total.lat / located.length,
    lng: total.lng / located.length,
  };
}
