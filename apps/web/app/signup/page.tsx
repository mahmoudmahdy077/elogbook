import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ invitation?: string }>;
}

/**
 * /signup is the invitation redemption surface, not an open registration form.
 * The only thing the query string may carry is the invitation token that the
 * tenant administrator's email contained; a plan or tenant hint is ignored
 * because tenant assignment comes from the invitation, never from the URL.
 */
export default async function SignupPage({ searchParams }: PageProps) {
  const { invitation } = await searchParams;

  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      redirect('/onboarding');
    }
  } catch (error) {
    // redirect() signals by throwing; only an unauthenticated read failure
    // should fall through to the invitation form.
    if (error instanceof Error && error.message.startsWith('redirect:')) throw error;
  }

  const invitationCode =
    typeof invitation === 'string' && invitation.trim().length > 0 ? invitation.trim() : null;

  return (
    <div className="min-h-screen bg-backdrop flex items-center justify-center p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <SignupForm invitationCode={invitationCode} />
      </div>
    </div>
  );
}
