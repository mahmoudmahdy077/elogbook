import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SettingsSections from '@/components/SettingsSections';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Settings</h1>

      <SettingsSections
        profile={{
          id: auth.profile.id,
          full_name: auth.profile.full_name,
          specialty: auth.profile.specialty,
          role: auth.profile.role,
        }}
        email={auth.user.email ?? ''}
        aal={auth.aal}
      />

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Consent</h2>
        <Link href={`/${tenantSlug}/consent`} className="inline-flex items-center min-h-[44px] text-primary text-sm hover:underline">Manage consent preferences →</Link>
      </div>
    </div>
  );
}
