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
const mockValidateOrigin = vi.fn(() => null as unknown);

vi.mock('@/lib/csrf', () => ({
  validateOrigin: (...args: unknown[]) => mockValidateOrigin(...args),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

// ---------------------------------------------------------------------------
// Mock @/lib/rate-limit – allow all requests by default; individual tests
// can override to simulate rate-limit hits.
// ---------------------------------------------------------------------------
const mockCheckRateLimit = vi.fn(() => ({ allowed: true, retryAfter: 0 }));
const mockRateLimitResponse = vi.fn((retryAfter: number) =>
  new (class { status = 429; async json() { return { error: 'Too many requests', retryAfter }; } })()
);

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  rateLimitResponse: (...args: unknown[]) => mockRateLimitResponse(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
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
});
