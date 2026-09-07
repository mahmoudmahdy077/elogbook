import { describe, it, expect, vi, beforeEach } from 'vitest';

// T22: theme publication validates against platform ceilings, archives a
// revision for revert, and republishes prior revisions on request.

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
  })),
}));
vi.mock('@/lib/supabase/require-admin', () => ({ requireTenantAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({
  validateOrigin: vi.fn(() => null),
  defaultTrustedOrigins: vi.fn(() => []),
}));

import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { POST } from '../route';

type Guard = Awaited<ReturnType<typeof requireTenantAdmin>>;
const OPERATOR = {
  ok: true as const,
  profile: { id: 'p1', tenant_id: 't1' },
  user: { id: 'u1' },
} as unknown as Guard;
const DENIED = { ok: false as const, error: 'Forbidden', status: 403 as const } as unknown as Guard;

function postReq(body: unknown) {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'content-length': '20' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}
const ctx = { params: Promise.resolve({ tenant: 'demo' }) };

function mockAdmin(opts: {
  existing?: Record<string, unknown>;
  revision?: Record<string, unknown> | null;
  latestVersion?: number | null;
}) {
  const calls = { update: [] as unknown[], insertRevision: [] as unknown[], audit: [] as unknown[] };
  const tenantsSingle = vi.fn(async () => ({ data: { custom_branding: opts.existing ?? {} }, error: null }));
  const tenantsSelectEq = vi.fn(() => ({ single: tenantsSingle }));
  const tenantsUpdateEq = vi.fn(async () => ({ error: null }));
  const tenantsUpdate = vi.fn(() => {
    calls.update.push(true);
    return { eq: tenantsUpdateEq };
  });
  const revSingle = vi.fn(async () => ({ data: opts.revision ?? null, error: null }));
  const revLimit = vi.fn(async () =>
    opts.latestVersion === null || opts.latestVersion === undefined
      ? { data: [], error: null }
      : { data: [{ version: opts.latestVersion }], error: null },
  );
  const revOrder = vi.fn(() => ({ limit: revLimit }));
  let revEqCalls = 0;
  const revEq = vi.fn(() => {
    revEqCalls += 1;
    // select->eq->single (revert lookup) and select->eq->order->limit
    // (latest lookup) share the first eq; serve both continuations.
    return { single: revSingle, order: revOrder, eq: vi.fn(() => ({ single: revSingle })) };
  });
  const revInsertSelect = vi.fn(() => ({
    single: vi.fn(async () => {
      calls.insertRevision.push(true);
      return { data: { id: 'rev-2', version: (opts.latestVersion ?? 0) + 1 }, error: null };
    }),
  }));
  const revInsert = vi.fn(() => {
    return { select: revInsertSelect };
  });
  const auditInsert = vi.fn(async (row: unknown) => {
    calls.audit.push(row);
    return { error: null };
  });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'tenants') return { select: vi.fn(() => ({ eq: tenantsSelectEq })), update: tenantsUpdate };
      if (table === 'tenant_theme_revisions') {
        return { select: vi.fn(() => ({ eq: revEq })), insert: revInsert };
      }
      return { insert: auditInsert };
    }),
  } as never);
  return { calls, tenantsUpdateEq, revEqCalls: () => revEqCalls };
}

describe('POST branding publish (T22)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies non-operators with 403', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(DENIED);
    const res = await POST(postReq({ primary_color: '#007AFF' }), ctx);
    expect(res.status).toBe(403);
  });

  it('blocks low-contrast themes without touching tenants', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(OPERATOR);
    const { calls } = mockAdmin({});
    const res = await POST(postReq({ primary_color: '#EEEEEE' }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/contrast/i);
    expect(calls.update).toEqual([]);
  });

  it('publishes valid themes with revision archive and audit', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(OPERATOR);
    const { calls } = mockAdmin({ existing: {}, latestVersion: 3 });
    const res = await POST(postReq({ primary_color: '#007AFF' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.version).toBe(4);
    expect(body.branding.primary_color).toBe('#007AFF');
    expect(calls.update.length).toBe(1);
    expect(calls.insertRevision.length).toBe(1);
    expect(calls.audit.length).toBe(1);
  });

  it('rejects disallowed keys', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(OPERATOR);
    mockAdmin({});
    const res = await POST(postReq({ primary_color: '#007AFF', custom_css: 'x' }), ctx);
    expect(res.status).toBe(400);
  });

  it('reverts by republishing a prior revision as a new version', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(OPERATOR);
    const { calls } = mockAdmin({
      existing: { primary_color: '#0A84FF' },
      revision: { config: { primary_color: '#007AFF' } },
      latestVersion: 5,
    });
    const res = await POST(postReq({ revert_revision_id: 'rev-1' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branding.primary_color).toBe('#007AFF');
    expect(body.version).toBe(6);
    expect(calls.update.length).toBe(1);
  });

  it('returns 404 for unknown revision ids', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(OPERATOR);
    mockAdmin({ revision: null, latestVersion: null });
    const res = await POST(postReq({ revert_revision_id: 'nope' }), ctx);
    expect(res.status).toBe(404);
  });
});
