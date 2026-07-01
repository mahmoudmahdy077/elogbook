import { createServerSupabase } from '@/lib/supabase/server';
import { Card, Button } from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ date_from?: string; date_to?: string }> }) {
  const { tenant: tenantSlug } = await params;
  const { date_from, date_to } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id, role, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenants = profile.tenants as { slug: string; tenant_type: string }[];
  const tenant = tenants[0];
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  const buildQuery = (status?: string) => {
    let q = supabase
      .from('case_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', profile.tenant_id);
    if (status) q = q.eq('status', status);
    if (date_from) q = q.gte('created_at', date_from);
    if (date_to) q = q.lte('created_at', date_to);
    return q;
  };

  const [{ count: totalCount }, { count: approvedCount }, { count: pendingCount }, { count: draftCount }] = await Promise.all([
    buildQuery(),
    buildQuery('approved'),
    buildQuery('pending'),
    buildQuery('draft'),
  ]);

  const buildEntriesQuery = () => {
    let q = supabase
      .from('case_entries')
      .select('id, status, case_templates!inner(specialty)')
      .eq('tenant_id', profile.tenant_id);
    if (date_from) q = q.gte('created_at', date_from);
    if (date_to) q = q.lte('created_at', date_to);
    return q.limit(1000);
  };

  const { data: entries, error: entriesError } = await buildEntriesQuery();
  if (entriesError) return <ErrorDisplay message={entriesError.message} />;

  const specialtyCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };

  interface EntryRow {
    id: string;
    status: string;
    case_templates: { specialty: string }[];
  }

  for (const e of (entries ?? []) as EntryRow[]) {
    const specialty = e.case_templates[0]?.specialty ?? 'Unknown';
    specialtyCounts[specialty] = (specialtyCounts[specialty] || 0) + 1;
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }

  const maxSpecialty = Math.max(1, ...Object.values(specialtyCounts));

  const statusColors: Record<string, string> = {
    approved: 'bg-success',
    pending: 'bg-primary',
    draft: 'bg-warning',
    rejected: 'bg-danger',
  };

  const statusLabels: Record<string, string> = {
    approved: 'Approved',
    pending: 'Pending',
    draft: 'Draft',
    rejected: 'Rejected',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Reports & Analytics</h1>
        <div className="flex gap-2">
          <form className="flex items-center gap-2" method="GET">
            <input
              type="date"
              name="date_from"
              defaultValue={date_from || ''}
              className="px-2 py-1 rounded-lg bg-neutral-dark border border-border text-sm"
            />
            <span className="text-xs text-default-500">to</span>
            <input
              type="date"
              name="date_to"
              defaultValue={date_to || ''}
              className="px-2 py-1 rounded-lg bg-neutral-dark border border-border text-sm"
            />
            <Button type="submit" size="sm" variant="ghost">
              Filter
            </Button>
          </form>
          <a href={`/api/${tenantSlug}/export-pdf`}>
            <Button variant="primary">
              Export PDF
            </Button>
          </a>
        </div>
      </div>

      <div className="panel p-5 mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-8 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-neutral-light/40" />
              <div>
                <p className="text-xs text-neutral-light/50">Total Cases</p>
                <p className="text-2xl font-bold font-heading">{totalCount ?? 0}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_var(--color-emerald-glow)]" />
              <div>
                <p className="text-xs text-emerald-400/60">Approved</p>
                <p className="text-2xl font-bold font-heading text-emerald-400">{approvedCount ?? 0}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_var(--color-amber-glow)]" />
              <div>
                <p className="text-xs text-amber-400/60">Pending</p>
                <p className="text-2xl font-bold font-heading text-amber-400">{pendingCount ?? 0}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-neutral-light/30" />
              <div>
                <p className="text-xs text-neutral-light/50">Drafts</p>
                <p className="text-2xl font-bold font-heading text-neutral-light/70">{draftCount ?? 0}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="panel">
          <Card.Header>
            <div className="flex items-center justify-between w-full">
              <h2 className="text-lg font-semibold">Cases by Specialty</h2>
              <a href={`/api/${tenantSlug}/reports/specialty.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}>
                <Button size="sm" variant="ghost">Export CSV</Button>
              </a>
            </div>
          </Card.Header>
          <Card.Content>
            {Object.keys(specialtyCounts).length === 0 ? (
              <p className="text-default-500 text-sm">No cases logged yet.</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(specialtyCounts)
                  .sort(([, a], [, b]) => b - a)
                  .map(([specialty, count]) => (
                    <div key={specialty}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{specialty}</span>
                        <span className="text-default-500">{count}</span>
                      </div>
                      <div className="w-full bg-default-100 rounded-full h-2.5">
                        <div
                          className="bg-primary h-2.5 rounded-full"
                          style={{ width: `${(count / maxSpecialty) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card.Content>
        </Card>

        <Card className="panel">
          <Card.Header>
            <div className="flex items-center justify-between w-full">
              <h2 className="text-lg font-semibold">Status Distribution</h2>
              <a href={`/api/${tenantSlug}/reports/status.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}>
                <Button size="sm" variant="ghost">Export CSV</Button>
              </a>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="flex items-center justify-center gap-6 py-4">
              {Object.entries(statusCounts).map(([status, count]) => (
                <div key={status} className="flex flex-col items-center gap-1">
                  <div
                    className={`w-6 h-6 rounded-full ${statusColors[status] || 'bg-default-400'}`}
                  />
                  <span className="text-xs text-default-500">{statusLabels[status]}</span>
                  <span className="text-lg font-bold">{count}</span>
                </div>
              ))}
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
