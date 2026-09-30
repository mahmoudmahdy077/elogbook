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
const mockRateLimitResponse = vi.fn();
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: (n: number) => mockRateLimitResponse(n),
}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
  auth: { getSession: vi.fn(), getUser: vi.fn() },
};
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(mockSupabase) }));
vi.mock('@/lib/supabase/security-context', () => ({ getSecurityContext: vi.fn() }));

import { getSecurityContext } from '@/lib/supabase/security-context';
import { GET } from '../route';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RESIDENT_ID = '22222222-2222-4222-8222-222222222222';
const ENTRY_ID = '33333333-3333-4333-8333-333333333333';
const SUPERVISOR_ID = '44444444-4444-4444-8444-444444444444';

const params = Promise.resolve({ tenant: 'demo' });

function context(role: string, profileId = SUPERVISOR_ID) {
  return {
    ok: true as const,
    context: {
      user: { id: 'u-1' },
      profile: { id: profileId, tenant_id: TENANT_ID, role, status: 'active', full_name: 'Dr Sup' },
      tenant: { id: TENANT_ID, slug: 'demo', status: 'active' },
      aal: 'aal2',
    },
  };
}

function caseQueryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const assign = ['select', 'eq', 'order', 'limit', 'in', 'is'];
  for (const key of assign) chain[key] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('GET /api/[tenant]/export-pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } });
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'case_entries') return caseQueryChain([{ id: ENTRY_ID }]);
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: async () => new ArrayBuffer(8),
    });
  });

  it('rejects a resident: the PDF scope is supervisor+ only', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('resident', RESIDENT_ID) as never);

    const res = await GET(new Request('https://app.elogbook.dev/demo/export-pdf'), { params });

    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requires an explicit single resident_id', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);

    const res = await GET(new Request('https://app.elogbook.dev/demo/export-pdf'), { params });

    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid resident_id', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);

    const res = await GET(
      new Request(`https://app.elogbook.dev/demo/export-pdf?resident_id=${RESIDENT_ID},${TENANT_ID}`),
      { params },
    );

    expect(res.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('forwards only the single authorized resident scope and never a client name', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);

    const res = await GET(
      new Request(`https://app.elogbook.dev/demo/export-pdf?resident_id=${RESIDENT_ID}`),
      { params },
    );

    expect(res.status).toBe(200);
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ case_ids: [ENTRY_ID], resident_id: RESIDENT_ID });
    expect(JSON.stringify(body)).not.toContain('resident_name');
    expect(JSON.stringify(body)).not.toContain('Dr Sup');
  });

  it('does not echo the edge function body to the caller', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid JSON body: expected resident_id',
    });

    const res = await GET(
      new Request(`https://app.elogbook.dev/demo/export-pdf?resident_id=${RESIDENT_ID}`),
      { params },
    );

    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('expected resident_id');
  });

  it('marks the PDF response no-store', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('supervisor') as never);

    const res = await GET(
      new Request(`https://app.elogbook.dev/demo/export-pdf?resident_id=${RESIDENT_ID}`),
      { params },
    );

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
