import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this.body = body;
    }
    async json() { return this.body; }
    static json(body: unknown, init?: ResponseInit) { return new MockNextResponse(body, init); }
  }
  return { NextResponse: MockNextResponse };
});

vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => null,
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, retryAfter: 0 });
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: () => mockCheckRateLimit(),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

const { mockFrom, mockRpc, mockSupabase, mockRequireTenantAdmin, mockSetUserBanned } = vi.hoisted(() => {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    mockFrom: from,
    mockRpc: rpc,
    mockSupabase: { from, rpc },
    mockRequireTenantAdmin: vi.fn(),
    mockSetUserBanned: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));
vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));
vi.mock('@/lib/supabase/session-revocation', () => ({
  setUserBanned: mockSetUserBanned,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

import { POST } from '../route';

const params = Promise.resolve({ tenant: 'demo', id: 'target-profile' });

function request(action: 'deactivate' | 'reactivate'): Request {
  return new Request('https://app.elogbook.dev/api/demo/admin/users/target-profile/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.elogbook.dev',
    },
    body: JSON.stringify({ action }),
  });
}

describe('POST /api/[tenant]/admin/users/[id]/action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockRequireTenantAdmin.mockResolvedValue({
      ok: true,
      user: { id: 'admin-user' },
      profile: { id: 'admin-profile', tenant_id: 'tenant-1', role: 'institution_admin' },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'target-profile', user_id: 'target-user', tenant_id: 'tenant-1', status: 'active' },
              error: null,
            }),
          }),
        }),
      }),
    });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    mockSetUserBanned.mockResolvedValue({ ok: true });
  });

  it('bans refresh sessions when deactivating a user', async () => {
    const res = await POST(request('deactivate') as never, { params });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('admin_set_profile_status', {
      p_profile_id: 'target-profile',
      p_status: 'deactivated',
    });
    expect(mockSetUserBanned).toHaveBeenCalledWith('target-user', true);
  });

  it('unbans the auth user when reactivating', async () => {
    const res = await POST(request('reactivate') as never, { params });

    expect(res.status).toBe(200);
    expect(mockSetUserBanned).toHaveBeenCalledWith('target-user', false);
  });

  it('fails closed when the auth ban state cannot be updated', async () => {
    mockSetUserBanned.mockResolvedValueOnce({ ok: false, reason: 'ban_update_failed' });

    const res = await POST(request('deactivate') as never, { params });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/session/i);
  });
});
