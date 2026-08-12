'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BRITISH_COUNCIL_CHINA_MINI_PROGRAM_QR,
  BRITISH_COUNCIL_CHINA_OSR_GUIDE,
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
  resultsActionLabel,
  resultPortalUrl,
  usesBritishCouncilChinaMiniProgram,
  type Centre,
} from '@ielts-map/core';
import { isHttpUrl } from '@/lib/url-safety';
import { centreDocumentTitle, centrePageDescription } from '@/lib/centre-metadata';
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
import { FutureOpeningNotice } from '@/components/FutureOpeningNotice';
import { OneSkillRetakeOnlyNotice } from '@/components/OneSkillRetakeOnlyNotice';
import { UnitedStatesOsrWarning } from '@/components/UnitedStatesOsrWarning';

interface CentreFeed {
  centres: Centre[];
}

export function LiveCentrePage({
  initialCentre,
  initialFeedCentres,
}: {
  initialCentre: Centre;
  initialFeedCentres?: Centre[];
}) {
  const [centre, setCentre] = useState(initialCentre);
  const [allCentres, setAllCentres] = useState<Centre[]>(initialFeedCentres ?? []);
  const [removed, setRemoved] = useState(false);
  const [showChinaAfterTest, setShowChinaAfterTest] = useState(false);

  useEffect(() => {
    if (initialFeedCentres) {
      setAllCentres(initialFeedCentres);
      const updated = initialFeedCentres.find(
        (candidate) => candidate.id === initialCentre.id,
      );
      if (updated) {
        setCentre(updated);
        setRemoved(false);
      } else {
        setRemoved(true);
      }
      return;
    }
    const controller = new AbortController();
    fetch('/data/centres.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Centre feed returned ${response.status}`);
        return response.json() as Promise<CentreFeed>;
      })
      .then((feed) => {
        setAllCentres(feed.centres);
        const updated = feed.centres.find((candidate) => candidate.id === initialCentre.id);
        if (updated) setCentre(updated);
        else setRemoved(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Keep the static source-backed record as the resilient fallback.
      });
    return () => controller.abort();
  }, [initialCentre, initialFeedCentres]);

  useEffect(() => {
    document.title = centreDocumentTitle(centre);
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', centrePageDescription(centre));
  }, [centre]);

  if (removed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Link href="/" className="text-sm text-muted hover:text-ink">← All centres</Link>
        <h1 className="mt-4 text-2xl font-semibold">Centre not currently published</h1>
        <p className="mt-2 text-muted">
          This centre has been removed from the public directory by an administrator.
        </p>
      </div>
    );
  }

  const caveat = geoCaveat(centre);
  const trust = confidenceLabel(centre);
  const resultsUrl = centre.futureOpening ? null : resultPortalUrl(centre);
  const usesChinaMiniProgram = usesBritishCouncilChinaMiniProgram(centre);
  const rawScoreUrl = centre.futureOpening ? null : rawScoreInquiryUrl(centre);
  const correctionUrl = correctionReportUrl(centre);
  const pickerStart = locationPickerStart(centre, allCentres);
  const isUnitedStatesCentre = centre.address.country?.toUpperCase() === 'US';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-ink">← All centres</Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{centre.name}</h1>
          <p className="mt-1 text-muted">{centre.address.raw}</p>
        </div>
        <OperatorBadge operator={centre.operator} size="md" />
      </header>

      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Fact label="From">
          {centre.oneSkillRetakeOnly ? (
            'One Skill Retake only'
          ) : (
            <Suspense fallback={formatPublishedPrice(centre.priceFromText)}>
              <FilteredCentrePrice centre={centre} />
            </Suspense>
          )}
        </Fact>
        <Fact label="Formats">
          {centre.oneSkillRetakeOnly ? (
            'No full IELTS test published'
          ) : (
            <Suspense
              fallback={
                deliveryModesIn(centre.offerings).map(formatDeliveryMode).join(' · ') ||
                'Not published'
              }
            >
              <FilteredCentreFormats centre={centre} />
            </Suspense>
          )}
        </Fact>
        <Fact label="Contact information">
          <CentreContactDetails centre={centre} />
        </Fact>
      </div>

      {centre.oneSkillRetakeOnly && (
        <div className="mt-6">
          <OneSkillRetakeOnlyNotice />
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {!centre.oneSkillRetakeOnly && isHttpUrl(centre.bookingUrl) && (
          <a
            href={centre.bookingUrl!}
            target="_blank"
            rel="noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 font-medium text-white hover:opacity-90"
          >
            {centre.futureOpening
              ? 'Register interest with IELTS USA'
              : 'Check dates and book'}
            <span aria-hidden>↗</span>
          </a>
        )}
        {resultsUrl && usesChinaMiniProgram && (
          <button
            type="button"
            aria-expanded={showChinaAfterTest}
            aria-controls="china-after-test-options"
            onClick={() => setShowChinaAfterTest((shown) => !shown)}
            className="inline-flex items-center gap-2 rounded-md border border-brand bg-white px-4 py-2.5 font-medium text-brand hover:bg-brand-soft"
          >
            Results &amp; One Skill Retake
            <span aria-hidden>{showChinaAfterTest ? '−' : '+'}</span>
          </button>
        )}
        {resultsUrl && !usesChinaMiniProgram && (
          <a
            href={resultsUrl}
            target="_blank"
            rel="noreferrer nofollow"
            className="inline-flex items-center gap-2 rounded-md border border-brand bg-white px-4 py-2.5 font-medium text-brand hover:bg-brand-soft"
          >
            {resultsActionLabel()} <span aria-hidden>↗</span>
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
      {isUnitedStatesCentre && (
        <UnitedStatesOsrWarning
          showCentreAvailabilityFallback={Boolean(resultsUrl && !centre.offersOneSkillRetake)}
        />
      )}
      {resultsUrl && !isUnitedStatesCentre && !centre.offersOneSkillRetake && (
        <p className="mt-3 text-sm text-muted">
          One Skill Retake may not be available at this test centre. Check your test portal for
          eligible centres and dates.
        </p>
      )}
      {resultsUrl && usesChinaMiniProgram && showChinaAfterTest && (
        <section
          id="china-after-test-options"
          aria-label="Results and One Skill Retake for mainland China"
          className="mt-4 grid gap-5 rounded-lg border border-line bg-white p-4 sm:grid-cols-[12rem_1fr] sm:items-center"
        >
          {/* This is the official BC IELTS China mini-program code. A plain
              image is intentional because the site is statically exported. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BRITISH_COUNCIL_CHINA_MINI_PROGRAM_QR}
            alt="WeChat QR code for the official BC IELTS China mini-program"
            width={192}
            height={217}
            className="mx-auto h-auto w-48 rounded-md border border-line"
          />
          <div>
            <h2 className="font-medium">Use the official WeChat mini-program</h2>
            <p className="mt-2 text-sm text-muted">
              In WeChat, scan this code to open “雅思考试官方服务平台”. Mainland British
              Council candidates can view their test record and results there and register for One
              Skill Retake at available test centres in select cities.
            </p>
            <p className="mt-2 text-sm text-muted">
              One Skill Retake is limited to an eligible full IELTS on computer test and must be
              taken within 60 days. The mini-program shows the sessions available for your result.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <a
                href={BRITISH_COUNCIL_CHINA_OSR_GUIDE}
                target="_blank"
                rel="noreferrer nofollow"
                className="font-medium text-brand hover:underline"
              >
                Official OSR guidance ↗
              </a>
              <a
                href={resultsUrl}
                target="_blank"
                rel="noreferrer nofollow"
                className="text-muted hover:text-ink hover:underline"
              >
                Use the NEEA result service instead ↗
              </a>
            </div>
          </div>
        </section>
      )}
      {centre.futureOpening && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <FutureOpeningNotice centre={centre} />
        </div>
      )}
      {!centre.futureOpening && (
        <p className="mt-3 text-sm text-muted">
          For other after-test services, please contact the test centre.
        </p>
      )}

      {centre.offerings.length > 0 && (
        <Suspense fallback={<CentreOfferingsTable offerings={centre.offerings} />}>
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
            id: centre.id,
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
          {centre.futureOpening && (
            <Row label="Opening status">Future opening — not yet operating</Row>
          )}
          {centre.oneSkillRetakeOnly && (
            <Row label="Test availability">One Skill Retake-only venue</Row>
          )}
          <Row label="Source pages">{centre.sources.length}</Row>
        </dl>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {centre.sources.map((source) =>
            isHttpUrl(source.url) ? (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline hover:text-ink"
                >
                  {source.source}: /{source.externalSlug}
                </a>
              </li>
            ) : (
              <li key={source.url} className="text-muted">
                {source.source}: /{source.externalSlug}
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
            Report another type of incorrect information <span aria-hidden>↗</span>
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

function locationPickerStart(
  centre: Centre,
  allCentres: Centre[],
): { center: { lat: number; lng: number }; zoom: number } {
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
    ? allCentres.filter(
        (candidate) =>
          candidate.geo &&
          candidate.address.country === centre.address.country &&
          candidate.address.city?.trim().toLocaleLowerCase() === city,
      )
    : [];
  if (cityPeers.length > 0) return { center: averageLocation(cityPeers), zoom: 11 };

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

  const countryPeers = allCentres.filter(
    (candidate) => candidate.geo && candidate.address.country === centre.address.country,
  );
  if (countryPeers.length > 0) return { center: averageLocation(countryPeers), zoom: 5 };
  return { center: { lat: 18, lng: 5 }, zoom: 2 };
}

function averageLocation(located: Centre[]): { lat: number; lng: number } {
  const total = located.reduce(
    (sum, centre) => ({
      lat: sum.lat + (centre.geo?.lat ?? 0),
      lng: sum.lng + (centre.geo?.lng ?? 0),
    }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / located.length, lng: total.lng / located.length };
}
