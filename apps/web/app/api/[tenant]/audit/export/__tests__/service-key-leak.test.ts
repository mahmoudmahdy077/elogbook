import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: vi.fn(),
}));

// This suite asserts one thing: which token the PDF edge call is authorized
// with. The route's other seams are unrelated to that, and pulling them in
// costs more than the suite's whole budget — `@/lib/logger` alone drags in the
// Sentry SDK. Each stub returns the shape the route's contract expects; the
// real implementations stay covered in route.test.ts.
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redactPHI: (value: unknown) => value,
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(
    (retryAfter: number) =>
      new Response(
        JSON.stringify({ error: 'Too many requests. Please wait before trying again.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) } },
      ),
  ),
}));

vi.mock('@/lib/audit/write-audit-event', () => ({
  requireAuditEvent: vi.fn(async () => ({ ok: true, auditId: 'audit-row-1' })),
}));

import { getSecurityContext } from '@/lib/supabase/security-context';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'user-jwt-token' } } })),
    },
    // The required export audit event goes through the trusted RPC (exercised
    // for real in route.test.ts); here `requireAuditEvent` is stubbed above.
    rpc: vi.fn(async () => ({ data: 'audit-row-1', error: null })),
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { role: 'institution_admin', tenant_id: TENANT_ID, tenants: { slug: 'demo' } } })) })),
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
        profile: { id: 'p-1', tenant_id: TENANT_ID, role: 'institution_admin', status: 'active', full_name: 'Admin' },
        tenant: { id: TENANT_ID, slug: 'demo', status: 'active' },
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
