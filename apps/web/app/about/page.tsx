import type { Metadata } from 'next';
import { dataset } from '@ielts-map/core/dataset';

export const metadata: Metadata = {
  title: 'About the data',
  description:
    'How this IELTS test centre directory is compiled, what it can and cannot tell you, and where the numbers come from.',
};

export default function AboutPage() {
  const { stats, generatedAt, country } = dataset;
  const precision = Object.entries(stats.byGeoPrecision).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">About the data</h1>
      <p className="mt-2 text-muted">
        Last rebuilt {new Date(generatedAt).toLocaleDateString('en-CA', { dateStyle: 'long' })}.
      </p>

      <Section title="Where listings come from">
        <p>
          Every centre here is taken from the public test-centre pages on IELTS.org, enumerated
          through that site&rsquo;s XML sitemap. IELTS.org is used because it is the only neutral,
          enumerable list that covers all operators — the individual operator sites are either
          incomplete or not machine-readable.
        </p>
        <p>
          We read {stats.sitemapSlugs.toLocaleString()} centre pages worldwide, kept the{' '}
          {stats.matchedCountry} whose address resolves to {country}, and merged duplicate pages
          down to {stats.afterDedup} real centres.
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
          Where a centre page embeds a map coordinate, we use it. Otherwise we geocode the address
          and the centre name separately and keep the better result — those two approaches fail in
          opposite situations. When they disagree badly, we say the location is approximate rather
          than showing a confident pin in the wrong place.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {precision.map(([key, count]) => (
            <li key={key} className="rounded-full border border-line px-3 py-1 text-sm">
              {key === 'none' ? 'no location' : key}: {count}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What this does not tell you">
        <p>
          There are no live test dates or seat availability here. No operator publishes that data
          in a usable form, and scraping the booking flow would breach their terms — so we link out
          to the operator&rsquo;s own booking page instead.
        </p>
        <p>
          Prices are what the source page published when we last crawled it. They change, and may
          exclude local tax. Treat them as a comparison aid, not a quote.
        </p>
        <p>
          A listing being present does not guarantee the centre is currently operating. We hide
          entries with no bookable test, but we have no live feed confirming any centre is open.
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
