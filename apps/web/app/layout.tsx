import type { Metadata } from 'next';
import Link from 'next/link';
import { dataset } from '@ielts-map/core/dataset';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'IELTS Test Centre Finder — Canada',
    template: '%s · IELTS Test Centre Finder',
  },
  description:
    'Compare official IELTS test centres in Canada by operator, format, price and location.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">Test Centre Finder</span>
              <span className="hidden text-sm text-muted sm:inline">
                {dataset.country === 'CA' ? 'Canada' : dataset.country}
              </span>
            </Link>
            <nav className="text-sm text-muted">
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
            <p className="mt-2">
              Map data ©{' '}
              <a
                className="underline hover:text-ink"
                href="https://www.openstreetmap.org/copyright"
                rel="noreferrer"
                target="_blank"
              >
                OpenStreetMap
              </a>{' '}
              contributors.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
