import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A compliance export is a disclosure of audit metadata, PHI inventory counts,
// consent records and soft-deletion tombstones. It is also the one export that
// offers ETag revalidation, which is exactly the mechanism that would let an
// intermediary serve a previous tenant's bytes to a different caller.

const state = vi.hoisted(() => ({
  security: null as unknown,
  client: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => state.client),
}));

vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: vi.fn(async () => state.security),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

vi.mock('@/lib/client-ip', () => ({ getClientIp: vi.fn(() => 'ip') }));

import { GET } from '../route';

const TENANT_ID = 'tenant-id-1';

function securityContext(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    context: {
      user: { id: 'user-1' },
      profile: { id: 'profile-1', tenant_id: TENANT_ID, role: 'admin', status: 'active' },
      tenant: { id: TENANT_ID, slug: 'tenant-a', status: 'active' },
      aal: 'aal2',
      ...overrides,
    },
  };
}

function exportRequest(query = 'section=data-access&format=csv', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/tenant-a/compliance/export?${query}`, {
    headers: { origin: 'http://localhost', ...headers },
  });
}

function supabaseStub() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    not: () => chain,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
  };
  return {
    from: vi.fn(() => chain),
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
}

beforeEach(() => {
  state.security = securityContext();
  state.client = supabaseStub();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('compliance export cache policy', () => {
  it('marks a CSV export no-store', async () => {
    const response = await GET(exportRequest(), { params: Promise.resolve({ tenant: 'tenant-a' }) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('marks the HTML/PDF-fallback export no-store', async () => {
    const response = await GET(exportRequest('section=consent&format=pdf'), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('does not let an ETag turn a disclosure into a cacheable resource', async () => {
    // A validator is a promise that a matching representation exists somewhere
    // reusable. For an export that is a retention problem, so no ETag is
    // emitted and a conditional request gets the bytes, not a 304.
    const first = await GET(exportRequest(), { params: Promise.resolve({ tenant: 'tenant-a' }) });
    expect(first.headers.get('etag')).toBeNull();

    const second = await GET(exportRequest('section=data-access&format=csv', { 'if-none-match': 'anything' }), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });
    expect(second.status).toBe(200);
    expect(second.headers.get('cache-control')).toContain('no-store');
  });

  it('marks a denial no-store too', async () => {
    state.security = securityContext({
      profile: { id: 'profile-1', tenant_id: TENANT_ID, role: 'resident', status: 'active' },
    });
    const response = await GET(exportRequest(), { params: Promise.resolve({ tenant: 'tenant-a' }) });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('marks an invalid-section refusal no-store', async () => {
    const response = await GET(exportRequest('section=everything'), {
      params: Promise.resolve({ tenant: 'tenant-a' }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
