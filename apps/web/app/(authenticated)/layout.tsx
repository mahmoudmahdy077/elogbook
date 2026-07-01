import { Suspense } from 'react';
import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import ErrorBoundary from '@/components/ErrorBoundary';
import CardSkeleton from '@/components/CardSkeleton';

// Every page under (authenticated) requires a valid Supabase session
// and per-request data — they CANNOT be statically prerendered.
// Without this, the build step calls getAuthContext() at compile time
// and crashes with 'Missing NEXT_PUBLIC_SUPABASE_URL' on Vercel.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  let auth;
  try {
    auth = await getAuthContext();
  } catch {
    redirect('/login');
  }

  // Onboarding guard is handled in [tenant]/layout.tsx since it has access to params
  return (
    <ErrorBoundary>
      <Suspense fallback={<CardSkeleton />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
