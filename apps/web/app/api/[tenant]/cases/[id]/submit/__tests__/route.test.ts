import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly _body: unknown;
    readonly headers: Headers;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = new Headers(init?.headers);
    }
    async json() { return this._body; }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse, after: (cb: () => void | Promise<void>) => { void cb(); } };
});

const mockValidateOrigin = vi.fn<(request: Request) => unknown>().mockReturnValue(null);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: (request: Request) => mockValidateOrigin(request),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

const mockCheckRateLimit = vi
  .fn<(key: string) => { allowed: boolean; retryAfter: number }>()
  .mockReturnValue({ allowed: true, retryAfter: 0 });
const mockRateLimitResponse = vi
  .fn<(retryAfter: number) => { status: number; json(): Promise<unknown> }>()
  .mockImplementation(
    (retryAfter: number) =>
      new (class { status = 429; json() { return Promise.resolve({ error: 'Too many requests', retryAfter }); } })(),
  );
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: (retryAfter: number) => mockRateLimitResponse(retryAfter),
}));

const { mockRpc, mockFrom, mockSupabase, mockGetSecurityContext } = vi.hoisted(() => {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    mockRpc: rpc,
    mockFrom: from,
    mockSupabase: { from, rpc, auth: { getUser: vi.fn() } },
    mockGetSecurityContext: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: mockGetSecurityContext,
}));

import { POST } from '../route';

function makePostRequest(body: unknown, url = 'https://app.elogbook.dev/demo/cases/case-1/submit'): Request {
  return new Request(url, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      Origin: 'https://app.elogbook.dev',
    }),
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ tenant: 'demo', id: 'case-1' });

describe('POST /api/[tenant]/cases/[id]/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateOrigin.mockReturnValue(null);
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
    mockRpc.mockResolvedValue({
      data: { success: true, case_id: 'case-1', status: 'pending' },
      error: null,
    });
    mockGetSecurityContext.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'resident', status: 'active', full_name: 'Resident' },
        tenant: { id: 't-1', slug: 'demo', status: 'active' },
        aal: 'aal1',
      },
    });
  });

  it('submits through the submit_case_command RPC', async () => {
    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, case_id: 'case-1', status: 'pending' });
    expect(mockRpc).toHaveBeenCalledWith('submit_case_command', {
      p_case_id: 'case-1',
      p_request_id: 'req-1',
      p_expected_status: null,
    });
  });

  it('does not perform a direct case_entries update', async () => {
    await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('forwards the expected status for optimistic concurrency', async () => {
    await POST(makePostRequest({ request_id: 'req-1', expected_status: 'rejected' }), { params });

    expect(mockRpc).toHaveBeenCalledWith('submit_case_command', {
      p_case_id: 'case-1',
      p_request_id: 'req-1',
      p_expected_status: 'rejected',
    });
  });

  it('rejects a request without a request_id so retries cannot duplicate a case', async () => {
    const res = await POST(makePostRequest({}), { params });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a request with a blank request_id', async () => {
    const res = await POST(makePostRequest({ request_id: '   ' }), { params });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects an unexpected_status value', async () => {
    const res = await POST(makePostRequest({ request_id: 'req-1', expected_status: 'approved' }), { params });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns the stored result unchanged when the same request_id is replayed', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, case_id: 'case-1', status: 'pending', reviewers: ['p-9'] },
      error: null,
    });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.case_id).toBe('case-1');
  });

  it('fails closed with an actionable 403 when no eligible reviewer exists', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, error: 'no_eligible_reviewer', code: 'forbidden', current_status: 'draft' },
      error: null,
    });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('no_eligible_reviewer');
    // Actionable: the resident is told what is missing and who to ask.
    expect(body.error).toMatch(/supervisor or director/i);
    expect(body.error).toMatch(/administrator/i);
  });

  it('maps a cross-tenant or non-owner case to 403', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error: 'forbidden', code: 'forbidden' }, error: null });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(403);
  });

  it('maps a missing case to 404', async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error: 'not_found', code: 'not_found' }, error: null });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(404);
  });

  it('maps an already-pending case to 409', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, error: 'state_conflict', code: 'state_conflict', current_status: 'pending' },
      error: null,
    });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(409);
  });

  it('maps a reused request key with different input to 409', async () => {
    mockRpc.mockResolvedValue({
      data: { success: false, error: 'request key reused with different input', code: 'idempotency_conflict' },
      error: null,
    });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(409);
  });

  it('rejects an unauthenticated caller before invoking the command', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({ ok: false, reason: 'unauthenticated', status: 401 });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a tenant slug mismatch before invoking the command', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'resident', status: 'active', full_name: 'Resident' },
        tenant: { id: 't-1', slug: 'other-tenant', status: 'active' },
        aal: 'aal1',
      },
    });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects when CSRF validation fails', async () => {
    mockValidateOrigin.mockReturnValueOnce({ status: 403, json: async () => ({ error: 'Origin not allowed' }) });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 30 });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(429);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a command transport failure to 500 without leaking the raw error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('connection to 10.0.0.5 refused') });

    const res = await POST(makePostRequest({ request_id: 'req-1' }), { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain('10.0.0.5');
  });
});
