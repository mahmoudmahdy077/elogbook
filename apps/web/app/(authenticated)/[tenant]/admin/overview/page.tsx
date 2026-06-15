import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ProgramOverviewCharts from '@/components/ProgramOverviewCharts';

interface PendingRow {
  residentId: string;
  name: string;
  specialty: string;
  pendingCases: number;
  lastActivityDays: number;
}

type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export default async function AdminOverviewPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenants = profile.tenants as { slug: string }[];
  const tenant = tenants[0];
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect('/login');
  }

  const tenantId = profile.tenant_id;

  const { data: entries } = await supabase
    .from('case_entries')
    .select('id, status, resident_id, created_at, profiles!inner(id, full_name, specialty), case_templates!inner(id, specialty)')
    .eq('tenant_id', tenantId);

  const statusCounts: Record<CaseStatus, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  const specialtyCounts: Record<string, number> = {};
  const residentMap = new Map<string, { name: string; specialty: string; pending: number; lastActivity: Date }>();

  interface EntryRow {
    id: string;
    status: string;
    resident_id: string;
    created_at: string;
    profiles: { id: string; full_name: string; specialty: string | null }[];
    case_templates: { id: string; specialty: string }[];
  }

  for (const entry of (entries ?? []) as EntryRow[]) {
    const status = entry.status as CaseStatus;
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const templateSpecialty = entry.case_templates[0]?.specialty ?? 'Unknown';
    specialtyCounts[templateSpecialty] = (specialtyCounts[templateSpecialty] || 0) + 1;

    const resident = entry.profiles[0];
    if (!resident) continue;
    const existing = residentMap.get(resident.id);
    const entryDate = new Date(entry.created_at);
    if (!existing) {
      residentMap.set(resident.id, {
        name: resident.full_name,
        specialty: resident.specialty || 'Unknown',
        pending: status === 'pending' ? 1 : 0,
        lastActivity: entryDate,
      });
    } else {
      existing.pending += status === 'pending' ? 1 : 0;
      if (entryDate > existing.lastActivity) existing.lastActivity = entryDate;
    }
  }

  const pendingRows: PendingRow[] = Array.from(residentMap.entries())
    .map(([residentId, r]) => ({
      residentId,
      name: r.name,
      specialty: r.specialty,
      pendingCases: r.pending,
      lastActivityDays: Math.max(0, Math.floor((Date.now() - r.lastActivity.getTime()) / (1000 * 60 * 60 * 24))),
    }))
    .filter((r) => r.pendingCases > 0)
    .sort((a, b) => b.pendingCases - a.pendingCases);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Program Overview</h1>
        <Link
          href={`/${tenantSlug}/admin`}
          className="text-sm text-primary hover:underline"
        >
          ← Back to Admin
        </Link>
      </div>

      <ProgramOverviewCharts statusCounts={statusCounts} specialtyCounts={specialtyCounts} />

      <div className="panel p-5 mt-6">
        <h2 className="text-lg font-heading font-semibold mb-4">Pending Verification by Resident</h2>
        {pendingRows.length === 0 ? (
          <p className="text-sm text-neutral-light/50">No pending cases to review.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-neutral-light/50 border-b border-white/5">
                  <th className="pb-2 font-medium">Resident Name</th>
                  <th className="pb-2 font-medium">Specialty</th>
                  <th className="pb-2 font-medium text-right">Pending Cases</th>
                  <th className="pb-2 font-medium text-right">Days Since Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((row) => (
                  <tr key={row.residentId} className="border-b border-white/5 last:border-0">
                    <td className="py-3">{row.name}</td>
                    <td className="py-3 text-neutral-light/70">{row.specialty}</td>
                    <td className="py-3 text-right clinical-data">{row.pendingCases}</td>
                    <td className="py-3 text-right clinical-data">{row.lastActivityDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
