import type { Metadata } from 'next';
import Link from 'next/link';
import { dataset } from '@ielts-map/core/dataset';
import { countryFacets, countryName } from '@ielts-map/core';
import './globals.css';

/** 'ALL' means the dataset spans every country IELTS.org lists. */
const countries = countryFacets(dataset.centres);
const isWorldwide = countries.length > 1;
const scopeLabel = isWorldwide
  ? 'Worldwide'
  : countryName(dataset.centres[0]?.address.country) || dataset.country;

export const metadata: Metadata = {
  title: {
    default: `IELTS Test Centre Finder — ${scopeLabel}`,
    template: '%s · IELTS Test Centre Finder',
  },
  description: isWorldwide
    ? 'Compare official IELTS test centres worldwide by operator, format, price and location.'
    : `Compare official IELTS test centres in ${scopeLabel} by operator, format, price and location.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Test Centre Finder</span>
              <span className="hidden text-sm text-muted sm:inline">{scopeLabel}</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              {process.env.NODE_ENV === 'development' ? (
                <Link href="/neutral-map" className="hover:text-ink">
                  Neutral map lab
                </Link>
              ) : null}
              <Link href="/about" className="hover:text-ink">
                About the data
              </Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="mt-16 border-t border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
            <p>
              Centre listings are compiled from{' '}
              <a
                className="underline hover:text-ink"
                href="https://ielts.org/test-centres"
                rel="noreferrer"
                target="_blank"
              >
                ielts.org
              </a>
              . Independent directory — not affiliated with or endorsed by IDP, the British
              Council, or Cambridge. &ldquo;IELTS&rdquo; is used descriptively to identify the
              test these centres administer.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
