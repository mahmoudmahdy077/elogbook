import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

/* ===================================================================
 * Analytics page — director+ view for case volume trends, specialty
 * breakdown, and supervisor workload.
 * =================================================================== */

interface CaseRow {
  case_date: string;
  status: string;
  case_templates: { specialty: string } | null;
}

interface ApprovalRow {
  supervisor_id: string | null;
  status: string;
}

interface ProfileRow {
  id: string;
  full_name: string;
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
  const tenantId = auth.profile.tenant_id;

  // ── 12-month window ─────────────────────────────────────────────
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const fromDate = twelveMonthsAgo.toISOString().slice(0, 10);

  // ── 1. Case volume & specialty data ─────────────────────────────
  const { data: cases } = await supabase
    .from('case_entries')
    .select('case_date, status, case_templates!inner(specialty)')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .gte('case_date', fromDate)
    .order('case_date', { ascending: true });

  const caseRows: CaseRow[] = cases ?? [];

  // Monthly volume
  const monthlyMap = new Map<string, number>();
  for (const c of caseRows) {
    const month = c.case_date.slice(0, 7); // "YYYY-MM"
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + 1);
  }
  // Fill missing months with zeros
  const monthlyVolume: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyVolume.push({ month: key, count: monthlyMap.get(key) ?? 0 });
  }

  // Specialty breakdown
  const specialtyMap = new Map<string, number>();
  for (const c of caseRows) {
    const spec = c.case_templates?.specialty ?? 'Unspecified';
    specialtyMap.set(spec, (specialtyMap.get(spec) ?? 0) + 1);
  }
  const specialtyBreakdown = Array.from(specialtyMap.entries())
    .map(([specialty, count]) => ({ specialty, count }))
    .sort((a, b) => b.count - a.count);

  // Monthly approval rate (approved / (approved + rejected))
  type MonthBucket = { approved: number; rejected: number };
  const monthlyRateMap = new Map<string, MonthBucket>();
  for (const c of caseRows) {
    const month = c.case_date.slice(0, 7);
    if (!monthlyRateMap.has(month)) {
      monthlyRateMap.set(month, { approved: 0, rejected: 0 });
    }
    const b = monthlyRateMap.get(month)!;
    if (c.status === 'approved') b.approved++;
    else if (c.status === 'rejected') b.rejected++;
  }
  const monthlyApprovalRate: { month: string; rate: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const b = monthlyRateMap.get(key);
    const total = (b?.approved ?? 0) + (b?.rejected ?? 0);
    monthlyApprovalRate.push({
      month: key,
      rate: total > 0 ? b!.approved / total : 0,
    });
  }

  // ── 2. Supervisor workload ─────────────────────────────────────
  const { data: approvals } = await supabase
    .from('approval_requests')
    .select('supervisor_id, status')
    .eq('tenant_id', tenantId);

  const approvalRows: ApprovalRow[] = approvals ?? [];

  // Aggregate by supervisor
  const workloadMap = new Map<
    string,
    { pending: number; approved: number; rejected: number }
  >();
  const supervisorIds = new Set<string>();
  for (const a of approvalRows) {
    if (!a.supervisor_id) continue;
    supervisorIds.add(a.supervisor_id);
    if (!workloadMap.has(a.supervisor_id)) {
      workloadMap.set(a.supervisor_id, { pending: 0, approved: 0, rejected: 0 });
    }
    const w = workloadMap.get(a.supervisor_id)!;
    if (a.status === 'pending') w.pending++;
    else if (a.status === 'approved') w.approved++;
    else if (a.status === 'rejected') w.rejected++;
  }

  // Fetch supervisor names
  let supervisorNames = new Map<string, string>();
  if (supervisorIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(supervisorIds));
    for (const p of (profiles as ProfileRow[]) ?? []) {
      supervisorNames.set(p.id, p.full_name);
    }
  }

  const supervisorWorkload = Array.from(workloadMap.entries())
    .map(([id, counts]) => ({
      supervisorId: id,
      supervisorName: supervisorNames.get(id) ?? 'Unknown',
      ...counts,
    }))
    .sort((a, b) => b.pending - a.pending);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <AnalyticsDashboard
      data={{
        monthlyVolume,
        specialtyBreakdown,
        supervisorWorkload,
        monthlyApprovalRate,
      }}
    />
  );
}
