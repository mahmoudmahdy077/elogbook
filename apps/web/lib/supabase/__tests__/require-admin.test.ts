import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireTenantAdmin } from '../require-admin';

// T04: the central admin guard must enforce live account status in addition
// to identity, tenant, and role. A deactivated/suspended/pending account
// with a still-valid session must not operate through any admin route.
//
// The guard is a thin wrapper over getSecurityContext, which is what carries the
// AAL2 assertion, so these cases drive that path: a mock without the session API
// now fails closed (see the last case) rather than falling through to a branch
// that checks role and status but never an assurance level.

interface MockOptions {
  userId?: string | null;
  profile?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
  aal?: 'aal1' | 'aal2';
  withSessionApi?: boolean;
  /** 'missing' builds a tenant row with no status key at all. */
  tenantStatus?: 'active' | 'suspended' | 'archived' | 'missing';
}

const TENANT = { id: 'tenant-a', slug: 'tenant-a', status: 'active' };

const BASE_PROFILE = {
  id: 'profile-1',
  tenant_id: 'tenant-a',
  user_id: 'user-1',
  role: 'admin',
  status: 'active',
};

function mockSupabase(options: MockOptions = {}) {
  const {
    userId = 'user-1',
    profile = { ...BASE_PROFILE },
    tenant,
    aal = 'aal2',
    withSessionApi = true,
    tenantStatus = 'active',
  } = options;

  const session = userId
    ? {
        access_token: 'token',
        aal,
        user: { id: userId },
      }
    : null;

  const tenantRow = tenant ?? (
    tenantStatus === 'missing'
      ? { id: 'tenant-a', slug: 'tenant-a' }
      : { ...TENANT, status: tenantStatus }
  );

  function table(name: string, data: unknown) {
    const single = vi.fn(async () => ({
      data,
      error: data ? null : { code: 'PGRST116' },
    }));
    const eq = vi.fn(() => ({ single }));
    return { select: vi.fn(() => ({ eq })) };
  }

  const profiles = table('profiles', profile);
  const tenants = table('tenants', tenantRow);

  const auth: Record<string, unknown> = {
    getUser: vi.fn(async () => ({
      data: { user: userId ? { id: userId } : null },
      error: null,
    })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(async () => ({
        data: { currentLevel: aal },
        error: null,
      })),
    },
  };
  if (withSessionApi) {
    auth.getSession = vi.fn(async () => ({ data: { session }, error: null }));
  }

  return {
    auth,
    from: vi.fn((name: string) => (name === 'profiles' ? profiles : tenants)),
  };
}

describe('requireTenantAdmin status enforcement (T04)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows an active admin in the right tenant', async () => {
    const supabase = mockSupabase();
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(true);
  });

  it.each(['suspended', 'deactivated', 'pending'])(
    'denies a %s account with 403',
    async (status) => {
      const supabase = mockSupabase({ profile: { ...BASE_PROFILE, status } });
      const res = await requireTenantAdmin(supabase as never, 'tenant-a');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(403);
        expect(res.error).toMatch(/not active/i);
      }
    },
  );

  it('denies a NULL status fail-closed', async () => {
    const supabase = mockSupabase({ profile: { ...BASE_PROFILE, status: null } });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('denies a missing status fail-closed', async () => {
    const { status: _dropped, ...noStatus } = BASE_PROFILE;
    void _dropped;
    const supabase = mockSupabase({ profile: noStatus });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('still enforces tenant mismatch and role', async () => {
    const wrongTenant = mockSupabase();
    expect((await requireTenantAdmin(wrongTenant as never, 'tenant-b')).ok).toBe(false);

    const wrongRole = mockSupabase({ profile: { ...BASE_PROFILE, role: 'resident' } });
    const res = await requireTenantAdmin(wrongRole as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('still returns 401 without a session', async () => {
    const supabase = mockSupabase({ userId: null, profile: null });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it.each(['suspended', 'archived'] as const)('denies tenants with status %s', async (tenantStatus) => {
    const supabase = mockSupabase({ tenantStatus });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/tenant is/i);
    }
  });

  it('denies a tenant row with no status field', async () => {
    // The authoritative path reads an absent status as not-active. The removed
    // fallback branch treated it as active, so a tenant row missing the column
    // used to depend on which code path answered.
    const supabase = mockSupabase({ tenantStatus: 'missing' });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/tenant is/i);
    }
  });

  it('denies an admin session that is only at AAL1', async () => {
    // The property the removed fallback branch did not have: the guard is the
    // sole AAL2 gate for the privileged admin RPCs, so the role label alone is
    // never sufficient.
    const supabase = mockSupabase({ aal: 'aal1' });
    const res = await requireTenantAdmin(supabase as never, 'tenant-a');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.error).toMatch(/re-authentication|mfa/i);
    }
  });

  it('fails closed in every environment when the session API is unavailable', async () => {
    for (const nodeEnv of ['production', 'development']) {
      vi.stubEnv('NODE_ENV', nodeEnv);
      const supabase = mockSupabase({ withSessionApi: false });
      const result = await requireTenantAdmin(supabase as never, 'tenant-a');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(500);
      vi.unstubAllEnvs();
    }
  });
});
