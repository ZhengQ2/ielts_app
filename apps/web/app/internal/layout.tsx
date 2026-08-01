import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Internal centre editor',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
