import { createServerSupabase } from '@/lib/supabase/server';
import { Table } from '@heroui/react';
import { redirect } from 'next/navigation';

export default async function AuditPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>
        <p className="text-danger">Failed to load audit logs: {error.message}</p>
      </div>
    );
  }

  const formatUUID = (id: string | null) => {
    if (!id) return '—';
    return id.slice(-8);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>

      {(!logs || logs.length === 0) ? (
        <p className="text-default-500">No audit entries found.</p>
      ) : (
        <div className="panel p-4">
        <Table aria-label="Audit logs table">
          <Table.Header>
            <Table.Column>Date</Table.Column>
            <Table.Column>Action</Table.Column>
            <Table.Column>Resource</Table.Column>
            <Table.Column>User</Table.Column>
            <Table.Column>IP</Table.Column>
          </Table.Header>
          <Table.Body>
            {logs.map((log: any) => (
              <Table.Row key={log.id}>
                <Table.Cell className="clinical-data">
                  {new Date(log.created_at).toLocaleString()}
                </Table.Cell>
                <Table.Cell>{log.action}</Table.Cell>
                <Table.Cell className="clinical-data">
                  {log.resource_type} / {formatUUID(log.resource_id)}
                </Table.Cell>
                <Table.Cell className="clinical-data">{formatUUID(log.user_id)}</Table.Cell>
                <Table.Cell>{log.ip_address || '—'}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        </div>
      )}
    </div>
  );
}
