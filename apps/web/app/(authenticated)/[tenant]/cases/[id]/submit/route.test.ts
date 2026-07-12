import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabaseClient, setTableData, resetMockData } from '../../../../../../lib/__tests__/helpers/supabase-mock';

const mockSupabase = createMockSupabaseClient();

// ---------------------------------------------------------------------------
// Mock next/server – Vitest runs in Node and cannot resolve the Next.js
// internals.  We provide a minimal NextResponse shim that satisfies the
// interface used by route.ts.
// ---------------------------------------------------------------------------
vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly _body: unknown;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async json() { return this._body; }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

// ---------------------------------------------------------------------------
// Mock @sentry/nextjs – route.ts wraps the handler in Sentry.startSpan.
// We provide a simple pass-through that calls the callback immediately.
// ---------------------------------------------------------------------------
vi.mock('@sentry/nextjs', () => ({
  startSpan: (_ctx: unknown, fn: (span: unknown) => unknown) => fn({ setAttribute: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/csrf – the CSRF logic is already covered by csrf.test.ts.
// Here we default to passing (null = no error) so tests that exercise
// auth / ownership logic don't need to supply Origin headers. The two
// CSRF-specific tests override this mock inline.
// ---------------------------------------------------------------------------
const mockValidateOrigin = vi.fn<(request: Request, trustedOrigins?: string[]) => unknown>().mockReturnValue(null);

vi.mock('@/lib/csrf', () => ({
  validateOrigin: (request: Request, trustedOrigins?: string[]) => mockValidateOrigin(request, trustedOrigins),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

// ---------------------------------------------------------------------------
// Mock @/lib/rate-limit – allow all requests by default; individual tests
// can override to simulate rate-limit hits.
// ---------------------------------------------------------------------------
const mockCheckRateLimit = vi.fn<(key: string) => { allowed: boolean; retryAfter: number }>().mockReturnValue({ allowed: true, retryAfter: 0 });
const mockRateLimitResponse = vi.fn<(retryAfter: number) => { status: number; json(): Promise<{ error: string; retryAfter: number }> }>().mockImplementation((retryAfter: number) =>
  new (class { status = 429; json() { return Promise.resolve({ error: 'Too many requests', retryAfter }); } })()
);

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: (retryAfter: number) => mockRateLimitResponse(retryAfter),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/webhooks – the route fires a best-effort webhook event after
// successful submission; make it a no-op in tests so module resolution does
// not fail.
// ---------------------------------------------------------------------------
vi.mock('@/lib/webhooks', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfter: 0 }),
  rateLimitResponse: vi.fn().mockReturnValue(new Response(null, { status: 429 })),
}));

import { POST } from './route';

function makePostRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: new Headers(headers),
  });
}

describe('POST /api/[tenant]/cases/[id]/submit', () => {
  beforeEach(() => {
    resetMockData();
    vi.clearAllMocks();
    // Default: CSRF passes (null = no error response)
    mockValidateOrigin.mockReturnValue(null);
  });

  it('rejects request without origin or referer (CSRF check)', async () => {
    // Simulate the real csrf.ts returning a 403 when no Origin header is present
    mockValidateOrigin.mockReturnValueOnce(
      { status: 403, json: async () => ({ error: 'Origin required' }) }
    );
    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit');
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin required');
  });

  it('rejects request with mismatched origin (CSRF check)', async () => {
    // Simulate the real csrf.ts returning a 403 for an untrusted origin
    mockValidateOrigin.mockReturnValueOnce(
      { status: 403, json: async () => ({ error: 'Origin not allowed' }) }
    );
    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://evil.com',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin not allowed');
  });

  it('rejects request when user is unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('Auth error') });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
  });

  it('rejects if the case entry is not found', async () => {
    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(404);
  });

  it('rejects if the case is not in draft status', async () => {
    setTableData('case_entries', [
      { id: 'c-123', tenant_id: 't-1', resident_id: 'p-1', status: 'pending' },
    ]);
    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('only submit drafts');
  });

  it('rejects if the resident does not own the case', async () => {
    setTableData('case_entries', [
      { id: 'c-123', tenant_id: 't-1', resident_id: 'other-resident', status: 'draft' },
    ]);
    setTableData('profiles', [
      { id: 'p-1', user_id: 'u-1', role: 'resident' },
    ]);
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('only submit your own draft');
  });

  it('submits successfully for owner resident (and creates pending approvals)', async () => {
    setTableData('case_entries', [
      { id: 'c-123', tenant_id: 't-1', resident_id: 'p-1', status: 'draft' },
    ]);
    setTableData('profiles', [
      { id: 'p-1', user_id: 'u-1', role: 'resident', tenant_id: 't-1' },
      { id: 'sup-1', role: 'supervisor', tenant_id: 't-1' },
    ]);
    setTableData('tenants', [
      { id: 't-1', tenant_type: 'institution' },
    ]);
    setTableData('subscriptions', [
      { tenant_id: 't-1', status: 'active' },
    ]);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-123/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-123' });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('rejects submission when subscription is past_due', async () => {
    setTableData('case_entries', [
      { id: 'c-124', tenant_id: 't-1', resident_id: 'p-1', status: 'draft' },
    ]);
    setTableData('profiles', [
      { id: 'p-1', user_id: 'u-1', role: 'resident', tenant_id: 't-1' },
    ]);
    setTableData('subscriptions', [
      { tenant_id: 't-1', status: 'past_due' },
    ]);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-124/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-124' });

    const res = await POST(req, { params });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Subscription lapsed');
  });

  it('auto-approves for individual tenant type', async () => {
    setTableData('case_entries', [
      { id: 'c-125', tenant_id: 't-2', resident_id: 'p-1', status: 'draft' },
    ]);
    setTableData('profiles', [
      { id: 'p-1', user_id: 'u-1', role: 'resident', tenant_id: 't-2' },
    ]);
    setTableData('subscriptions', [
      { tenant_id: 't-2', status: 'active' },
    ]);
    setTableData('tenants', [
      { id: 't-2', tenant_type: 'individual' },
    ]);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-125/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-125' });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.auto_approved).toBe(true);
  });

  it('rolls back to draft when approval creation fails', async () => {
    setTableData('case_entries', [
      { id: 'c-126', tenant_id: 't-1', resident_id: 'p-1', status: 'draft' },
    ]);
    setTableData('profiles', [
      { id: 'p-1', user_id: 'u-1', role: 'resident', tenant_id: 't-1' },
      { id: 'sup-1', role: 'supervisor', tenant_id: 't-1' },
    ]);
    setTableData('tenants', [
      { id: 't-1', tenant_type: 'institution' },
    ]);
    setTableData('subscriptions', [
      { tenant_id: 't-1', status: 'active' },
    ]);
    // Make the insert fail by having it return an error
    const originalFrom = mockSupabase.from;
    let insertFailed = false;
    mockSupabase.from = vi.fn((table: string) => {
      const builder = originalFrom(table);
      if (table === 'approval_requests') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        builder.insert = ((..._args: any[]) => {
          insertFailed = true;
          return {
            then: (resolve: (v: unknown) => void) => resolve({ error: new Error('insert failure') }),
            error: null,
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
      }
      return builder;
    });
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    const req = makePostRequest('https://app.elogbook.dev/demo/cases/c-126/submit', {
      origin: 'https://app.elogbook.dev',
    });
    const params = Promise.resolve({ tenant: 'demo', id: 'c-126' });

    const res = await POST(req, { params });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('returned to draft');
    expect(insertFailed).toBe(true);
  });
});
