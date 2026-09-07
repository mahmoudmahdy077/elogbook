import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }));

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '../require-platform-admin';

// T17: platform authority comes ONLY from the platform_admins registry —
// never from a tenant role label — with live account status and AAL2.
describe('requirePlatformAdmin (T17)', () => {
  const OLD_DISABLE = process.env.DISABLE_MFA;

  function mockSupabase(opts: {
    userId: string | null;
    profile?: Record<string, unknown> | null;
    aal?: string | null;
    factors?: { status: string }[];
    registry?: Record<string, unknown> | null;
  }) {
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.registry ?? null, error: null }),
          }),
        }),
      }),
    } as never);
    return {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } })),
        getSession: vi.fn(async () => ({
          data: { session: opts.aal ? { aal: opts.aal, user: { id: opts.userId } } : null },
        })),
        mfa: {
          listFactors: vi.fn(async () => ({ data: { all: opts.factors ?? [] } })),
        },
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: opts.profile ?? null, error: null })),
          })),
        })),
      })),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_MFA;
  });

  afterEach(() => {
    if (OLD_DISABLE === undefined) delete process.env.DISABLE_MFA;
    else process.env.DISABLE_MFA = OLD_DISABLE;
  });

  const ACTIVE_PROFILE = { id: 'p1', status: 'active' };
  const OPERATOR = { user_id: 'u1', status: 'active' };
  const AAL2 = { aal: 'aal2', factors: [{ status: 'verified' }] };

  it('allows an active operator at AAL2', async () => {
    const supabase = mockSupabase({ userId: 'u1', profile: ACTIVE_PROFILE, registry: OPERATOR, ...AAL2 });
    const res = await requirePlatformAdmin(supabase as never);
    expect(res.ok).toBe(true);
  });

  it('denies tenant admins with no registry row (role label confers nothing)', async () => {
    const supabase = mockSupabase({ userId: 'u1', profile: ACTIVE_PROFILE, registry: null, ...AAL2 });
    const res = await requirePlatformAdmin(supabase as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('denies suspended operators and inactive profiles', async () => {
    const suspended = mockSupabase({
      userId: 'u1',
      profile: ACTIVE_PROFILE,
      registry: { ...OPERATOR, status: 'suspended' },
      ...AAL2,
    });
    expect((await requirePlatformAdmin(suspended as never)).ok).toBe(false);

    const inactive = mockSupabase({
      userId: 'u1',
      profile: { ...ACTIVE_PROFILE, status: 'suspended' },
      registry: OPERATOR,
      ...AAL2,
    });
    expect((await requirePlatformAdmin(inactive as never)).ok).toBe(false);
  });

  it('denies below AAL2 and requires enrollment', async () => {
    const aal1 = mockSupabase({
      userId: 'u1',
      profile: ACTIVE_PROFILE,
      registry: OPERATOR,
      aal: 'aal1',
      factors: [{ status: 'verified' }],
    });
    const r1 = await requirePlatformAdmin(aal1 as never);
    expect(r1.ok).toBe(false);

    const unenrolled = mockSupabase({
      userId: 'u1',
      profile: ACTIVE_PROFILE,
      registry: OPERATOR,
      aal: 'aal1',
      factors: [],
    });
    const r2 = await requirePlatformAdmin(unenrolled as never);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/MFA/i);
  });

  it('denies anonymous callers with 401', async () => {
    const supabase = mockSupabase({ userId: null });
    const res = await requirePlatformAdmin(supabase as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('honors DISABLE_MFA=true for local development only', async () => {
    process.env.DISABLE_MFA = 'true';
    const supabase = mockSupabase({ userId: 'u1', profile: ACTIVE_PROFILE, registry: OPERATOR });
    expect((await requirePlatformAdmin(supabase as never)).ok).toBe(true);
  });
});
