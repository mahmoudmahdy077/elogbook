import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { Table, Button, Select } from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

const PAGE_SIZE = 20;

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'login', label: 'Login' },
];

interface AuditLogRow {
  id: string;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  user_id: string | null;
  ip_address: string | null;
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ page?: string; date_from?: string; date_to?: string; action_type?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { page: pageStr, date_from, date_to, action_type } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const allowedRoles: UserRole[] = ['director', 'institution_admin', 'admin'];
  if (!allowedRoles.includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const supabase = await createServerSupabase();
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .eq('tenant_id', auth.profile.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (action_type) {
    query = query.eq('action', action_type);
  }
  if (date_from) {
    query = query.gte('created_at', date_from);
  }
  if (date_to) {
    query = query.lte('created_at', date_to);
  }

  const { data: logs, error, count } = await query;

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>
        <p className="text-danger">Failed to load audit logs: {error.message}</p>
      </div>
    );
  }

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  const formatUUID = (id: string | null) => {
    if (!id) return '—';
    return id.slice(-8);
  };

  const filterParams = new URLSearchParams();
  if (date_from) filterParams.set('date_from', date_from);
  if (date_to) filterParams.set('date_to', date_to);
  if (action_type) filterParams.set('action_type', action_type);
  const filterSuffix = filterParams.toString() ? `&${filterParams.toString()}` : '';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>

      <form className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label htmlFor="date_from" className="block text-sm font-medium mb-1">From</label>
          <input
            id="date_from"
            type="date"
            name="date_from"
            defaultValue={date_from || ''}
            className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm"
          />
        </div>
        <div>
          <label htmlFor="date_to" className="block text-sm font-medium mb-1">To</label>
          <input
            id="date_to"
            type="date"
            name="date_to"
            defaultValue={date_to || ''}
            className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm"
          />
        </div>
        <div>
          <label htmlFor="action_type" className="block text-sm font-medium mb-1">Action</label>
          <select
            id="action_type"
            name="action_type"
            defaultValue={action_type || ''}
            className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm"
          >
            {ACTION_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="ghost" size="sm">Filter</Button>
      </form>

      {(!logs || logs.length === 0) ? (
        <p className="text-default-500">No audit entries found.</p>
      ) : (
        <div className="panel p-4">
        <Table.Root aria-label="Audit logs table" variant="primary">
          <Table.Content>
          <Table.Header>
            <Table.Column id="date">Date</Table.Column>
            <Table.Column id="action">Action</Table.Column>
            <Table.Column id="resource">Resource</Table.Column>
            <Table.Column id="user">User</Table.Column>
            <Table.Column id="ip">IP</Table.Column>
          </Table.Header>
          <Table.Body>
            {logs.map((log: AuditLogRow) => (
              <Table.Row key={log.id} id={log.id}>
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
          </Table.Content>
        </Table.Root>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider">
            <p className="text-sm text-default-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/${tenantSlug}/audit?page=${page - 1}${filterSuffix}`}>
                  <Button variant="ghost" size="sm">Previous</Button>
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/${tenantSlug}/audit?page=${page + 1}${filterSuffix}`}>
                  <Button variant="primary" size="sm">Next Page</Button>
                </Link>
              )}
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}