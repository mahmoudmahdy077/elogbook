import { getAuthContext } from '@/lib/supabase/auth';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import MobileAppPanel from './MobileAppPanel';
import { parseMobileRemoteConfig } from '@elogbook/shared';

export const dynamic = 'force-dynamic';

export default async function MobileAppPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');
  if (!['director', 'institution_admin', 'admin'].includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  // Config controls and device-token counts are operational, not clinical;
  // a service-role read keeps the page working even if a legacy RLS policy
  // on the new table drifts on an upgraded database.
  const admin = createServiceRoleClient();
  const [{ data: row }, { count: devices }, { data: tenantRow }] = await Promise.all([
    admin.from('mobile_app_config').select('*').eq('tenant_id', auth.tenant.id).maybeSingle(),
    admin
      .from('push_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id)
      .eq('active', true),
    admin.from('tenants').select('settings').eq('id', auth.tenant.id).single(),
  ]);

  const config = parseMobileRemoteConfig(row);
  const rawGoal = (tenantRow?.settings as Record<string, unknown> | null)?.daily_case_goal;
  const dailyGoal = typeof rawGoal === 'number' && Number.isInteger(rawGoal) ? rawGoal : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold">Mobile App</h1>
          <p className="text-sm text-text-muted mt-1">
            Control the E-Logbook phone app for {auth.tenant.name}: modules, maintenance,
            version gate, announcements and push.
          </p>
        </div>
        <Link
          href={`/${tenantSlug}/admin`}
          className="text-sm text-fg-primary hover:underline whitespace-nowrap"
        >
          ← Back to Admin
        </Link>
      </div>

      <MobileAppPanel
        tenantSlug={tenantSlug}
        initialConfig={config}
        initialDevices={devices ?? 0}
        initialDailyGoal={dailyGoal}
        lastUpdated={typeof row?.updated_at === 'string' ? row.updated_at : null}
      />
    </div>
  );
}
