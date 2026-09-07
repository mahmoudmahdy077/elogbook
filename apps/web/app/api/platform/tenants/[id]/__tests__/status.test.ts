import { describe, it, expect, vi, beforeEach } from 'vitest';

// T18: platform tenant lifecycle. Suspension is audited, concurrency-
// guarded, and limited to platform operators.

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/require-platform-admin', () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));

import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { POST } from '../status/route';

type GuardResult = Awaited<ReturnType<typeof requirePlatformAdmin>>;
const OPERATOR = { ok: true as const, user: { id: 'u1' } } as unknown as GuardResult;
const DENIED = { ok: false as const, error: 'Platform access required', status: 403 as const } as unknown as GuardResult;

function postReq(id: string, body: unknown) {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const TENANT = { id: 't1', slug: 'demo', status: 'active', updated_at: '2026-09-01T00:00:00.000Z' };

function mockAdmin(current = TENANT) {
  const single = vi.fn(async () => ({ data: { ...current }, error: null }));
  const updateEq = vi.fn(async () => ({ data: [{ ...current, status: 'suspended' }], error: null }));
  const selectEq = vi.fn(() => ({ single }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const insert = vi.fn(async () => ({ error: null }));
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'audit_logs') return { insert };
      return { select: vi.fn(() => ({ eq: selectEq })), update };
    }),
  } as never);
  return { single, selectEq, update, updateEq, insert };
}

describe('POST /api/platform/tenants/[id]/status (T18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies non-operators with 403', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(DENIED);
    const res = await POST(postReq('t1', { status: 'suspended' }), ctx('t1'));
    expect(res.status).toBe(403);
  });

  it('rejects unknown statuses with 400', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin();
    const res = await POST(postReq('t1', { status: 'deleted' }), ctx('t1'));
    expect(res.status).toBe(400);
  });

  it('suspends with audit and returns the new status', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    const { insert } = mockAdmin();
    const res = await POST(postReq('t1', { status: 'suspended', reason: 'nonpayment' }), ctx('t1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('suspended');
    expect(insert).toHaveBeenCalledOnce();
    const auditRow = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(auditRow).toMatchObject({ tenant_id: 't1', action: 'tenant_status_change' });
  });

  it('returns 404 for unknown tenants', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) })),
      })),
    } as never);
    const res = await POST(postReq('nope', { status: 'suspended' }), ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('returns 409 on stale edits (optimistic concurrency)', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin();
    const res = await POST(
      postReq('t1', { status: 'archived', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }),
      ctx('t1'),
    );
    expect(res.status).toBe(409);
  });
});
