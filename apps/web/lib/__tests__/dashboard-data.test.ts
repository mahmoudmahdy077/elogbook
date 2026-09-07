import { describe, it, expect, vi, beforeEach } from 'vitest';

// T26: layout and page share one get_dashboard_data entry point wrapped in
// React cache(), which memoizes per request inside the Flight runtime.
// Framework fact (verified against installed react 19.2.8 sources): bare
// cache() is a pass-through OUTSIDE Flight, so RPC-count assertions in a
// unit test would prove nothing — they are deliberately absent. These
// tests pin the behavioral contract; the 2→1 RPC proof belongs to
// request-level runs (Playwright/rest counting, T26-full).
describe('getDashboardData contract (T26)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadWithRpc(rpc: (args: unknown) => Promise<unknown>) {
    vi.doMock('@/lib/supabase/server', () => ({
      createServerSupabase: vi.fn(async () => ({ rpc })),
    }));
    return (await import('../dashboard-data')).getDashboardData;
  }

  it('returns data and forwards all three arguments to the RPC', async () => {
    const rpc = vi.fn(async () => ({ data: { pending_approvals: 3 }, error: null }));
    const getDashboardData = await loadWithRpc(rpc);
    const res = await getDashboardData('t-1', 'r-1', 'resident');
    expect(res).toEqual({ data: { pending_approvals: 3 }, error: null });
    expect(rpc).toHaveBeenCalledWith('get_dashboard_data', {
      p_tenant_id: 't-1',
      p_resident_id: 'r-1',
      p_role: 'resident',
    });
  });

  it('surfaces RPC errors without throwing (callers keep their handling)', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'db down' } }));
    const getDashboardData = await loadWithRpc(rpc);
    const res = await getDashboardData('t-1', 'r-1', 'resident');
    expect(res.error).toMatchObject({ message: 'db down' });
    expect(res.data).toBeNull();
  });
});
