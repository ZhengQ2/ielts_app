import { Suspense } from 'react';
import { AddedCentrePage } from '@/components/AddedCentrePage';

export const metadata = {
  title: 'IELTS test centre',
  description: 'Details for a reviewed IELTS test centre added by an administrator.',
};

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-4 py-16">Loading centre…</div>}>
      <AddedCentrePage />
    </Suspense>
  );
}
