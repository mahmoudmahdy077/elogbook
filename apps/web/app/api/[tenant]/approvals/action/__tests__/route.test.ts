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
  return {
    NextResponse: MockNextResponse,
    // route handlers register post-response work via after(); run it inline
    // during tests so mocks (webhooks/notifications) can be asserted.
    after: (cb: () => void | Promise<void>) => { void cb(); },
  };
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
// Mock side effects
// ---------------------------------------------------------------------------
const {
  mockDispatchWebhookEvent,
  mockNotifyCaseApproval,
  mockNotificationInsert,
  mockCreateServiceRoleClient,
  mockRpc,
  mockFrom,
  mockSupabase,
  mockGetSecurityContext,
} = vi.hoisted(() => {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    mockDispatchWebhookEvent: vi.fn().mockResolvedValue([]),
    mockNotifyCaseApproval: vi.fn().mockResolvedValue(undefined),
    mockNotificationInsert: vi.fn(),
    mockCreateServiceRoleClient: vi.fn(),
    mockRpc: rpc,
    mockFrom: from,
    mockSupabase: { from, rpc, auth: { getUser: vi.fn() } },
    mockGetSecurityContext: vi.fn(),
  };
});

vi.mock('@/lib/webhooks', () => ({
  dispatchWebhookEvent: mockDispatchWebhookEvent,
}));

vi.mock('@/lib/notifications', () => ({
  notifyCaseApproval: mockNotifyCaseApproval,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: mockCreateServiceRoleClient,
}));

// ---------------------------------------------------------------------------
// Mock supabase server and Task 5 security context
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: mockGetSecurityContext,
}));

import { POST } from '../route';

function makePostRequest(url: string, headers: Record<string, string> = {}, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      Origin: 'https://app.elogbook.dev',
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
    // Default resident profile lookup for notification ownership
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'resident-profile-1',
                  user_id: 'resident-user-1',
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
      if (table === 'case_entries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'entry-1', tenant_id: 't-1', resident_id: 'resident-profile-1', status: 'pending' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'notifications') {
        return { insert: mockNotificationInsert };
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });
    mockRpc.mockResolvedValue({ data: { success: true }, error: null });
    mockNotificationInsert.mockReturnValue({ error: null });
    mockGetSecurityContext.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: {
          id: 'p-1',
          tenant_id: 't-1',
          role: 'supervisor',
          status: 'active',
          full_name: 'Dr Reviewer',
        },
        tenant: { id: 't-1', slug: 'demo', status: 'active' },
        aal: 'aal2',
      },
    });
    mockCreateServiceRoleClient.mockReturnValue({
      auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: null } }) } },
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }),
    });
  });

  it('rejects request when CSRF validation fails', async () => {
    mockValidateOrigin.mockReturnValueOnce(
      { status: 403, json: async () => ({ error: 'Origin not allowed' }) },
    );

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });

  it('rejects request when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 30 });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(429);
  });

  it('rejects unauthenticated request', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: false,
      reason: 'unauthenticated',
      status: 401,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects request when caller profile not found', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: false,
      reason: 'profile_not_found',
      status: 403,
    });
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

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Profile not found');
  });

  it('rejects request when tenant slug mismatches', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'supervisor', status: 'active', full_name: 'Dr Reviewer' },
        tenant: { id: 't-1', slug: 'other-tenant', status: 'active' },
        aal: 'aal2',
      },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'resident-profile-1',
                  user_id: 'resident-user-1',
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

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const paramsMismatch = Promise.resolve({ tenant: 'demo' });
    const res = await POST(req, { params: paramsMismatch });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Tenant mismatch');
  });

  it('rejects request from user with insufficient role', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'resident', status: 'active', full_name: 'Resident' },
        tenant: { id: 't-1', slug: 'demo', status: 'active' },
        aal: 'aal2',
      },
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'resident-profile-1',
                  user_id: 'resident-user-1',
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

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
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
    expect(body.error).toBe('Invalid request body');
  });

  it('rejects request with missing action and entry_id', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {});
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
  });

  it('rejects request with invalid action value', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'invalid', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
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

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'nonexistent', request_id: 'req-1' });
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

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Entry does not belong to your tenant');
  });

  it('rejects an AAL1 caller before invoking the approval RPC or side effects', async () => {
    mockGetSecurityContext.mockResolvedValueOnce({
      ok: false,
      reason: 'aal2_required',
      status: 403,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockNotificationInsert).not.toHaveBeenCalled();
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
    expect(mockNotifyCaseApproval).not.toHaveBeenCalled();
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
  });

  it('treats a stale approval-domain RPC result as failure without side effects', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: false, error: 'Case already reviewed', code: 'already_reviewed' },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).not.toBe(200);
    expect((await res.json()).success).not.toBe(true);
    expect(mockNotificationInsert).not.toHaveBeenCalled();
    expect(mockDispatchWebhookEvent).not.toHaveBeenCalled();
    expect(mockNotifyCaseApproval).not.toHaveBeenCalled();
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled();
  });

  it('approves entry successfully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1', comment: 'Looks good' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('approve');

    expect(mockRpc).toHaveBeenCalledWith('decide_case_command', {
      p_case_id: 'entry-1',
      p_request_id: 'req-1',
      p_decision: 'approve',
      p_reason: 'Looks good',
    });
  });

  it('rejects entry successfully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'reject', entry_id: 'entry-1', request_id: 'req-1', comment: 'Needs revision' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('reject');

    expect(mockRpc).toHaveBeenCalledWith('decide_case_command', {
      p_case_id: 'entry-1',
      p_request_id: 'req-1',
      p_decision: 'reject',
      p_reason: 'Needs revision',
    });
  });

  it('handles rpc failure gracefully without leaking the raw provider error', async () => {
    mockRpc.mockResolvedValueOnce({ error: new Error('connection to db.internal:5432 refused') });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).not.toContain('db.internal');
    expect(body.error).not.toContain('5432');
  });

  it('handles approve with null comment gracefully', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1', request_id: 'req-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('decide_case_command', {
      p_case_id: 'entry-1',
      p_request_id: 'req-1',
      p_decision: 'approve',
      p_reason: null,
    });
  });

  it('decides through the AAL2-gated decide_case_command RPC', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {
      action: 'reject',
      entry_id: 'entry-1',
      request_id: 'req-1',
      comment: 'Needs revision',
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('decide_case_command', {
      p_case_id: 'entry-1',
      p_request_id: 'req-1',
      p_decision: 'reject',
      p_reason: 'Needs revision',
    });
  });

  it('never calls the legacy approve_case or reject_case RPCs', async () => {
    await POST(
      makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {
        action: 'approve',
        entry_id: 'entry-1',
        request_id: 'req-1',
      }),
      { params },
    );

    const calledRpcs = mockRpc.mock.calls.map((call) => call[0]);
    expect(calledRpcs).not.toContain('approve_case');
    expect(calledRpcs).not.toContain('reject_case');
  });

  it('rejects a decision without a request_id so a retry cannot double-apply', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, { action: 'approve', entry_id: 'entry-1' });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('replays the stored decision when the same request_id is retried', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { success: true, case_id: 'entry-1', approval_id: 'ap-1', status: 'approved' },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {
      action: 'approve',
      entry_id: 'entry-1',
      request_id: 'req-1',
    });
    const res = await POST(req, { params });

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('maps authoritative lifecycle denials to stable 403 codes', async () => {
    for (const code of ['account_inactive', 'tenant_suspended']) {
      mockRpc.mockResolvedValueOnce({ data: { success: false, code }, error: null });
      const res = await POST(
        makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {
          action: 'approve',
          entry_id: 'entry-1',
          request_id: `req-${code}`,
        }),
        { params },
      );

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe(code);
      expect(mockNotificationInsert).not.toHaveBeenCalled();
    }
  });

  it('persists the approval notification for the resident auth user without copying feedback text', async () => {
    const res = await POST(
      makePostRequest('https://app.elogbook.dev/demo/approvals/action', {}, {
        action: 'reject',
        entry_id: 'entry-1',
        request_id: 'req-notification',
        comment: 'Sensitive reviewer feedback',
      }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(mockNotificationInsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 't-1',
      user_id: 'resident-user-1',
      body: 'Your case was rejected. Open the case to review the decision.',
    }));
    expect(JSON.stringify(mockNotificationInsert.mock.calls)).not.toContain('Sensitive reviewer feedback');
  });
});
