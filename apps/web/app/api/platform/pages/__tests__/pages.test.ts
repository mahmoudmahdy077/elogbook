import { describe, it, expect, vi, beforeEach } from 'vitest';

// T24: platform editorial API. Tenant operators are denied; drafts
// validate; publish is pointer-moving with optimistic concurrency.

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/require-platform-admin', () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));

import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { GET as listGet, POST as createPost } from '../route';
import { PUT as saveDraft } from '../[id]/route';
import { POST as publishPost } from '../[id]/publish/route';

type Guard = Awaited<ReturnType<typeof requirePlatformAdmin>>;
const OPERATOR = {
  ok: true as const,
  user: { id: 'u1' },
  operator: { user_id: 'u1' },
  profile: { id: 'p1', tenant_id: 't1' },
} as unknown as Guard;
const DENIED = { ok: false as const, error: 'Platform access required', status: 403 as const } as unknown as Guard;

function req(body?: unknown) {
  return new Request('http://localhost/x', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as Parameters<typeof createPost>[0];
}
const pageCtx = (id: string) => ({ params: Promise.resolve({ id }) });

interface Fixture {
  pages?: Record<string, unknown>[];
  pageSingle?: Record<string, unknown> | null;
  revisions?: Record<string, unknown>[];
  revisionSingle?: Record<string, unknown> | null;
  calls?: { update: unknown[]; insert: unknown[]; audit: unknown[] };
}

function mockAdmin(fx: Fixture = {}) {
  const calls = (fx.calls = { update: [] as unknown[], insert: [] as unknown[], audit: [] as unknown[] });
  const awaitable = (value: unknown) => ({
    then: (resolve: (v: unknown) => void) => resolve(value),
  });
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
          select: vi.fn(() => selectChain(fx.pages ?? (fx.pageSingle ? [fx.pageSingle] : []))),
          insert: vi.fn((row: unknown) => {
            calls.insert.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'page-new', ...(row as object) }, error: null }) }) };
          }),
          update: vi.fn((row: unknown) => {
            calls.update.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          }),
        };
      }
      if (table === 'site_page_revisions') {
        return {
          select: vi.fn(() => selectChain(fx.revisions ?? (fx.revisionSingle ? [fx.revisionSingle] : []))),
          insert: vi.fn((row: unknown) => {
            calls.insert.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'rev-new', ...(row as object) }, error: null }) }) };
          }),
          update: vi.fn((row: unknown) => {
            calls.update.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          }),
        };
      }
      return {
        insert: vi.fn((row: unknown) => {
          calls.audit.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }),
  } as never);
  void awaitable;
  return calls;
}

describe('platform pages API (T24)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies non-operators on every endpoint', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(DENIED);
    mockAdmin();
    expect((await listGet()).status).toBe(403);
    expect((await createPost(req({ slug: 'x' }))).status).toBe(403);
    expect((await saveDraft(req({ content: { blocks: [] } }), pageCtx('p'))).status).toBe(403);
    expect((await publishPost(req({ revision_id: 'r' }), pageCtx('p'))).status).toBe(403);
  });

  it('rejects bad slugs and invalid content on create', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin();
    expect((await createPost(req({ slug: 'Bad Slug!' }))).status).toBe(400);
    expect(
      (await createPost(req({ slug: 'ok', content: { blocks: [{ type: 'nope' }] } }))).status,
    ).toBe(400);
  });

  it('creates pages with an initial draft and audits', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    const calls = mockAdmin();
    const res = await createPost(
      req({ slug: 'about', content: { blocks: [{ type: 'text', body: 'hi' }] } }),
    );
    expect(res.status).toBe(201);
    expect(calls.audit.length).toBe(1);
  });

  it('saves validated drafts only', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin({ pageSingle: { id: 'p1' } });
    const bad = await saveDraft(req({ content: { blocks: [{ type: 'text', body: '<b>x</b>' }] } }), pageCtx('p1'));
    expect(bad.status).toBe(400);
    const good = await saveDraft(req({ content: { blocks: [{ type: 'text', body: 'hello' }] } }), pageCtx('p1'));
    expect(good.status).toBe(201);
  });

  it('publishes with pointer move and archive; stale editors get 409', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin({
      pageSingle: { id: 'p1', published_revision_id: 'rev-old' },
      revisionSingle: { id: 'rev-new', content: { blocks: [{ type: 'text', body: 'v2' }] }, status: 'draft' },
    });
    const okRes = await publishPost(
      req({ revision_id: 'rev-new', expected_current_revision_id: 'rev-old' }),
      pageCtx('p1'),
    );
    expect(okRes.status).toBe(200);

    const stale = await publishPost(
      req({ revision_id: 'rev-new', expected_current_revision_id: 'rev-ancient' }),
      pageCtx('p1'),
    );
    expect(stale.status).toBe(409);
  });

  it('refuses to publish revisions that no longer validate', async () => {
    vi.mocked(requirePlatformAdmin).mockResolvedValue(OPERATOR);
    mockAdmin({
      pageSingle: { id: 'p1', published_revision_id: null },
      revisionSingle: { id: 'rev-x', content: { blocks: [{ type: 'carousel' }] }, status: 'draft' },
    });
    const res = await publishPost(req({ revision_id: 'rev-x' }), pageCtx('p1'));
    expect(res.status).toBe(400);
  });
});
