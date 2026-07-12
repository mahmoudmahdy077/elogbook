import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/server
// ---------------------------------------------------------------------------
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
  return { NextResponse: MockNextResponse };
});

// ---------------------------------------------------------------------------
// Mock csrf
// ---------------------------------------------------------------------------
const mockValidateOrigin = vi.fn<(request: Request) => unknown>().mockReturnValue(null);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: (request: Request) => mockValidateOrigin(request),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

// ---------------------------------------------------------------------------
// Mock rate-limit
// ---------------------------------------------------------------------------
const mockCheckRateLimit = vi.fn<(key: string) => { allowed: boolean; retryAfter: number }>().mockReturnValue({ allowed: true, retryAfter: 0 });
const mockRateLimitResponse = vi.fn<(retryAfter: number) => { status: number; json(): Promise<{ error: string; retryAfter: number }> }>().mockImplementation(
  (retryAfter: number) => new (class { status = 429; json() { return Promise.resolve({ error: 'Too many requests', retryAfter }); } })(),
);
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: (retryAfter: number) => mockRateLimitResponse(retryAfter),
}));

// ---------------------------------------------------------------------------
// Mock webhooks
// ---------------------------------------------------------------------------
vi.mock('@/lib/webhooks', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mock supabase server
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
  auth: { getUser: vi.fn() },
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));

import { POST } from '../route';

function makePostRequest(url: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      ...headers,
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/[tenant]/approvals/action', () => {
  const params = Promise.resolve({ tenant: 'demo' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateOrigin.mockReturnValue(null);
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });
    // Default profile lookup — supervisor with matching tenant
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  tenant_id: 't-1',
                  role: 'supervisor',
                  tenants: { slug: 'demo' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'case_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'entry-1', tenant_id: 't-1', status: 'pending' },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });
    mockRpc.mockResolvedValue({ error: null });
  });

  it('rejects request when CSRF validation fails', async () => {
    mockValidateOrigin.mockReturnValueOnce(
      { status: 403, json: async () => ({ error: 'Origin not allowed' }) },
    );

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });

  it('rejects request when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 30 });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(429);
  });

  it('rejects unauthenticated request', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('Auth error'),
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects request when caller profile not found', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Profile not found');
  });

  it('rejects request when tenant slug mismatches', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  tenant_id: 't-1',
                  role: 'supervisor',
                  tenants: { slug: 'other-tenant' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const paramsMismatch = Promise.resolve({ tenant: 'demo' });
    const res = await POST(req, { params: paramsMismatch });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Tenant mismatch');
  });

  it('rejects request from user with insufficient role', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  tenant_id: 't-1',
                  role: 'resident',
                  tenants: { slug: 'demo' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Only supervisors and directors');
  });

  it('rejects request with invalid JSON body', async () => {
    const req = new Request('https://app.elogbook.dev/demo/approvals/action', {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      body: 'not-json',
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('rejects request with missing action and entry_id', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {});
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('action and entry_id are required');
  });

  it('rejects request with invalid action value', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'invalid', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('action must be');
  });

  it('rejects request when entry not found', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  tenant_id: 't-1',
                  role: 'supervisor',
                  tenants: { slug: 'demo' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'case_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'nonexistent' });
    const res = await POST(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Entry not found');
  });

  it('rejects request when entry belongs to different tenant', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'p-1',
                  tenant_id: 't-1',
                  role: 'supervisor',
                  tenants: { slug: 'demo' },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'case_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'entry-1', tenant_id: 't-2', status: 'pending' },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Entry does not belong to your tenant');
  });

  it('approves entry successfully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', comment: 'Looks good' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('approve');

    // Verify RPC was called
    expect(mockRpc).toHaveBeenCalledWith('approve_case', {
      p_entry_id: 'entry-1',
      p_supervisor_id: 'u-1',
      p_comment: 'Looks good',
    });
  });

  it('rejects entry successfully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'reject', entry_id: 'entry-1', comment: 'Needs revision' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('reject');

    expect(mockRpc).toHaveBeenCalledWith('reject_case', {
      p_entry_id: 'entry-1',
      p_supervisor_id: 'u-1',
      p_comment: 'Needs revision',
    });
  });

  it('handles rpc failure gracefully', async () => {
    mockRpc.mockResolvedValueOnce({ error: new Error('RPC timeout') });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('RPC timeout');
  });

  it('handles approve with null comment gracefully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('approve_case', {
      p_entry_id: 'entry-1',
      p_supervisor_id: 'u-1',
      p_comment: null,
    });
  });
});
