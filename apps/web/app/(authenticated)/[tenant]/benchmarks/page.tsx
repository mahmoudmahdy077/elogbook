import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import BenchmarkingDashboard, {
  type BenchmarkRow,
} from '@/components/BenchmarkingDashboard';

interface BenchmarkRpcRow {
  specialty: string;
  procedure_type: string;
  own_cases: number;
  own_residents: number;
  own_avg_per_resident: number | null;
  peer_avg_per_resident: number | null;
  peer_tenant_count: number;
  peer_total_residents: number;
  percentile: number | null;
}

export default async function BenchmarksPage({
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

  const { data, error } = await supabase.rpc('get_benchmark_comparison', {
    p_tenant_id: auth.profile.tenant_id,
  });

  if (error) {
    throw new Error(`Benchmark RPC failed: ${error.message}`);
  }

  const rpc = (data ?? []) as unknown as BenchmarkRpcRow[];

  const rows: BenchmarkRow[] = rpc.map((r) => ({
    specialty: r.specialty,
    procedureType: r.procedure_type,
    ownCases: r.own_cases,
    ownResidents: r.own_residents,
    ownAvgPerResident: r.own_avg_per_resident,
    peerAvgPerResident: r.peer_avg_per_resident,
    peerTenantCount: r.peer_tenant_count,
    peerTotalResidents: r.peer_total_residents,
    percentile: r.percentile,
  }));

  return <BenchmarkingDashboard data={{ rows }} />;
}
