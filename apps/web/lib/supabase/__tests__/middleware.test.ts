import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We test the middleware's CSRF guard and tenant-slug matching logic directly.
// The middleware.ts exports updateSession which uses createServerClient from
// @supabase/ssr. We mock that dependency and test the function's behavior
// under various conditions (CSRF, auth, tenant access).
// ---------------------------------------------------------------------------

// Mock NextResponse and NextRequest
vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly _body: unknown;
    readonly headers: Headers;
    cookies = {
      _cookies: {} as Record<string, { value: string; options?: Record<string, unknown> }>,
      set(name: string, value: string, options?: Record<string, unknown>) {
        this._cookies[name] = { value, options };
      },
      get(name: string) { return this._cookies[name]; },
      getAll() { return Object.entries(this._cookies).map(([k, v]) => ({ name: k, value: v.value })); },
    };

    constructor(body?: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = new Headers(init?.headers);
    }
    async json() { return this._body; }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
    static next(_opts?: unknown) {
      return new MockNextResponse();
    }
    static redirect(url: string | URL) {
      const res = new MockNextResponse(null, { status: 307 });
      res.headers.set('Location', typeof url === 'string' ? url : url.toString());
      return res;
    }
  }
  return { NextResponse: MockNextResponse };
});

// Mock @supabase/ssr createServerClient
const mockServerClientFrom = vi.fn();
const mockServerClientAuth = {
  getUser: vi.fn(),
};
const mockCreateServerClient = vi.fn(() => ({
  from: mockServerClientFrom,
  auth: mockServerClientAuth,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => mockCreateServerClient()),
}));

vi.mock('@sentry/nextjs', () => ({
  startSpan: (_ctx: unknown, fn: (span: unknown) => unknown) => fn({ setAttribute: vi.fn() }),
}));

import type { NextRequest } from 'next/server';

const { updateSession } = await import('../middleware');

function makeNextRequest(url: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
} = {}): NextRequest {
  const headers = new Headers(opts.headers || {});
  const cookies = opts.cookies || {};

  // Combine explicit headers with cookie header
  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (cookieStr && !headers.get('cookie')) {
    headers.set('cookie', cookieStr);
  }

  return {
    method: opts.method || 'GET',
    url,
    nextUrl: new URL(url),
    headers,
    cookies: {
      _cookies: { ...cookies },
      get(name: string) {
        const val = { value: cookies[name] };
        return val;
      },
      getAll() {
        return Object.entries(cookies).map(([k, v]) => ({ name: k, value: v }));
      },
      set(name: string, value: string) {
        this._cookies[name] = value;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('updateSession - CSRF guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerClientAuth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mockServerClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });
  });

  it('allows GET requests without origin header (no CSRF check)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/dashboard', { method: 'GET' });
    const res = await updateSession(req);
    // Should pass through (not 403)
    expect(res.status).not.toBe(403);
  });

  it('allows OPTIONS requests without origin header', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/api/health', { method: 'OPTIONS' });
    const res = await updateSession(req);
    expect(res.status).not.toBe(403);
  });

  it('blocks POST requests with no origin header', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/approvals/action', { method: 'POST' });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Origin');
  });

  it('blocks POST requests with mismatched origin', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/approvals/action', {
      method: 'POST',
      headers: { origin: 'https://evil.com' },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Cross-origin');
  });

  it('allows POST requests with matching origin', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/approvals/action', {
      method: 'POST',
      headers: { origin: 'https://app.elogbook.dev' },
    });
    const res = await updateSession(req);
    // Should pass CSRF and reach auth check (which will redirect to login)
    expect(res.status).toBe(307); // redirect to login because no user
    const location = res.headers.get('Location');
    expect(location).toContain('/login');
  });

  it('blocks DELETE requests with no origin', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/approvals/action', { method: 'DELETE' });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
  });

  it('blocks PUT requests with mismatched origin', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

    const req = makeNextRequest('https://app.elogbook.dev/demo/cases/c-123', {
      method: 'PUT',
      headers: { origin: 'https://attacker.com' },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(403);
  });
});

describe('updateSession - auth & tenant slug matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('redirects unauthenticated user to /login for protected routes', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') });

    const req = makeNextRequest('https://app.elogbook.dev/demo/dashboard', { method: 'GET' });
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('Location');
    expect(location).toContain('/login');
    expect(location).toContain('next=' + encodeURIComponent('/demo/dashboard'));
  });

  it('redirects authenticated user to their correct tenant slug when mismatched', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });
    mockServerClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              role: 'resident',
              tenant_id: 't-1',
              tenants: { slug: 'real-tenant' },
            },
            error: null,
          }),
        }),
      }),
    });

    const req = makeNextRequest('https://app.elogbook.dev/wrong-tenant/dashboard', { method: 'GET' });
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('Location');
    expect(location).toContain('/real-tenant/dashboard');
  });

  it('allows authenticated user with matching tenant slug', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });
    mockServerClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              role: 'resident',
              tenant_id: 't-1',
              tenants: { slug: 'real-tenant' },
            },
            error: null,
          }),
        }),
      }),
    });

    const req = makeNextRequest('https://app.elogbook.dev/real-tenant/dashboard', { method: 'GET' });
    const res = await updateSession(req);
    // Should pass through — not a redirect
    expect(res.status).not.toBe(307);
  });

  it('passes through for public routes when user is not authenticated', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') });

    const req = makeNextRequest('https://app.elogbook.dev/', { method: 'GET' });
    const res = await updateSession(req);
    // Home page is public — should pass through
    expect(res.status).not.toBe(307);
  });

  it('redirects already-logged-in user from /login to dashboard', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });
    mockServerClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              role: 'resident',
              tenant_id: 't-1',
              tenants: { slug: 'my-tenant' },
            },
            error: null,
          }),
        }),
      }),
    });

    const req = makeNextRequest('https://app.elogbook.dev/login', { method: 'GET' });
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('Location');
    expect(location).toContain('/my-tenant/dashboard');
  });

  it('passes through request when Supabase env vars are not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const req = makeNextRequest('https://app.elogbook.dev/demo/dashboard', { method: 'GET' });
    const res = await updateSession(req);
    // Should pass through without CSRF check or auth
    expect(res.status).toBe(200);
  });

  it('redirects to default tenant slug when user has no tenant slug resolved', async () => {
    mockServerClientAuth.getUser.mockResolvedValue({
      data: { user: { id: 'u-1' } },
      error: null,
    });
    mockServerClientFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const req = makeNextRequest('https://app.elogbook.dev/login', { method: 'GET' });
    const res = await updateSession(req);
    expect(res.status).toBe(307);
    const location = res.headers.get('Location');
    expect(location).toContain('/default/dashboard');
  });
});

describe('updateSession - pass-through when no env vars', () => {
  it('passes through without CSRF check when SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // State-changing POST without origin should be rejected by CSRF guard,
    // but without env vars, the middleware should pass through entirely.
    const req = makeNextRequest('https://app.elogbook.dev/demo/approvals/action', { method: 'POST' });
    const res = await updateSession(req);
    expect(res.status).toBe(200);
  });
});
