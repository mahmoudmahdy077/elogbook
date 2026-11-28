import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal NextResponse shim (Vitest cannot load Next internals).
vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this.body = body;
    }
    async json() {
      return this.body;
    }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

const upsert = vi.fn(() => ({
  select: () => ({
    single: async () => ({ data: { tenant_id: 't1' }, error: null }),
  }),
}));
const auditInsert = vi.fn(async () => ({ error: null }));
const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
const tokenQuery = {
  eq: () => tokenQuery,
  limit: async () => ({ data: [], error: null }),
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: async () => ({
    ok: true,
    profile: { id: 'p1', tenant_id: 't1', role: 'director' },
    user: { id: 'u1' },
  }),
}));

vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => null,
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfter: 0 }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'mobile_app_config') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle }),
          }),
          upsert,
        };
      }
      if (table === 'audit_logs') return { insert: auditInsert };
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { settings: {} }, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { select: () => tokenQuery };
    },
  }),
}));

import { POST } from '../route';

function request(body: unknown): Request {
  return new Request('https://app.elogbook.dev/api/demo/admin/mobile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'https://app.elogbook.dev' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ tenant: 'demo' });

describe('POST /api/[tenant]/admin/mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unknown module key', async () => {
    const res = await POST(
      request({ action: 'save', config: { enabled_features: { not_a_module: false } } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed minimum version', async () => {
    const res = await POST(
      request({ action: 'save', config: { min_app_version: 'v1' } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a forced update without a minimum version', async () => {
    const res = await POST(
      request({ action: 'save', config: { force_update: true } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-https update link', async () => {
    const res = await POST(
      request({ action: 'save', config: { update_url: 'http://example.com/app' } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range daily case goal', async () => {
    const res = await POST(
      request({ action: 'save', config: { daily_case_goal: 500 } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('saves valid controls and audits the change', async () => {
    const res = await POST(
      request({
        action: 'save',
        config: {
          enabled_features: { approvals: false },
          maintenance_mode: true,
          maintenance_message: 'Tonight',
          min_app_version: '1.2.0',
          force_update: true,
          update_url: 'https://apps.example.com/app',
          announcement: { title: 'Notice', body: 'Body', severity: 'info' },
        },
      }),
      { params },
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const record = (upsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(record).toMatchObject({
      tenant_id: 't1',
      maintenance_mode: true,
      min_app_version: '1.2.0',
      force_update: true,
    });
  });
});
