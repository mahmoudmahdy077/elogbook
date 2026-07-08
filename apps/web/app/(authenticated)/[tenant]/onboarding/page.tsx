import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  let auth;
  try {
    auth = await getAuthContext();
  } catch {
    redirect('/login');
  }

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  // If onboarding is already completed, redirect to dashboard
  if (auth.profile.onboarding_completed) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  return (
    <div className="min-h-screen bg-backdrop flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <OnboardingWizard
          tenantSlug={tenantSlug}
          profileId={auth.profile.id}
          tenantId={auth.profile.tenant_id}
          initialName={auth.profile.full_name}
          initialSpecialty={auth.profile.specialty}
        />
      </div>
    </div>
  );
}
