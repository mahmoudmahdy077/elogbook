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
  return { NextResponse: MockNextResponse };
});

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, retryAfter: 0 });
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '127.0.0.1' }));

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom, auth: { getSession: vi.fn() } };
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(mockSupabase) }));
vi.mock('@/lib/supabase/security-context', () => ({ getSecurityContext: vi.fn() }));

import { getSecurityContext } from '@/lib/supabase/security-context';
import { GET } from '../route';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_ID = '22222222-2222-4222-8222-222222222222';
const params = Promise.resolve({ tenant: 'demo' });

function context(role: string) {
  return {
    ok: true as const,
    context: {
      user: { id: 'u-1' },
      profile: { id: '66666666-6666-4666-8666-666666666666', tenant_id: TENANT_ID, role, status: 'active' },
      tenant: { id: TENANT_ID, slug: 'demo', status: 'active' },
      aal: 'aal2',
    },
  };
}

describe('GET /api/[tenant]/reports/webads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [{ id: RESIDENT_ID }], error: null }) }) }),
        };
      }
      return { select: vi.fn() };
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<WebADSExport />',
    });
  });

  it('forwards the server-verified de-identified confirmation', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('director') as never);

    const res = await GET(new Request('https://app.elogbook.dev/demo/reports/webads'), { params });

    expect(res.status).toBe(200);
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.deidentified_confirmed).toBe(true);
    expect(body.resident_ids).toEqual([RESIDENT_ID]);
  });

  it('rejects a supervisor: the external feed is director+ only', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);

    const res = await GET(new Request('https://app.elogbook.dev/demo/reports/webads'), { params });

    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-ISO date range before calling the vendor edge', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('director') as never);

    const res = await GET(
      new Request('https://app.elogbook.dev/demo/reports/webads?date_from=01-01-2026'),
      { params },
    );

    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not echo the edge function body to the caller', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('director') as never);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 501,
      text: async () => '{"error":"external_export_not_enabled"} vendor=webads',
    });

    const res = await GET(new Request('https://app.elogbook.dev/demo/reports/webads'), { params });

    const body = await res.json();
    expect(res.status).toBe(501);
    expect(JSON.stringify(body)).not.toContain('vendor=webads');
  });

  it('marks the WebADS response no-store', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('director') as never);

    const res = await GET(new Request('https://app.elogbook.dev/demo/reports/webads'), { params });

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
