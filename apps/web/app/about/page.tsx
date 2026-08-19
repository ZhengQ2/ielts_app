import type { Metadata } from 'next';
import {
  dataset,
  futureOpeningCount,
} from '@ielts-map/core/dataset';
import {
  countryName,
  genericCorrectionReportUrl,
} from '@ielts-map/core';

export const metadata: Metadata = {
  title: 'About the data',
  description:
    'How this IELTS test centre directory is compiled, what it can and cannot tell you, and where the numbers come from.',
};

export default function AboutPage() {
  const { stats, generatedAt, country } = dataset;
  const usesCombinedDiscovery = stats.discoveredSlugs !== undefined;
  const discoveredSlugs = stats.discoveredSlugs ?? stats.sitemapSlugs;
  const precision = Object.entries(stats.byGeoPrecision).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">About the data</h1>
      <p className="mt-2 text-muted">
        Last rebuilt {new Date(generatedAt).toLocaleDateString('en-CA', { dateStyle: 'long' })}.
      </p>

      <Section title="Where listings come from">
        {usesCombinedDiscovery ? (
          <p>
            Every centre here is taken from the public test-centre pages on IELTS.org. We discover
            those pages through both IELTS.org&rsquo;s XML sitemap and its country or region
            listings, then crawl the combined set. IELTS.org is used because it is the only
            neutral, enumerable source that covers all operators — the individual operator sites
            are either incomplete or not machine-readable.
          </p>
        ) : (
          <p>
            Every centre here is taken from the public test-centre pages on IELTS.org, enumerated
            through that site&rsquo;s XML sitemap. IELTS.org is used because it is the only neutral,
            enumerable list that covers all operators — the individual operator sites are either
            incomplete or not machine-readable.
          </p>
        )}
        <p>
          We discovered {discoveredSlugs.toLocaleString()} unique centre pages worldwide and
          successfully read {stats.pagesParsed.toLocaleString()} of them.{' '}
          {country === 'ALL' ? (
            <>We attributed {stats.matchedCountry.toLocaleString()} to a country or region</>
          ) : (
            <>
              We kept the {stats.matchedCountry.toLocaleString()} whose address resolves to{' '}
              {countryName(country)}
            </>
          )}
          . After merging duplicate pages, the dataset contains{' '}
          {stats.afterDedup.toLocaleString()} real centre records.
        </p>
        <p>
          Country or region comes from IELTS.org&rsquo;s own{' '}
          <span className="whitespace-nowrap">/test-centres?country=</span> listing — the
          operator&rsquo;s own filing, not a guess — with the page&rsquo;s address, booking link and
          phone number as a fallback for the rare slug that listing omits.
        </p>
      </Section>

      <Section title="How we tell operators apart">
        <p>
          A centre&rsquo;s operator is read from the domain its &ldquo;Book A Test&rdquo; link
          points at, not from its name or URL. Many centres carry no operator branding at all, so
          the booking link is the only reliable signal. Each listing shows which signal was used.
        </p>
      </Section>

      <Section title="How locations are resolved">
        <p>
          A coordinate is treated as verified only when two different evidence paths agree, such
          as the page embed and the address, or the address and venue name. An embedded point alone
          is never described as rooftop truth. When evidence disagrees, the location remains
          approximate or unverified instead of showing a confident pin in the wrong place.
        </p>
        <p>
          Geocoding uses the Google Geocoding API where available, with AMap and Mappls as regional
          evidence for China and India. The interactive map is Google Maps.
        </p>
        <p>
          English remains the source record. For a precise China pin, a Chinese address is shown
          only as internal matching evidence when a nearby AMap school or IELTS point matches the
          published street number where one is available. Mappls evidence in India is treated the
          same way. Localized venue names may be shown when corroborated, but the user-facing
          address remains IELTS.org&rsquo;s canonical text.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {precision.map(([key, count]) => (
            <li key={key} className="rounded-full border border-line px-3 py-1 text-sm">
              {key === 'none' ? 'no location' : key}: {count}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Future openings">
        <p>
          The directory includes {futureOpeningCount.toLocaleString()} IELTS USA locations that the
          operator identifies as future openings. They are clearly marked as not yet open and have
          no scheduled test dates.
        </p>
        <p>
          These locations are the only exception to the usual published-price requirement because
          their official forms let candidates register interest before bookings begin. The form is
          not evidence that a test date or seat is available.
        </p>
      </Section>

      <Section title="What this does not tell you">
        <p>
          There are no live test dates or seat counts here. The official material we reviewed
          exposes no documented global feed, and we do not inspect login-gated or undocumented
          booking endpoints. Use the operator link to confirm a date and complete a booking.
        </p>
        <p>
          Prices are what the source page published when we last crawled it, in whatever currency
          that centre quotes — we don&rsquo;t convert between currencies, so the price filter only
          appears once you&rsquo;ve narrowed to one country or region. Prices change, and may exclude local
          tax. Treat them as a comparison aid, not a quote.
        </p>
        <p>
          A listing being present does not guarantee the centre is currently operating. We
          ordinarily hide entries with no test type or no published price for any test type. The
          explicitly marked IELTS USA future openings are retained only so candidates can use the
          operator&rsquo;s interest forms. We do not otherwise automate opening or registration
          status.
        </p>
      </Section>

      <Section title="Corrections">
        <p>
          Source listings and embedded map pins can be wrong or out of date. To correct a map
          location, open that centre&rsquo;s detail page and use its exact-location picker. You
          can{' '}
          <a
            href={genericCorrectionReportUrl()}
            target="_blank"
            rel="noreferrer nofollow"
            className="font-medium text-brand underline"
          >
            report an opening-status or other listing correction
          </a>
          . Reports open as public GitHub issues and require evidence; they are reviewed manually
          before any change is published.
        </p>
        <p>
          Approved corrections are stored separately from the crawl so a known upstream error does
          not overwrite the verified information during the next refresh.
        </p>
      </Section>

      <Section title="Independence">
        <p>
          This is an independent directory. It is not affiliated with, endorsed by, or operated by
          IDP, the British Council, or Cambridge University Press &amp; Assessment.
          &ldquo;IELTS&rdquo; and operator names are used descriptively to identify the test and
          the organisations that run these centres.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-muted">{children}</div>
    </section>
  );
}
