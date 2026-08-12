import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

interface AnalyticsRpcResult {
  monthly_volume: { month: string; count: number }[];
  specialty_breakdown: { specialty: string; count: number }[];
  monthly_approval_rate: { month: string; rate: number }[];
  supervisor_workload: {
    supervisor_id: string;
    pending: number;
    approved: number;
    rejected: number;
    supervisor_name: string;
  }[];
}

export default async function AnalyticsPage({
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

  const { data, error } = await supabase.rpc('get_analytics_data', {
    p_tenant_id: auth.profile.tenant_id,
  });

  if (error) {
    throw new Error(`Analytics RPC failed: ${error.message}`);
  }

  const rpc = data as unknown as AnalyticsRpcResult;

  const supervisorWorkload = (rpc.supervisor_workload ?? []).map((w) => ({
    supervisorId: w.supervisor_id,
    supervisorName: w.supervisor_name,
    pending: w.pending,
    approved: w.approved,
    rejected: w.rejected,
  }));

  return (
    <AnalyticsDashboard
      data={{
        monthlyVolume: rpc.monthly_volume ?? [],
        specialtyBreakdown: rpc.specialty_breakdown ?? [],
        supervisorWorkload,
        monthlyApprovalRate: rpc.monthly_approval_rate ?? [],
      }}
    />
  );
}
