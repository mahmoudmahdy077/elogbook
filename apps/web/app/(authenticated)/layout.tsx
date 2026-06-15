import { Suspense } from 'react';
import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import ErrorBoundary from '@/components/ErrorBoundary';
import CardSkeleton from '@/components/CardSkeleton';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  try {
    await getAuthContext();
  } catch {
    redirect('/login');
  }
  return (
    <ErrorBoundary>
      <Suspense fallback={<CardSkeleton />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
