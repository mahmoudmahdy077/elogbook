import { createServerSupabase } from '@/lib/supabase/server';
import { Card, Button } from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function ReportsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id, role, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== tenantSlug) redirect('/login');

  const { count: totalCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id);

  const { count: approvedCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'approved');

  const { count: pendingCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'pending');

  const { count: draftCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'draft');

  const { data: entries } = await supabase
    .from('case_entries')
    .select('id, status, case_templates!inner(specialty)')
    .eq('tenant_id', profile.tenant_id);

  const specialtyCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };

  for (const e of (entries ?? [])) {
    const specialty = (e.case_templates as unknown as { specialty: string })?.specialty ?? 'Unknown';
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
        <a href={`/api/${tenantSlug}/export-pdf`}>
          <Button color="primary">
            Export PDF
          </Button>
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card className="panel">
          <Card.Content className="text-center">
            <p className="text-sm text-default-500">Total Cases</p>
            <p className="text-3xl font-bold clinical-data">{totalCount ?? 0}</p>
          </Card.Content>
        </Card>
        <Card className="panel border-t-3 border-t-success">
          <Card.Content className="text-center">
            <p className="text-sm text-success">Approved</p>
            <p className="text-3xl font-bold text-success clinical-data">{approvedCount ?? 0}</p>
          </Card.Content>
        </Card>
        <Card className="panel border-t-3 border-t-primary">
          <Card.Content className="text-center">
            <p className="text-sm text-primary">Pending</p>
            <p className="text-3xl font-bold text-primary clinical-data">{pendingCount ?? 0}</p>
          </Card.Content>
        </Card>
        <Card className="panel border-t-3 border-t-warning">
          <Card.Content className="text-center">
            <p className="text-sm text-warning">Drafts</p>
            <p className="text-3xl font-bold text-warning clinical-data">{draftCount ?? 0}</p>
          </Card.Content>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="panel">
          <Card.Header>
            <h2 className="text-lg font-semibold">Cases by Specialty</h2>
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
            <h2 className="text-lg font-semibold">Status Distribution</h2>
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
