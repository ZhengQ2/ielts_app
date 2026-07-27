import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { centres, getCentreBySlug } from '@ielts-map/core/dataset';
import {
  confidenceLabel,
  formatFormat,
  formatPrice,
  geoCaveat,
  isPinnable,
} from '@ielts-map/core';
import DetailMap from '@/components/LazyDetailMap';

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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-muted hover:text-ink">
        ← All centres
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{centre.name}</h1>
          <p className="mt-1 text-muted">{centre.address.raw}</p>
        </div>
        <span className="rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand">
          {centre.operator}
        </span>
      </header>

      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        <Fact label="From">{formatPrice(centre.priceFrom, centre.currency)}</Fact>
        <Fact label="Formats">{centre.formats.map(formatFormat).join(' · ') || '—'}</Fact>
        <Fact label="Phone">
          {centre.phone ? (
            <a href={`tel:${centre.phone.replace(/[^\d+]/g, '')}`} className="hover:underline">
              {centre.phone}
            </a>
          ) : (
            '—'
          )}
        </Fact>
      </div>

      {centre.bookingUrl && (
        <a
          href={centre.bookingUrl}
          target="_blank"
          rel="noreferrer nofollow"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 font-medium text-white hover:opacity-90"
        >
          Book on the {centre.operator} site
          <span aria-hidden>↗</span>
        </a>
      )}

      {centre.offerings.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-medium">Tests available</h2>
          <p className="mt-1 text-sm text-muted">
            Fees as published on IELTS.org. Prices vary over time and may be subject to local tax —
            confirm with the centre before booking.
          </p>
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
                {centre.offerings.map((o) => (
                  <tr key={o.label} className="border-b border-line last:border-0">
                    <td className="py-2.5">{o.label}</td>
                    <td className="py-2.5 text-muted">{formatFormat(o.format)}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {formatPrice(o.price, o.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
            />
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-line p-6 text-sm text-muted">
            We could not resolve a reliable map location for this centre. The address above is the
            source of truth.
          </p>
        )}
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
              {centre.geo.precision} · via {centre.geo.source.replace('_', ' ')}
            </Row>
          )}
          <Row label="Source pages">{centre.sources.length}</Row>
        </dl>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {centre.sources.map((s) => (
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
          ))}
        </ul>
        {centre.mergedSlugs.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            {centre.mergedSlugs.length} duplicate listing
            {centre.mergedSlugs.length === 1 ? '' : 's'} merged into this record.
          </p>
        )}
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
