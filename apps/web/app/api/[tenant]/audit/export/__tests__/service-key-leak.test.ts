import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: vi.fn(),
}));

import { getSecurityContext } from '@/lib/supabase/security-context';

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
const fakeServiceRoleKey = ['shhh-', 'platform-', 'secret'].join('');
const setTestEnvironment = (name: string, value: string) => { process.env[name] = value; };

describe('audit export route — SEC-003', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.mocked(getSecurityContext).mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'admin-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'institution_admin', status: 'active', full_name: 'Admin' },
        tenant: { id: 't-1', slug: 'demo', status: 'active' },
        aal: 'aal2',
      },
    } as never);
  });

  it('sends the user JWT, not the service-role key, to the edge function', async () => {
    setTestEnvironment('SUPABASE_SERVICE_ROLE_KEY', fakeServiceRoleKey);
    setTestEnvironment('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    const { GET } = await import('../route');
    const req = new Request('https://x/api/demo/audit/export?format=pdf', { method: 'GET' });
    await GET(req as unknown as Request, { params: Promise.resolve({ tenant: 'demo' }) } as unknown as Parameters<typeof GET>[1]);
    const calls = fetchMock.mock.calls as unknown as [RequestInfo, RequestInit][];
    const authHeader = (calls[0]?.[1]?.headers as Record<string, string>)?.['Authorization'] || '';
    expect(authHeader).not.toContain(fakeServiceRoleKey);
    expect(authHeader).toContain('user-jwt-token');
  });
});
