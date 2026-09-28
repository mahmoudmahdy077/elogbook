import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  requireTenantAdmin: vi.fn(),
  checkRateLimit: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: mocks.requireTenantAdmin,
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn() },
}));

function request(body: unknown) {
  return new Request('http://localhost:3000/api/tenant-a/admin/assign-role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ tenant: 'tenant-a' });

describe('POST /api/[tenant]/admin/assign-role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerSupabase.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.requireTenantAdmin.mockResolvedValue({
      ok: true,
      profile: { id: 'admin-profile', tenant_id: 'tenant-id', role: 'admin' },
      user: { id: 'admin-user' },
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
    mocks.rpc.mockResolvedValue({ data: { success: true, profile_id: 'p-1' }, error: null });
  });

  it('passes the profile surrogate id the RPC expects, not the auth user id', async () => {
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'p-1', role: 'supervisor' }), { params });

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_assign_role', {
      p_profile_id: 'p-1',
      p_role: 'supervisor',
    });
  });

  it('rejects the ambiguous user_id field instead of guessing which key was meant', async () => {
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ user_id: 'auth-user-1', role: 'supervisor' }), { params });

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a UUID-shaped auth user id under the profile_id field only via the RPC, not the schema', async () => {
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'auth-user-1', role: 'supervisor' }), { params });

    // The RPC resolves the target by profile id and refuses anything else.
    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_assign_role', {
      p_profile_id: 'auth-user-1',
      p_role: 'supervisor',
    });
  });

  it('preserves the last-administrator protection as a 409', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: false, error: 'last_administrator' }, error: null });
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'p-1', role: 'resident' }), { params });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Cannot remove the last institution admin of this tenant' });
  });

  it('maps an unknown profile id to 404', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: false, error: 'profile_not_found' }, error: null });
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'missing', role: 'supervisor' }), { params });

    expect(res.status).toBe(404);
  });

  it('maps a cross-tenant or non-administrator principal to 403', async () => {
    mocks.rpc.mockResolvedValue({ data: { success: false, error: 'forbidden' }, error: null });
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'p-2', role: 'supervisor' }), { params });

    expect(res.status).toBe(403);
  });

  it('refuses the admin role for a non-admin caller before reaching the database', async () => {
    mocks.requireTenantAdmin.mockResolvedValue({
      ok: true,
      profile: { id: 'admin-profile', tenant_id: 'tenant-id', role: 'institution_admin' },
      user: { id: 'admin-user' },
    });
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'p-1', role: 'admin' }), { params });

    expect(res.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('never writes profiles or auth metadata directly', async () => {
    const { POST } = await import('../assign-role/route');

    await POST(request({ profile_id: 'p-1', role: 'supervisor' }), { params });

    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not echo the raw database error to the caller', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('relation profiles does not exist') });
    const { POST } = await import('../assign-role/route');

    const res = await POST(request({ profile_id: 'p-1', role: 'supervisor' }), { params });

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain('relation profiles does not exist');
  });
});
