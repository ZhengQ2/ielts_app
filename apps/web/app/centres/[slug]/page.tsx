import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { centres, getCentreBySlug } from '@ielts-map/core/dataset';
import { LiveCentrePage } from '@/components/LiveCentrePage';
import { centrePageDescription, centrePageTitle } from '@/lib/centre-metadata';

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return [
    ...new Set(
      centres.flatMap((centre) => [centre.ieltsOrgSlug, ...centre.mergedSlugs]),
    ),
  ].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const centre = getCentreBySlug(slug);
  if (!centre) return { title: 'Centre not found' };

  return {
    title: centrePageTitle(centre),
    description: centrePageDescription(centre),
    // Merged duplicate slugs still resolve, so point them at the canonical page
    // rather than letting them compete with it in search results.
    alternates: { canonical: `/centres/${centre.ieltsOrgSlug}` },
  };
}

export default async function CentrePage({ params }: Props) {
  const { slug } = await params;
  const centre = getCentreBySlug(slug);
  if (!centre) notFound();
  return <LiveCentrePage initialCentre={centre} />;
}
