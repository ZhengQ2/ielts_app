import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { centres, getCentreBySlug } from '@ielts-map/core/dataset';
import { LiveCentrePage } from '@/components/LiveCentrePage';

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
  return <LiveCentrePage initialCentre={centre} />;
}
