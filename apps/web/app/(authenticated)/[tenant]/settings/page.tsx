import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-heading font-bold">Settings</h1>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Profile</h2>
        <dl className="space-y-3">
          <div className="flex justify-between"><dt className="text-text-muted">Name</dt><dd>{auth.profile.full_name}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Role</dt><dd className="capitalize">{auth.profile.role}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Specialty</dt><dd>{auth.profile.specialty || '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Email</dt><dd>{auth.user.email}</dd></div>
        </dl>
      </div>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Security</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Multi-factor authentication</p>
              <p className="text-xs text-text-muted">
                {auth.aal === 'aal2' ? 'Enabled' : 'Not enabled — required for directors and admins'}
              </p>
            </div>
            <Link href="/mfa/enroll" className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover transition-colors">
              {auth.aal === 'aal2' ? 'Manage' : 'Set up'}
            </Link>
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Consent</h2>
        <Link href={`/${tenantSlug}/consent`} className="text-primary text-sm hover:underline">Manage consent preferences →</Link>
      </div>
    </div>
  );
}
