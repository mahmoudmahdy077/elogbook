import { Suspense } from 'react';
import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardContent from '@/components/DashboardContent';
import CardSkeleton from '@/components/CardSkeleton';

type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

interface CaseRow {
  id: string;
  case_date: string;
  status: string;
  case_templates: { name: string; specialty: string };
}

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

  const selectFields = isDirectorPlus
    ? 'id, case_date, status, resident_id, case_templates!inner(name, specialty)'
    : 'id, case_date, status, case_templates!inner(name, specialty)';

  let casesQuery = supabase
    .from('case_entries')
    .select(selectFields)
    .eq('tenant_id', tenantId);
  if (isResident) casesQuery = casesQuery.eq('resident_id', residentId);
  // U4.0: residents see their last 5 cases; director+ also see last 5.
  casesQuery = casesQuery.order('created_at', { ascending: false }).limit(5);

  // U4.0: directors+ get ACCURATE total counts via count queries,
  // not client-side tally of a capped fetch (which under-reported for
  // any tenant with >100 cases).
  const statsPromise = isResident
    ? Promise.resolve(null)
    : Promise.all([
        supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'pending').is('deleted_at', null),
        supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'approved').is('deleted_at', null),
        supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'rejected').is('deleted_at', null),
        supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'draft').is('deleted_at', null),
      ]).then(([p, a, r, d]) => ({
        pending: p.count ?? 0,
        approved: a.count ?? 0,
        rejected: r.count ?? 0,
        draft: d.count ?? 0,
      }));

  const queries: any[] = [
    casesQuery,
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
        .eq('resident_id', residentId)
    );
    queries.push(
      supabase
        .from('duty_weekly_violations')
        .select('week_start, total_hours')
        .eq('resident_id', residentId)
        .order('week_start', { ascending: false })
    );
  }
  if (isDirectorPlus) {
    queries.push(
      supabase
        .from('profiles')
        .select('id, full_name, specialty')
        .eq('tenant_id', tenantId)
        .eq('role', 'resident')
    );
    queries.push(
      supabase
        .from('duty_weekly_violations')
        .select('resident_id, week_start, total_hours')
        .eq('tenant_id', tenantId)
        .order('week_start', { ascending: false })
    );
  }

  const results = await Promise.all(queries);
  const casesResult = results[0] as { data: (CaseRow & { resident_id?: string })[] | null };
  const goalResult = results[1] as { data: GoalRow[] | null };
  const residentProgressIdx = isResident ? 2 : undefined;
  const residentViolationsIdx = isResident ? 3 : undefined;
  const directorViolationsIdx = isDirectorPlus ? (isResident ? 4 : 3) : undefined;
  const residentsDataIdx = isDirectorPlus ? (isResident ? 3 : 2) : undefined;

  const progressResult = residentProgressIdx !== undefined ? results[residentProgressIdx] as { data: ProgressRow[] | null } : { data: null };
  const residentsDataResult = residentsDataIdx !== undefined ? results[residentsDataIdx] as { data: ResidentProfileRow[] | null } : { data: null };
  const residentViolations = residentViolationsIdx !== undefined ? results[residentViolationsIdx] as { data: { week_start: string; total_hours: number }[] | null } : { data: null };
  const directorViolations = directorViolationsIdx !== undefined ? results[directorViolationsIdx] as { data: { resident_id: string; week_start: string; total_hours: number }[] | null } : { data: null };

  // U4.0: Use count-query result for director+; client-side tally only for residents.
  const allCaseRows = casesResult.data ?? [];
  const stats: Record<CaseStatus, number> = isResident
    ? (() => {
        const acc = { draft: 0, pending: 0, approved: 0, rejected: 0 };
        for (const r of allCaseRows) {
          if (!['draft', 'pending', 'approved', 'rejected'].includes(r.status)) continue;
          const s = r.status as CaseStatus;
          acc[s]++;
        }
        return acc;
      })()
    : ((await statsPromise) as { draft: number; pending: number; approved: number; rejected: number });

  const recentCases = allCaseRows.slice(0, 5).map((r) => ({
    id: r.id,
    case_date: r.case_date,
    status: r.status as CaseStatus,
    template_name: r.case_templates?.name || '',
    template_specialty: r.case_templates?.specialty || '',
  }));

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

  const pendingApprovals = isResident
    ? 0
    : stats.pending;

  let residents: { id: string; full_name: string; specialty: string | null; total_cases: number; approved: number }[] = [];
  let totalResidents = 0;

  if (isDirectorPlus) {
    const residentProfiles = residentsDataResult.data;

    totalResidents = (residentProfiles || []).length;

    if (residentProfiles && residentProfiles.length > 0) {
      const totalByResident: Record<string, number> = {};
      const approvedByResident: Record<string, number> = {};

      for (const c of allCaseRows) {
        if (c.resident_id) {
          totalByResident[c.resident_id] = (totalByResident[c.resident_id] || 0) + 1;
          if (c.status === 'approved') {
            approvedByResident[c.resident_id] = (approvedByResident[c.resident_id] || 0) + 1;
          }
        }
      }

      residents = residentProfiles.map((rp: ResidentProfileRow) => ({
        id: rp.id,
        full_name: rp.full_name,
        specialty: rp.specialty,
        total_cases: totalByResident[rp.id] || 0,
        approved: approvedByResident[rp.id] || 0,
      }));
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
        }}
      />
    </Suspense>
  );
}
