import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import RetentionForm from './RetentionForm';

interface RetentionRow {
  id: string;
  data_retention_days: number;
  name: string;
}

interface ForecastRow {
  forecast_count: number;
}

export default async function RetentionAdminPage({
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

  const supabase = await createServerSupabase();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, data_retention_days, name')
    .eq('id', auth.profile.tenant_id)
    .single();

  const retentionDays = (tenant as RetentionRow | null)?.data_retention_days ?? 2555;

  // Forecast: how many cases would be soft-deleted today at this window?
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const { count: forecastCount } = await supabase
    .from('case_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.profile.tenant_id)
    .is('deleted_at', null)
    .lt('created_at', cutoff);

  return (
    <div>
      <h1 className="text-2xl font-heading font-bold mb-2">Data Retention</h1>
      <p className="text-sm text-neutral-light/60 mb-6">
        Configure how long case entries are kept before being soft-deleted
        (365–3650 days; minimum 1 year, maximum 10 years).
      </p>

      <div className="panel p-4 mb-4">
        <h2 className="text-sm font-medium mb-2">Current policy</h2>
        <p className="text-2xl font-bold">{retentionDays} days</p>
        <p className="text-xs text-neutral-light/60 mt-1">
          {Math.round(retentionDays / 365 * 10) / 10} years
        </p>
      </div>

      <div className="panel p-4 mb-4">
        <h2 className="text-sm font-medium mb-2">Forecast</h2>
        <p className="text-sm text-neutral-light/80">
          {forecastCount ?? 0} cases would be soft-deleted if the purge ran now.
        </p>
        <p className="text-xs text-neutral-light/50 mt-1">
          Based on entries created before {new Date(cutoff).toLocaleDateString()}.
        </p>
      </div>

      <RetentionForm currentDays={retentionDays} tenantId={auth.profile.tenant_id} />
    </div>
  );
}
