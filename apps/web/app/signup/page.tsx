import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ plan?: string }>;
}

export default async function SignupPage({ searchParams }: PageProps) {
  const { plan } = await searchParams;

  // Redirect authenticated users
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      redirect('/onboarding');
    }
  } catch {
    // Not authenticated — show signup
  }

  return (
    <div className="min-h-screen bg-backdrop flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <SignupForm planSlug={plan ?? null} />
      </div>
    </div>
  );
}
