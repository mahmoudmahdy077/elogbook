import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardContent from '@/components/DashboardContent';

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

  const queries = [
    supabase
      .from('case_entries')
      .select(selectFields)
      .eq('tenant_id', tenantId)
      .eq(isResident ? 'resident_id' : 'tenant_id', isResident ? residentId : tenantId)
      .order('created_at', { ascending: false })
      .limit(isResident ? 5 : 100),
    supabase
      .from('program_goals')
      .select('id, title, target_count, deadline, specialty')
      .eq('resident_id', residentId)
      .eq('tenant_id', tenantId),
  ];

  const [casesResult, goalResult] = await Promise.all(queries);

  const allCaseRows = (casesResult.data || []) as unknown as (CaseRow & { resident_id?: string })[];
  const stats: Record<CaseStatus, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  for (const r of allCaseRows) {
    const s = r.status as CaseStatus;
    if (s in stats) stats[s]++;
  }

  const recentCases = allCaseRows.slice(0, 5).map((r) => ({
    id: r.id,
    case_date: r.case_date,
    status: r.status as CaseStatus,
    template_name: r.case_templates?.name || '',
    template_specialty: r.case_templates?.specialty || '',
  }));

  const goalRows = (goalResult.data || []) as unknown as GoalRow[];
  const goalProgressMap: Record<string, number> = {};
  if (goalRows.length > 0) {
    const goalIds = goalRows.map((g) => g.id);
    const { data: progressRows } = await supabase
      .from('goal_progress')
      .select('goal_id, current_count')
      .in('goal_id', goalIds);
    for (const p of (progressRows || []) as ProgressRow[]) {
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
    const { data: residentProfiles } = await supabase
      .from('profiles')
      .select('id, full_name, specialty')
      .eq('tenant_id', tenantId)
      .eq('role', 'resident');

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
      }}
    />
  );
}
