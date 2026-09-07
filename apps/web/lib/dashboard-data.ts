import { cache } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Shared dashboard RPC entry point (T26).
 *
 * The tenant layout (pending-approval badge) and the dashboard page issue
 * the identical get_dashboard_data call on every load. Both go through
 * this React cache() wrapper, which memoizes per request inside the
 * Flight runtime (verified: bare cache() outside Flight is a
 * pass-through — no unit test can honestly assert the dedupe; the
 * RPC-count proof belongs to request-level runs in T26-full).
 * Returns the raw {data, error} shape so callers keep their own
 * tolerance (layout ignores errors; page throws).
 */
export interface DashboardData {
  pending_approvals?: number;
  stats?: unknown;
  recent_cases?: unknown[];
  total_residents?: number;
  [key: string]: unknown;
}

async function fetchDashboardData(
  tenantId: string,
  residentId: string,
  role: string,
): Promise<{ data: DashboardData | null; error: { message: string } | null }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('get_dashboard_data', {
    p_tenant_id: tenantId,
    p_resident_id: residentId,
    p_role: role,
  });
  return { data: data as DashboardData | null, error: error as { message: string } | null };
}

export const getDashboardData = cache(fetchDashboardData);
