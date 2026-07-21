import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import AuditExportUI from '@/components/AuditExportUI';

const PAGE_SIZE = 20;

const ACTION_TYPES = [
  { value: '', label: 'All Actions' },
  { value: 'create', label: 'Create' },
  { value: 'update', label: 'Update' },
  { value: 'delete', label: 'Delete' },
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'login', label: 'Login' },
  { value: 'sso_start', label: 'SSO start' },
  { value: 'audit_export', label: 'Audit export' },
  { value: 'data_retention_update', label: 'Retention update' },
];

const RESOURCE_TYPES = [
  { value: '', label: 'All Tables' },
  { value: 'case_entries', label: 'Case entries' },
  { value: 'profiles', label: 'Profiles' },
  { value: 'tenants', label: 'Tenants' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'consent_records', label: 'Consent records' },
  { value: 'audit', label: 'Audit' },
  { value: 'auth', label: 'Auth' },
];

const SUSPICIOUS_ACTIONS = [
  'login_failed',
  'role_change',
  'cross_tenant_access',
  'bulk_export',
  'audit_export',
  'sso_start',
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

function isSuspicious(action: string): boolean {
  return SUSPICIOUS_ACTIONS.includes(action);
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{
    page?: string;
    date_from?: string;
    date_to?: string;
    action_type?: string;
    resource_type?: string;
    user_id?: string;
    view?: 'all' | 'suspicious';
    export?: 'csv' | 'json';
  }>;
}) {
  const { tenant: tenantSlug } = await params;
  const sp = await searchParams;
  const { page: pageStr, date_from, date_to, action_type, resource_type, user_id, view, export: exportFormat } = sp;
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
  } else if (view === 'suspicious') {
    query = query.in('action', SUSPICIOUS_ACTIONS);
  }
  if (resource_type) {
    query = query.eq('resource_type', resource_type);
  }
  if (user_id) {
    query = query.eq('user_id', user_id);
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
        <ErrorDisplay message={error.message} />
      </div>
    );
  }

  // Legacy export URL redirect — forward to the API route.
  if (exportFormat === 'csv' || exportFormat === 'json') {
    const apiParams = new URLSearchParams({
      format: exportFormat === 'json' ? 'csv' : exportFormat,
      ...(date_from ? { startDate: date_from } : {}),
      ...(date_to ? { endDate: date_to } : {}),
    });
    redirect(`/api/${tenantSlug}/audit/export?${apiParams.toString()}`);
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
  if (resource_type) filterParams.set('resource_type', resource_type);
  if (user_id) filterParams.set('user_id', user_id);
  if (view) filterParams.set('view', view);
  const filterSuffix = filterParams.toString() ? `&${filterParams.toString()}` : '';
  const filterQuery = filterParams.toString() ? `?${filterParams.toString()}` : '';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit Trail</h1>

      <div className="flex gap-2 mb-4">
        <Link
          href={`/${tenantSlug}/audit${filterQuery}`}
          className={'px-3 py-1.5 rounded-md text-sm ' + (view !== 'suspicious' ? 'bg-primary/15 text-primary' : 'border border-border text-text-muted/60')}
        >
          All events
        </Link>
        <Link
          href={`/${tenantSlug}/audit?view=suspicious${filterSuffix.replace(/^&/, '&')}`}
          className={'px-3 py-1.5 rounded-md text-sm ' + (view === 'suspicious' ? 'bg-primary/15 text-primary' : 'border border-border text-text-muted/60')}
        >
          Suspicious activity
        </Link>
      </div>

      <form className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label htmlFor="date_from" className="block text-sm font-medium mb-1">From</label>
          <input id="date_from" type="date" name="date_from" defaultValue={date_from || ''} className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
        </div>
        <div>
          <label htmlFor="date_to" className="block text-sm font-medium mb-1">To</label>
          <input id="date_to" type="date" name="date_to" defaultValue={date_to || ''} className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
        </div>
        <div>
          <label htmlFor="action_type" className="block text-sm font-medium mb-1">Action</label>
          <select id="action_type" name="action_type" defaultValue={action_type || ''} className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm">
            {ACTION_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="resource_type" className="block text-sm font-medium mb-1">Table</label>
          <select id="resource_type" name="resource_type" defaultValue={resource_type || ''} className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm">
            {RESOURCE_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="user_id" className="block text-sm font-medium mb-1">User UUID</label>
          <input id="user_id" type="text" name="user_id" defaultValue={user_id || ''} placeholder="uuid" className="px-3 py-2 rounded-lg bg-neutral-dark border border-border text-sm" />
        </div>
        {view && <input type="hidden" name="view" value={view} />}
        <button
          type="submit"
          className="inline-flex items-center rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
        >
          Filter
        </button>
        <div className="ml-auto">
          <AuditExportUI
            tenantSlug={tenantSlug}
            dateFrom={date_from || ''}
            dateTo={date_to || ''}
          />
        </div>
      </form>

      {(!logs || logs.length === 0) ? (
        <p className="text-text-muted">No audit entries found.</p>
      ) : (
        <div className="panel p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Audit logs table">
              <thead>
                <tr className="border-b border-divider text-left">
                  <th className="pb-3 font-semibold text-text-muted">Date</th>
                  <th className="pb-3 font-semibold text-text-muted">Action</th>
                  <th className="pb-3 font-semibold text-text-muted">Resource</th>
                  <th className="pb-3 font-semibold text-text-muted">User</th>
                  <th className="pb-3 font-semibold text-text-muted">IP</th>
                  <th className="pb-3 font-semibold text-text-muted">Flag</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: AuditLogRow) => (
                  <tr key={log.id} className="border-b border-divider">
                    <td className="py-2.5 clinical-data">{new Date(log.created_at).toLocaleString()}</td>
                    <td className="py-2.5">{log.action}</td>
                    <td className="py-2.5 clinical-data">{log.resource_type} / {formatUUID(log.resource_id)}</td>
                    <td className="py-2.5 clinical-data">{formatUUID(log.user_id)}</td>
                    <td className="py-2.5">{log.ip_address || '—'}</td>
                    <td className="py-2.5">
                      {isSuspicious(log.action) && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-danger/20 text-danger">suspicious</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider">
              <p className="text-sm text-text-muted">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/${tenantSlug}/audit?page=${page - 1}${filterSuffix}`}
                    className="inline-flex items-center rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/${tenantSlug}/audit?page=${page + 1}${filterSuffix}`}
                    className="inline-flex items-center rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    Next Page
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
