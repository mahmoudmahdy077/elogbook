import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'user-jwt-token' } } })),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { role: 'institution_admin', tenant_id: 't-1', tenants: { slug: 'demo' } } })) })),
          })),
        };
      }
      if (table === 'audit_logs') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          gte: () => chain,
          lte: () => chain,
          insert: () => ({ maybeSingle: vi.fn(async () => ({})) }),
          then: (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: [], error: null })),
        };
        return chain;
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) };
    }),
  })),
}));

const fetchMock = vi.fn(async () => new Response('PDF_BYTES', { status: 200 }));
globalThis.fetch = fetchMock as unknown as typeof fetch;

describe('audit export route — SEC-003', () => {
  beforeEach(() => { fetchMock.mockClear(); });

  it('makes no external HTTP calls, so no credentials can leak', async () => {
    // The old route proxied PDF rendering to an edge function, sending the
    // user's access token over the wire. That proxy is gone: the route is
    // CSV-only and must never talk to any external service — the strongest
    // possible form of "sends no service-role key / user JWT anywhere".
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'shhh-platform-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    const { GET } = await import('../route');
    const req = new Request('https://x/api/demo/audit/export?format=pdf', { method: 'GET' });
    const res = await GET(req as unknown as Request, { params: Promise.resolve({ tenant: 'demo' }) } as unknown as Parameters<typeof GET>[1]);
    expect(fetchMock.mock.calls.length).toBe(0);
    expect(res.status).toBe(400);
  });
});
