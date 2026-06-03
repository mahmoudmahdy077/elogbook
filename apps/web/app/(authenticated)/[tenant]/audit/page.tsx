import { createServerSupabase } from '@/lib/supabase/server';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from '@heroui/react';
import { redirect } from 'next/navigation';

export default async function AuditPage({ params }: { params: { tenant: string } }) {
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
  if (tenant.slug !== params.tenant) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect(`/${params.tenant}/dashboard`);
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
        <Table aria-label="Audit logs table">
          <TableHeader>
            <TableColumn>Date</TableColumn>
            <TableColumn>Action</TableColumn>
            <TableColumn>Resource</TableColumn>
            <TableColumn>User</TableColumn>
            <TableColumn>IP</TableColumn>
          </TableHeader>
          <TableBody>
            {logs.map((log: any) => (
              <TableRow key={log.id}>
                <TableCell>
                  {new Date(log.created_at).toLocaleString()}
                </TableCell>
                <TableCell>{log.action}</TableCell>
                <TableCell>
                  {log.resource_type} / {formatUUID(log.resource_id)}
                </TableCell>
                <TableCell>{formatUUID(log.user_id)}</TableCell>
                <TableCell>{log.ip_address || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
