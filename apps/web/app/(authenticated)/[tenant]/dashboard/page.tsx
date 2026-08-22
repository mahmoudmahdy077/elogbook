import { Suspense } from 'react';
import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardContent from '@/components/DashboardContent';
import CardSkeleton from '@/components/CardSkeleton';

type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

interface GoalRow {
  id: string;
  title: string;
  target_count: number;
  deadline: string;
  specialty: string | null;
}

interface ProgressRow {
  goal_id: string;
  current_count: number;
}

interface ResidentProfileRow {
  id: string;
  full_name: string;
  specialty: string | null;
}

interface DashboardRpcResult {
  stats: Record<CaseStatus, number>;
  recent_cases: {
    id: string;
    case_date: string;
    status: CaseStatus;
    template_name: string;
    template_specialty: string;
  }[];
  resident_counts: { resident_id: string; total: number; approved: number }[];
  pending_approvals: number;
  total_residents: number;
}

export default async function DashboardPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const { profile, tenant } = auth;
  const residentId = profile.id;
  const tenantId = profile.tenant_id;
  const role = profile.role;

  const isResident = role === 'resident';
  const isDirectorPlus = role === 'director' || role === 'institution_admin' || role === 'admin';

  // ── Single RPC replaces 5+ separate queries ────────────────────────
  // Fetch plan info for upgrade prompts
  const { data: subData } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(slug)')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  const planSlug = (subData as { subscription_plans: { slug: string } } | null)?.subscription_plans?.slug;

  const { data: rpcData, error: rpcError } = await supabase
    .rpc('get_dashboard_data', {
      p_tenant_id: tenantId,
      p_resident_id: residentId,
      p_role: role,
    });

  if (rpcError) {
    throw new Error(`Dashboard RPC failed: ${rpcError.message}`);
  }

  const dashboard = rpcData as unknown as DashboardRpcResult;
  const stats = dashboard.stats;
  const recentCases = dashboard.recent_cases ?? [];
  const pendingApprovals = dashboard.pending_approvals ?? 0;
  const totalResidents = dashboard.total_residents ?? 0;

  // ── Remaining queries (not covered by RPC) ──────────────────────────
  const queries: Array<PromiseLike<unknown>> = [
    supabase
      .from('program_goals')
      .select('id, title, target_count, deadline, specialty')
      .eq('resident_id', residentId)
      .eq('tenant_id', tenantId),
  ];
  if (isResident) {
    queries.push(
      supabase
        .from('goal_progress')
        .select('goal_id, current_count')
        .eq('resident_id', residentId),
    );
    queries.push(
      supabase
        .from('duty_weekly_violations')
        .select('week_start, total_hours')
        .eq('resident_id', residentId)
        .order('week_start', { ascending: false }),
    );
  }
  if (isDirectorPlus) {
    queries.push(
      supabase
        .from('profiles')
        .select('id, full_name, specialty')
        .eq('tenant_id', tenantId)
        .eq('role', 'resident'),
    );
    queries.push(
      supabase
        .from('duty_weekly_violations')
        .select('resident_id, week_start, total_hours')
        .eq('tenant_id', tenantId)
        .order('week_start', { ascending: false }),
    );
  }

  const results = await Promise.all(queries);
  const goalResult = results[0] as { data: GoalRow[] | null };

  // Named destructuring — replaces brittle index math
  const rest = results.slice(1);
  const goalProgressRes = isResident && rest[0] as { data: ProgressRow[] | null };
  const residentViolationRes = isResident && rest[isResident ? 1 : 0] as { data: { week_start: string; total_hours: number }[] | null };
  const residentsDataRes = isDirectorPlus && rest[isResident ? 2 : 0] as { data: ResidentProfileRow[] | null };
  const directorViolationRes = isDirectorPlus && rest[isResident ? 3 : 1] as { data: { resident_id: string; week_start: string; total_hours: number }[] | null };

  const progressResult = goalProgressRes || { data: null };
  const residentsDataResult = residentsDataRes || { data: null };
  const residentViolations = residentViolationRes || { data: null };
  const directorViolations = directorViolationRes || { data: null };

  const goalRows = goalResult.data ?? [];
  const goalProgressMap: Record<string, number> = {};
  const progressRows = progressResult.data;
  if (progressRows) {
    for (const p of progressRows) {
      goalProgressMap[p.goal_id] = p.current_count;
    }
  }

  const goals = goalRows.map((g) => ({
    id: g.id,
    title: g.title,
    current: goalProgressMap[g.id] || 0,
    target: g.target_count,
    deadline: g.deadline,
    specialty: g.specialty,
  }));

  const residents: { id: string; full_name: string; specialty: string | null; total_cases: number; approved: number }[] = [];

  if (isDirectorPlus) {
    const residentProfiles = residentsDataResult.data;

    if (residentProfiles && residentProfiles.length > 0) {
      // Per-resident counts come pre-aggregated from get_dashboard_data
      // (SQL GROUP BY) instead of fetching every row into JS.
      const countsById = new Map((dashboard.resident_counts ?? []).map((c) => [c.resident_id, c]));
      for (const rp of residentProfiles) {
        const c = countsById.get(rp.id);
        residents.push({
          id: rp.id,
          full_name: rp.full_name,
          specialty: rp.specialty,
          total_cases: c?.total ?? 0,
          approved: c?.approved ?? 0,
        });
      }
    }
  }

  return (
    <Suspense
      fallback={
        <div className="space-y-7 p-6">
          {/* KPI rings skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
          {/* Main content skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <CardSkeleton />
            <CardSkeleton />
          </div>
          {/* Quick links skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <DashboardContent
        data={{
          profile: {
            id: profile.id,
            role: profile.role,
            full_name: profile.full_name,
            specialty: profile.specialty,
            tenant_id: profile.tenant_id,
          },
          tenantSlug,
          stats,
          recentCases,
          goals,
          residents,
          pendingApprovals,
          totalResidents,
          tenantType: tenant.tenant_type as 'individual' | 'institution',
          residentViolations: residentViolations.data ?? [],
          directorViolations: directorViolations.data ?? [],
          planSlug,
        }}
      />
    </Suspense>
  );
}
