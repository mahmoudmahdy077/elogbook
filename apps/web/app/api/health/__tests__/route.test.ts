import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock NextResponse before anything else
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

// Mock @/lib/supabase/server
const mockDbLimit = vi.fn();
const mockDbSelect = vi.fn().mockReturnValue({ limit: mockDbLimit });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
const mockSupabase = {
  from: vi.fn(() => ({
    select: mockDbSelect,
  })),
  auth: { getUser: mockGetUser },
};

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));

// Mock @/lib/request-context
vi.mock('@/lib/request-context', () => ({
  newRequestId: vi.fn().mockReturnValue('req-abc-123'),
  requestContext: {
    run: (_ctx: unknown, fn: () => unknown) => fn(),
  },
}));

const { GET } = await import('../route');

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 with status ok when database is reachable', async () => {
    mockDbLimit.mockResolvedValue({ error: null });

    const req = new Request('http://app.elogbook.dev/api/health');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks?.database).toBe('reachable');
    expect(typeof body.durationMs).toBe('number');
  });

  it('returns 503 with status degraded when database is unreachable', async () => {
    mockDbLimit.mockResolvedValue({ error: new Error('Connection refused') });

    const req = new Request('http://app.elogbook.dev/api/health');
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks?.database).toContain('unreachable');
  });

  it('returns 503 with status error when an exception is thrown', async () => {
    mockDbLimit.mockRejectedValue(new Error('Unexpected crash'));

    const req = new Request('http://app.elogbook.dev/api/health');
    const res = await GET(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error).toBe('Unexpected crash');
  });

  it('includes X-Request-Id header in response', async () => {
    mockDbLimit.mockResolvedValue({ error: null });

    const req = new Request('http://app.elogbook.dev/api/health');
    const res = await GET(req);

    expect(res.headers.get('X-Request-Id')).toBe('req-abc-123');
  });

  it('passes through x-request-id from incoming request when valid', async () => {
    mockDbLimit.mockResolvedValue({ error: null });

    const req = new Request('http://app.elogbook.dev/api/health', {
      headers: { 'x-request-id': 'client-trace-456' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toBe('client-trace-456');
  });
});
