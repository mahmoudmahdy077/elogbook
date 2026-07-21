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
globalThis.fetch = fetchMock as any;

describe('audit export route — SEC-003', () => {
  beforeEach(() => { fetchMock.mockClear(); });

  it('sends the user JWT, not the service-role key, to the edge function', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'shhh-platform-secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    const { GET } = await import('../route');
    const req = new Request('https://x/api/demo/audit/export?format=pdf', { method: 'GET' });
    await GET(req as any, { params: Promise.resolve({ tenant: 'demo' }) } as any);
    const authHeader = fetchMock.mock.calls[0]?.[1]?.headers?.['Authorization'] || '';
    expect(authHeader).not.toContain('shhh-platform-secret');
    expect(authHeader).toContain('user-jwt-token');
  });
});
