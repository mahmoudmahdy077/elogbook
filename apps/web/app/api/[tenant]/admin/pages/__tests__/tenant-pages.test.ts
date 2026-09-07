import { describe, it, expect, vi, beforeEach } from 'vitest';

// T25: tenant delegation — directors manage their own tenant's pages;
// other tenants' pages are invisible (404, never 403-revealing).

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/require-admin', () => ({ requireTenantAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));

import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { GET as listGet, POST as createPost } from '../route';
import { POST as publishPost } from '../[id]/publish/route';

type Guard = Awaited<ReturnType<typeof requireTenantAdmin>>;
const TENANT_A = {
  ok: true as const,
  profile: { id: 'p1', tenant_id: 'tenant-a' },
  user: { id: 'u1' },
} as unknown as Guard;
const DENIED = { ok: false as const, error: 'Forbidden', status: 403 as const } as unknown as Guard;

function req(body?: unknown) {
  return new Request('http://localhost/x', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
const listCtx = { params: Promise.resolve({ tenant: 'tenant-a' }) };
const pubCtx = { params: Promise.resolve({ tenant: 'tenant-a', id: 'page-1' }) };

function mockAdmin(opts: {
  pages?: unknown[];
  pageSingle?: unknown;
  revisionSingle?: unknown;
} = {}) {
  const calls = { update: [] as unknown[], audit: [] as unknown[] };
  const selectChain = (rows: unknown) => {
    const chain: Record<string, (...a: never[]) => unknown> = {};
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = () => Promise.resolve({ data: rows, error: null });
    chain.single = () => Promise.resolve({ data: Array.isArray(rows) ? (rows[0] ?? null) : rows, error: null });
    return chain;
  };
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'site_pages') {
        return {
          select: vi.fn(() => selectChain(opts.pages ?? (opts.pageSingle ? [opts.pageSingle] : []))),
          insert: vi.fn(() => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: 'page-new' }, error: null }) }),
          })),
          update: vi.fn((row: unknown) => {
            calls.update.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          }),
        };
      }
      if (table === 'site_page_revisions') {
        return {
          select: vi.fn(() => selectChain(opts.revisionSingle ? [opts.revisionSingle] : [])),
          insert: vi.fn(() => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: 'rev-new' }, error: null }) }),
          })),
          update: vi.fn((row: unknown) => {
            calls.update.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          }),
        };
      }
      return { insert: vi.fn((row: unknown) => { calls.audit.push(row); return Promise.resolve({ error: null }); }) };
    }),
  } as never);
  return calls;
}

describe('tenant pages API (T25)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies residents and mismatched tenants', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(DENIED);
    mockAdmin();
    expect((await listGet(req(), listCtx)).status).toBe(403);
    expect((await createPost(req({ slug: 'x' }), listCtx)).status).toBe(403);
  });

  it('creates tenant-scoped pages with validation', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(TENANT_A);
    mockAdmin();
    const bad = await createPost(req({ slug: 'ok', content: { blocks: [{ type: 'nope' }] } }), listCtx);
    expect(bad.status).toBe(400);
    const good = await createPost(
      req({ slug: 'events', content: { blocks: [{ type: 'text', body: 'hi' }] } }),
      listCtx,
    );
    expect(good.status).toBe(201);
  });

  it('publishes with pointer move scoped to the tenant', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(TENANT_A);
    const calls = mockAdmin({
      pageSingle: { id: 'page-1', published_revision_id: null },
      revisionSingle: { id: 'rev-1', content: { blocks: [{ type: 'text', body: 'v1' }] }, status: 'draft' },
    });
    const res = await publishPost(req({ revision_id: 'rev-1' }), pubCtx);
    expect(res.status).toBe(200);
    expect(calls.audit.length).toBe(1);
    const audit = calls.audit[0] as Record<string, unknown>;
    expect(audit.tenant_id).toBe('tenant-a');
  });

  it('returns 404 (not 403) for other tenants\u2019 pages', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue(TENANT_A);
    // Empty page lookup: the tenant_id predicate filtered the row out.
    mockAdmin({ pageSingle: null });
    const res = await publishPost(req({ revision_id: 'rev-1' }), pubCtx);
    expect(res.status).toBe(404);
  });
});
