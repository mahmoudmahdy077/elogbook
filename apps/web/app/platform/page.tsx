import { createServiceRoleClient } from '@/lib/supabase/admin';
import TenantCreateForm from './TenantCreateForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Platform tenant overview (T17, read-only). Metadata management only:
 * listing tenants here grants no clinical access (separate expiring
 * grants per section 4.1). Lifecycle actions (suspend/archive) are T18.
 */
export default async function PlatformHomePage() {
  let tenants: {
    id: string;
    name: string;
    slug: string;
    tenant_type: string;
    status?: string | null;
    created_at: string;
  }[] = [];
  let error: string | null = null;
  try {
    const adminClient = createServiceRoleClient();
    const { data, error: queryError } = await adminClient
      .from('tenants')
      .select('id, name, slug, tenant_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (queryError) error = 'Could not load tenants.';
    else tenants = data ?? [];
  } catch {
    error = 'Could not load tenants.';
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Tenants</h1>
      <p className="text-sm text-text-muted mb-6">
        {tenants.length} tenant(s).
      </p>

      <TenantCreateForm />
      {error && <p className="text-fg-danger text-sm mb-4">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
              <tr className="border-b border-divider text-left text-text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-divider last:border-0">
                <td className="px-4 py-3 text-text-primary">{t.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{t.slug}</td>
                <td className="px-4 py-3">{t.tenant_type}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 rounded-full ${t.status && t.status !== 'active' ? 'bg-warning' : 'bg-success'}`}
                    />
                    {t.status ?? 'active'}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{new Date(t.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {tenants.length === 0 && !error && (
              <tr>
                <td className="px-4 py-6 text-center text-text-muted" colSpan={5}>
                  No tenants found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
