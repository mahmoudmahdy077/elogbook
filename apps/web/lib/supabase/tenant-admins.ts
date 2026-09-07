/**
 * Tenant last-admin protection (T18).
 *
 * A tenant must never lose its last `institution_admin` through a role
 * change or deletion: an admin-less tenant cannot be administered back to
 * health except by platform intervention. Fails closed with 409 conflict.
 * Platform `admin` holders are not counted: they operate above tenants.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function assertNotLastTenantAdmin(
  adminClient: SupabaseClient,
  args: { tenantId: string; profileId: string; currentRole: string; newRole?: string },
): Promise<{ ok: true } | { ok: false; error: string; status: 409 }> {
  // Not an admin removal: no-op retention or non-admin transitions.
  if (args.currentRole !== 'institution_admin') return { ok: true };
  if (args.newRole !== undefined && args.newRole === 'institution_admin') return { ok: true };

  const { data, error } = await adminClient
    .from('profiles')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('role', 'institution_admin');

  if (error) {
    return { ok: false, error: 'Could not verify tenant administrators', status: 409 };
  }
  const others = ((data ?? []) as { id: string }[]).filter((p) => p.id !== args.profileId);
  if (others.length === 0) {
    return {
      ok: false,
      error: 'Cannot remove the last institution admin of this tenant',
      status: 409,
    };
  }
  return { ok: true };
}
