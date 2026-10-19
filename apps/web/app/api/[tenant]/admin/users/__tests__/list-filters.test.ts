import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin user list is a tenant-scoped read with caller-controlled filters.
// Three things had to be true and were not:
//
//   * pagination was unbounded -- `page` and `limit` were `parseInt` of caller
//     input with no range, so `limit=1000000` asked the database for the whole
//     tenant and `page=-1` produced a negative offset;
//   * `role` and `status` were passed straight to `.eq()`, so any string the
//     caller sent reached the query builder;
//   * `search` was interpolated into a PostgREST `.or()` string. That grammar
//     uses `,` to separate clauses and `.` for column references, so a search
//     term could append its own filter, and `%` / `_` acted as wildcards.
//
// A filter the caller did not send and a filter the route refused to send are
// the same request to the database and different answers to the person: one is
// "no such user", the other is "here is the whole tenant". An unsupported role
// or status is therefore a 400, not a silently widened list.

const state = vi.hoisted(() => ({
  security: null as unknown,
  filters: [] as Array<[string, unknown]>,
  orFilter: null as string | null,
  range: null as { from: number; to: number } | null,
  order: null as { column: string; ascending: boolean } | null,
  result: { data: [] as unknown[] | null, count: 0, error: null as unknown },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: [] as unknown[] | null, error: null as unknown },
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => client) }));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: vi.fn(async () => state.security),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

const chain: Record<string, unknown> = {};
chain.select = vi.fn(() => chain);
chain.eq = vi.fn((column: string, value: unknown) => {
  state.filters.push([column, value]);
  return chain;
});
chain.or = vi.fn((filter: string) => {
  state.orFilter = filter;
  return chain;
});
chain.ilike = vi.fn((column: string, value: unknown) => {
  state.filters.push([column, value]);
  return chain;
});
chain.order = vi.fn((column: string, options: { ascending: boolean }) => {
  state.order = { column, ascending: options.ascending };
  return chain;
});
chain.range = vi.fn((from: number, to: number) => {
  state.range = { from, to };
  return Promise.resolve(state.result);
});

const client = {
  from: vi.fn(() => chain),
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return state.rpcResult;
  }),
};

import { GET, USER_ROLES, USER_STATUSES, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../route';

function request(query = ''): import('next/server').NextRequest {
  const url = new URL(`http://localhost/api/tenant-a/admin/users${query ? `?${query}` : ''}`);
  return { url, nextUrl: url, headers: new Headers() } as unknown as import('next/server').NextRequest;
}

const ADMIN = {
  ok: true as const,
  profile: { id: 'admin-profile', tenant_id: 'tenant-1', user_id: 'user-1', role: 'admin' },
  user: { id: 'user-1' },
};

beforeEach(() => {
  state.security = ADMIN;
  state.filters = [];
  state.orFilter = null;
  state.range = null;
  state.order = null;
  state.result = { data: [], count: 0, error: null };
  state.rpcCalls = [];
  state.rpcResult = { data: [], error: null };
  vi.clearAllMocks();
});

describe('admin users list', () => {
  it('always scopes the query to the caller tenant', async () => {
    await GET(request());
    expect(state.filters).toContainEqual(['tenant_id', 'tenant-1']);
  });

  it('never interpolates a caller string into a PostgREST filter grammar', async () => {
    const injection = 'x"),full_name.not.is.null,or(role.eq.admin';
    const response = await GET(request(`search=${encodeURIComponent(injection)}`));

    // Either the term is rejected, or it is applied as a value through the
    // builder or the search RPC. What must never happen is a caller-authored
    // filter string.
    expect(state.orFilter).toBeNull();
    expect(client.rpc).toHaveBeenCalledWith(
      'search_users',
      expect.objectContaining({ p_search: injection })
    );
    if (response.status === 200) {
      for (const [column] of state.filters) {
        expect(column).not.toContain('or(');
      }
    }
  });

  it('never lets a wildcard or a filter break reach the PostgREST grammar', async () => {
    for (const term of ['%', '_', 'a,b', 'a.b', "a'", 'a)']) {
      state.orFilter = null;
      state.rpcCalls = [];
      const response = await GET(request(`search=${encodeURIComponent(term)}`));
      expect(state.orFilter, `term ${term} must not reach .or()`).toBeNull();
      expect(state.rpcCalls, `term ${term} must be a bound RPC argument`).toHaveLength(1);
      for (const [, value] of state.filters) {
        expect(String(value)).not.toBe(term);
      }
      expect(response.status).toBe(200);
    }
  });

  it('accepts an ordinary search term', async () => {
    const response = await GET(request('search=smith'));
    expect(response.status).toBe(200);
  });

  it('clamps the page size to a bounded maximum', async () => {
    await GET(request('limit=1000000'));
    expect(state.range!.to - state.range!.from + 1).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('defaults the page size and never returns a negative offset', async () => {
    await GET(request());
    expect(state.range!.to - state.range!.from + 1).toBe(DEFAULT_PAGE_SIZE);

    state.range = null;
    await GET(request('page=-5'));
    expect(state.range!.from).toBeGreaterThanOrEqual(0);

    state.range = null;
    await GET(request('page=not-a-number&limit=also-not'));
    expect(state.range!.to - state.range!.from + 1).toBe(DEFAULT_PAGE_SIZE);
  });

  it('refuses a role outside the known set rather than querying without it', async () => {
    const response = await GET(request('role=superuser'));

    // Dropping the filter answers a different question than the one asked: the
    // caller asked for superusers and got the whole tenant. A refusal is the
    // only answer that cannot be mistaken for an empty result.
    expect(response.status).toBe(400);
    expect(state.range).toBeNull();
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('refuses a status outside the known set', async () => {
    const response = await GET(request('status=deleted'));

    expect(response.status).toBe(400);
    expect(state.range).toBeNull();
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('refuses an unsupported filter before it reaches the search RPC too', async () => {
    const response = await GET(request('search=smith&role=superuser'));

    expect(response.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('answers a filter the caller did not send at all', async () => {
    // An absent filter is not an unsupported one. Refusing it would make the
    // list unusable, and the two are indistinguishable to anyone reading the
    // request log.
    for (const query of ['', 'role=', 'status=']) {
      state.range = null;
      const response = await GET(request(query));
      expect(response.status, `query "${query}" must be a plain list`).toBe(200);
      expect(state.range).not.toBeNull();
    }
  });

  it('accepts every documented role and status', async () => {
    for (const role of USER_ROLES) {
      state.filters = [];
      await GET(request(`role=${role}`));
      expect(state.filters).toContainEqual(['role', role]);
    }
    for (const status of USER_STATUSES) {
      state.filters = [];
      await GET(request(`status=${status}`));
      expect(state.filters).toContainEqual(['status', status]);
    }
  });

  it('can filter by a deactivated account, which is a status the schema stores', async () => {
    // profiles.status admits 'deactivated' and search_users accepts it, so the
    // route dropping it made the admin console's own "Deactivated" filter return
    // every user in the tenant.
    expect(USER_STATUSES).toContain('deactivated');

    state.filters = [];
    const response = await GET(request('status=deactivated'));
    expect(response.status).toBe(200);
    expect(state.filters).toContainEqual(['status', 'deactivated']);
  });

  it('does not echo a database error to the caller', async () => {
    state.result = { data: null, count: 0, error: { message: 'connection to db-primary.internal:5432 failed' } };
    const response = await GET(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('db-primary');
  });
});
