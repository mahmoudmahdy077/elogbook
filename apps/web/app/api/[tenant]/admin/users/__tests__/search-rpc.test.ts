import { beforeEach, describe, expect, it, vi } from 'vitest';

// A name search cannot be expressed in the PostgREST builder without handing the
// caller a grammar to write in. `full_name.ilike.%o'brien%` needs the apostrophe
// escaped or the filter breaks, `.or()` needs `.` and `,` to mean column and
// clause, and `%`/`_` are wildcards with no escape convention in that grammar.
// The old route resolved that by refusing any term containing a quote, a period
// or a wildcard -- so `O'Brien` and `Dr. Smith` were silently unfindable, which
// is a correctness bug dressed as a security fix.
//
// The search therefore moves into public.search_users, where the term is a bound
// parameter and the match is a substring comparison inside the database. What is
// left for the route to guarantee is narrow and testable:
//   * a search never reaches `.or()` or any other caller-authored filter string;
//   * the term arrives at the RPC byte-for-byte, so no character is quietly
//     dropped on the way;
//   * page and limit are clamped before they are forwarded;
//   * a role or status outside the allowlist is refused with a 400, not searched
//     without -- dropping it answers a wider question than the one asked;
//   * a request with no search term keeps the tenant-scoped builder read.

const state = vi.hoisted(() => ({
  security: null as unknown,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: [] as unknown[] | null, error: null as unknown },
  filters: [] as Array<[string, unknown]>,
  orFilter: null as string | null,
  range: null as { from: number; to: number } | null,
  tableResult: { data: [] as unknown[] | null, count: 0, error: null as unknown },
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => client) }));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: vi.fn(async () => state.security),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const chain: Record<string, unknown> = {};
chain.select = vi.fn(() => chain);
chain.eq = vi.fn((column: string, value: unknown) => {
  state.filters.push([column, value]);
  return chain;
});
chain.order = vi.fn(() => chain);
chain.range = vi.fn((from: number, to: number) => {
  state.range = { from, to };
  return Promise.resolve(state.tableResult);
});
// A real client has `.or()`. It is recorded so a test can assert the route never
// reaches it; the route is expected to leave it untouched for a search.
chain.or = vi.fn((filter: string) => {
  state.orFilter = filter;
  return chain;
});

const client = {
  from: vi.fn(() => chain),
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return state.rpcResult;
  }),
};

import { GET, MAX_PAGE_SIZE } from '../route';

function request(query = ''): import('next/server').NextRequest {
  const url = new URL(`http://localhost/api/tenant-a/admin/users${query ? `?${query}` : ''}`);
  return { url, nextUrl: url, headers: new Headers() } as unknown as import('next/server').NextRequest;
}

const ADMIN = {
  ok: true as const,
  profile: { id: 'admin-profile', tenant_id: 'tenant-1', user_id: 'user-1', role: 'admin' },
  user: { id: 'user-1' },
};

function searchCall() {
  return state.rpcCalls.find((call) => call.fn === 'search_users');
}

beforeEach(() => {
  state.security = ADMIN;
  state.rpcCalls = [];
  state.rpcResult = { data: [], error: null };
  state.filters = [];
  state.orFilter = null;
  state.range = null;
  state.tableResult = { data: [], count: 0, error: null };
  vi.clearAllMocks();
});

describe('admin user search', () => {
  it('runs a name search through the search_users RPC', async () => {
    const response = await GET(request('search=smith'));

    expect(response.status).toBe(200);
    expect(searchCall()).toBeDefined();
    expect(searchCall()!.args.p_search).toBe('smith');
  });

  it('never writes a caller string into the PostgREST filter grammar', async () => {
    for (const term of ['smith', "O'Brien", 'Dr. Smith', 'a,b', 'a.b', 'a)', 'x"),full_name.not.is.null']) {
      state.orFilter = null;
      state.rpcCalls = [];
      await GET(request(`search=${encodeURIComponent(term)}`));
      expect(state.orFilter, `term ${term} must not reach .or()`).toBeNull();
    }
  });

  it('keeps an apostrophe in the name rather than dropping it', async () => {
    await GET(request(`search=${encodeURIComponent("O'Brien")}`));
    expect(searchCall()!.args.p_search).toBe("O'Brien");
  });

  it('keeps a period in the name rather than dropping it', async () => {
    await GET(request(`search=${encodeURIComponent('Dr. Smith')}`));
    expect(searchCall()!.args.p_search).toBe('Dr. Smith');
  });

  it('forwards wildcard and filter-grammar characters unchanged as an opaque value', async () => {
    // These are not rejected here. They are data. The database is where the
    // substring match and its escaping live, so stripping them in the route
    // would reintroduce exactly the silent-drop bug this replaces.
    for (const term of ['%', '_', 'a,b', 'a.b', 'a)', "a'", 'a&b', 'a|b']) {
      state.rpcCalls = [];
      await GET(request(`search=${encodeURIComponent(term)}`));
      expect(searchCall()?.args.p_search, `term ${term} must survive intact`).toBe(term);
    }
  });

  it('treats a blank search as no search at all', async () => {
    await GET(request(`search=${encodeURIComponent('   ')}`));
    expect(searchCall()).toBeUndefined();
  });

  it('scopes the RPC call to the caller tenant', async () => {
    await GET(request('search=smith'));
    expect(searchCall()!.args.p_tenant_id).toBe('tenant-1');
  });

  it('clamps the page and limit it forwards', async () => {
    await GET(request('search=smith&page=99999999&limit=1000000'));
    const args = searchCall()!.args;
    expect(Number(args.p_limit)).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    expect(Number(args.p_page)).toBeLessThanOrEqual(100_000);
    expect(Number(args.p_page)).toBeGreaterThanOrEqual(1);

    state.rpcCalls = [];
    await GET(request('search=smith&page=-5&limit=-1'));
    expect(Number(searchCall()!.args.p_page)).toBeGreaterThanOrEqual(1);
    expect(Number(searchCall()!.args.p_limit)).toBeGreaterThanOrEqual(1);
  });

  it('refuses a role outside the allowlist instead of searching without it', async () => {
    // The database refuses it too (20260929000001 raises 22023), but reaching
    // that refusal means the request was already accepted and cost a round trip.
    // More importantly, silently dropping it here would answer a question the
    // caller did not ask.
    const response = await GET(request('search=smith&role=superuser'));
    expect(response.status).toBe(400);
    expect(searchCall()).toBeUndefined();
  });

  it('refuses a status outside the allowlist instead of searching without it', async () => {
    const response = await GET(request('search=smith&status=deleted'));
    expect(response.status).toBe(400);
    expect(searchCall()).toBeUndefined();
  });

  it('forwards an allowlisted role and status', async () => {
    await GET(request('search=smith&role=supervisor&status=active'));
    expect(searchCall()!.args.p_role).toBe('supervisor');
    expect(searchCall()!.args.p_status).toBe('active');
  });

  it('forwards a deactivated status, which search_users accepts', async () => {
    await GET(request('search=smith&status=deactivated'));
    expect(searchCall()!.args.p_status).toBe('deactivated');
  });

  it('returns the rows and the total the RPC produced', async () => {
    state.rpcResult = {
      data: [
        { id: 'p1', full_name: "O'Brien, Aoife", total_count: 7 },
        { id: 'p2', full_name: 'Dr. Smith', total_count: 7 },
      ],
      error: null,
    };
    const response = await GET(request('search=brien'));
    const body = await response.json();

    expect(body.users).toHaveLength(2);
    expect(body.total).toBe(7);
    expect(body.pages).toBeGreaterThan(0);
  });

  it('reports a zero total when the RPC returns no rows', async () => {
    const response = await GET(request('search=nobody'));
    const body = await response.json();
    expect(body.users).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('does not echo a database error from the RPC', async () => {
    state.rpcResult = {
      data: null,
      error: { message: 'connection to db-primary.internal:5432 failed' },
    };
    const response = await GET(request('search=smith'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('db-primary');
  });

  it('keeps the no-search read on the tenant-scoped builder path', async () => {
    await GET(request('role=supervisor'));

    expect(state.rpcCalls).toHaveLength(0);
    expect(state.filters).toContainEqual(['tenant_id', 'tenant-1']);
    expect(state.orFilter).toBeNull();
    expect(state.range).not.toBeNull();
  });
});
