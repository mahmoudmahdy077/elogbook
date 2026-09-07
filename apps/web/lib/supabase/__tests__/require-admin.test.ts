import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireTenantAdmin } from '../require-admin';

// T04: the central admin guard must enforce live account status in addition
// to identity, tenant, and role. A deactivated/suspended/pending account
// with a still-valid session must not operate through any admin route.

function mockSupabase(userId: string | null, profile: Record<string, unknown> | null) {
  const single = vi.fn(async () => ({ data: profile, error: null }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    from: vi.fn(() => ({ select })),
  };
}

const BASE_PROFILE = {
  id: 'profile-1',
  tenant_id: 'tenant-a',
  user_id: 'user-1',
  role: 'admin',
  status: 'active',
  tenants: { slug: 'tenant-a' },
};

describe('requireTenantAdmin status enforcement (T04)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows an active admin in the right tenant', async () => {
    const supabase = mockSupabase('user-1', { ...BASE_PROFILE });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(true);
  });

  it.each(['suspended', 'deactivated', 'pending'])(
    'denies a %s account with 403',
    async (status) => {
      const supabase = mockSupabase('user-1', { ...BASE_PROFILE, status });
      const res = await requireTenantAdmin(supabase as never, 'tenant-a');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/not active/i);
      }
    },
  );

  it('denies a NULL status fail-closed', async () => {
    const supabase = mockSupabase('user-1', { ...BASE_PROFILE, status: null });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('denies a missing status fail-closed', async () => {
    const { status: _dropped, ...noStatus } = BASE_PROFILE;
    void _dropped;
    const supabase = mockSupabase('user-1', noStatus);
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('still enforces tenant mismatch and role', async () => {
    const wrongTenant = mockSupabase('user-1', { ...BASE_PROFILE });
    expect((await requireTenantAdmin(wrongTenant as never, 'tenant-b')).ok).toBe(false);

    const wrongRole = mockSupabase('user-1', { ...BASE_PROFILE, role: 'resident' });
    const res = await requireTenantAdmin(wrongRole as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('still returns 401 without a session', async () => {
    const supabase = mockSupabase(null, null);
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });
});
