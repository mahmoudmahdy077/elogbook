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
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: (retryAfter: number) => mockRateLimitResponse(retryAfter),
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

import { GET } from '../route';

// Shared mock profile
const profileData = {
  data: {
    id: 'p-1',
    tenant_id: 't-1',
    role: 'director',
    tenants: { slug: 'demo' },
  },
  error: null,
};

// Sample audit log rows
const sampleLogs = [
  {
    id: 'log-1',
    created_at: '2025-01-15T10:00:00Z',
    action: 'case.submitted',
    resource_type: 'case',
    resource_id: 'entry-1',
    user_id: 'u-1',
    ip_address: '192.168.1.1',
    changes: { from: 'draft', to: 'pending' },
  },
  {
    id: 'log-2',
    created_at: '2025-01-16T11:00:00Z',
    action: 'case.approved',
    resource_type: 'case',
    resource_id: 'entry-2',
    user_id: 'u-2',
    ip_address: '192.168.1.2',
    changes: { from: 'pending', to: 'approved' },
  },
];

function makeGetRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'GET',
    headers: new Headers(headers),
  });
}

describe('GET /api/[tenant]/audit/export', () => {
  const params = Promise.resolve({ tenant: 'demo' });

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));
    mockValidateOrigin.mockReturnValue(null);
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });

    // Default mocks: profile lookup succeeds, audit logs return sample data
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(profileData),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        let chain: Record<string, unknown> = {};
        const queryFn = () => Promise.resolve({ data: sampleLogs, error: null });
        chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          gte: () => chain,
          lte: () => chain,
          insert: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          then: (resolve: (v: unknown) => void) => resolve(queryFn()),
        };
        return chain;
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });
  });

  it('rejects request when CSRF validation fails', async () => {
    mockValidateOrigin.mockReturnValueOnce(
      { status: 403, json: async () => ({ error: 'Origin not allowed' }) },
    );

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(403);
  });

  it('rejects request when rate limited', async () => {
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfter: 30 });

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(429);
  });

  it('rejects unauthenticated request', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('Auth error'),
    });

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

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

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

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
                  role: 'director',
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

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

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
                  role: 'supervisor',
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

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Only directors and admins');
  });

  it('rejects request with invalid format param', async () => {
    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export?format=xml');
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('format must be');
  });

  it('returns CSV export by default', async () => {
    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    // CSV should have header row
    expect(text).toContain('id,created_at,action');
    // CSV should contain the log data
    expect(text).toContain('log-1');
    expect(text).toContain('case.submitted');
  });

  it('returns CSV export with explicit format=csv', async () => {
    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export?format=csv');
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
  });

  it('returns HTML export when PDF generation fails (fallback)', async () => {
    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export?format=pdf');
    const res = await GET(req, { params });

    // When NEXT_PUBLIC_SUPABASE_URL is not set, PDF fetch will fail,
    // falling through to generateAuditPdfInline which returns HTML.
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('X-Export-Format')).toBe('html');
    // HTML should contain the log data
    const text = await res.text();
    expect(text).toContain('Audit Log Export');
    expect(text).toContain('entry-1');
  });

  it('applies date range filter when startDate and endDate are provided', async () => {
    // We need to check that gte/lte are called
    let usedGte = false;
    let usedLte = false;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(profileData),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          gte: () => { usedGte = true; return chain; },
          lte: () => { usedLte = true; return chain; },
          insert: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          then: (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: [], error: null })),
        };
        return chain;
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export?startDate=2025-01-01&endDate=2025-01-31');
    await GET(req, { params });

    expect(usedGte).toBe(true);
    expect(usedLte).toBe(true);
  });

  it('handles database query error gracefully', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(profileData),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          then: (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: null, error: new Error('DB connection failed') })),
        };
        return chain;
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Failed to retrieve');
  });

  it('returns empty CSV when no audit logs exist', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(profileData),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          insert: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          then: (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: [], error: null })),
        };
        return chain;
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    });

    const req = makeGetRequest('https://app.elogbook.dev/demo/audit/export');
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const text = await res.text();
    // Should have headers only (no data rows)
    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('id,created_at');
  });
});
