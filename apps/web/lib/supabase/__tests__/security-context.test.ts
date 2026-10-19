import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server', () => ({ createServerSupabase: vi.fn() }));
vi.mock('../admin', () => ({ createServiceRoleClient: vi.fn() }));

import { createServerSupabase } from '../server';
import { createServiceRoleClient } from '../admin';
import { getSecurityContext } from '../security-context';
import { revokeUserSessions, setUserBanned } from '../session-revocation';

type MockOptions = {
  user?: Record<string, unknown> | null;
  session?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
  aal?: 'aal1' | 'aal2' | null;
};

function mockSupabase(options: MockOptions = {}) {
  const user = options.user === undefined ? { id: 'user-1' } : options.user;
  const session = options.session === undefined
    ? { access_token: 'access-token', user: { id: 'user-1' }, aal: options.aal ?? 'aal2' }
    : options.session;
  const profile = options.profile === undefined
    ? {
        id: 'profile-1',
        tenant_id: 'tenant-1',
        user_id: 'user-1',
        role: 'resident',
        status: 'active',
      }
    : options.profile;
  const tenant = options.tenant === undefined
    ? { id: 'tenant-1', slug: 'tenant-one', status: 'active' }
    : options.tenant;

  const from = vi.fn((table: string) => {
    const result = table === 'profiles' ? profile : table === 'tenants' ? tenant : null;
    const single = vi.fn(async () => ({ data: result, error: null }));
    const maybeSingle = vi.fn(async () => ({ data: result, error: null }));
    const eq = vi.fn(() => ({ single, maybeSingle }));
    return { select: vi.fn(() => ({ eq })) };
  });

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: options.aal ?? null, nextLevel: options.aal ?? null },
          error: null,
        })),
      },
    },
    from,
  };
}

describe('getSecurityContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a missing profile', async () => {
    const client = mockSupabase({ profile: null });

    const result = await getSecurityContext(client as never);

    expect(result).toEqual({ ok: false, reason: 'profile_not_found', status: 403 });
  });

  it('denies a missing session', async () => {
    const client = mockSupabase({ session: null });

    const result = await getSecurityContext(client as never);

    expect(result).toEqual({ ok: false, reason: 'session_required', status: 401 });
  });

  it('denies a missing tenant', async () => {
    const client = mockSupabase({ tenant: null });

    const result = await getSecurityContext(client as never);

    expect(result).toEqual({ ok: false, reason: 'tenant_not_found', status: 403 });
  });

  it('denies a suspended profile', async () => {
    const client = mockSupabase({
      profile: { id: 'profile-1', tenant_id: 'tenant-1', role: 'resident', status: 'suspended' },
    });

    const result = await getSecurityContext(client as never);

    expect(result).toEqual({ ok: false, reason: 'account_inactive', status: 403 });
  });

  it('denies a suspended tenant', async () => {
    const client = mockSupabase({
      tenant: { id: 'tenant-1', slug: 'tenant-one', status: 'suspended' },
    });

    const result = await getSecurityContext(client as never);

    expect(result).toEqual({ ok: false, reason: 'tenant_inactive', status: 403 });
  });

  it('denies an AAL1 session for a privileged operation', async () => {
    const client = mockSupabase({ aal: 'aal1' });

    const result = await getSecurityContext(client as never, { requiredAal: 'aal2' });

    expect(result).toEqual({ ok: false, reason: 'aal2_required', status: 403 });
  });

  it('fails closed in production when server MFA assurance is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const client = mockSupabase({ aal: 'aal2' });
    delete (client.auth as { mfa?: unknown }).mfa;

    const result = await getSecurityContext(client as never, { requiredAal: 'aal2' });

    expect(result).toEqual({ ok: false, reason: 'aal2_required', status: 403 });
    vi.unstubAllEnvs();
  });

  it('uses the database role instead of request or client claims', async () => {
    const client = mockSupabase({
      user: { id: 'user-1', app_metadata: { user_role: 'admin' } },
      profile: { id: 'profile-1', tenant_id: 'tenant-1', role: 'resident', status: 'active' },
    });

    const result = await getSecurityContext(client as never, {
      role: 'admin',
    } as never);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.profile.role).toBe('resident');
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it('uses the server Supabase client when no client is supplied', async () => {
    const client = mockSupabase({ aal: 'aal2' });
    vi.mocked(createServerSupabase).mockResolvedValue(client as never);

    const result = await getSecurityContext({ requiredAal: 'aal2' });

    expect(createServerSupabase).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });
});

describe('revokeUserSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests refresh-token revocation without claiming access-token invalidation', async () => {
    const signOut = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { signOut } },
    } as never);

    const result = await revokeUserSessions('access-token', 'global');

    expect(signOut).toHaveBeenCalledWith('access-token', 'global');
    expect(result).toEqual({
      ok: true,
      scope: 'global',
      refreshTokenRevocationRequested: true,
      accessTokenRevoked: false,
    });
  });

  it('fails closed when the admin API returns an error', async () => {
    const signOut = vi.fn(async () => ({ data: null, error: new Error('revoke failed') }));
    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { signOut } },
    } as never);

    const result = await revokeUserSessions('access-token');

    expect(result).toEqual({ ok: false, reason: 'revocation_failed' });
  });
});

describe('setUserBanned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bans and unbans through the Supabase admin API', async () => {
    const updateUserById = vi.fn(async () => ({ data: { id: 'user-1' }, error: null }));
    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { updateUserById } },
    } as never);

    expect(await setUserBanned('user-1', true)).toEqual({ ok: true });
    expect(await setUserBanned('user-1', false)).toEqual({ ok: true });
    expect(updateUserById).toHaveBeenNthCalledWith(1, 'user-1', { ban_duration: '876000h' });
    expect(updateUserById).toHaveBeenNthCalledWith(2, 'user-1', { ban_duration: 'none' });
  });

  it('fails closed when the admin API rejects the ban change', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: new Error('ban failed') }));
    vi.mocked(createServiceRoleClient).mockReturnValue({
      auth: { admin: { updateUserById } },
    } as never);

    expect(await setUserBanned('user-1', true)).toEqual({ ok: false, reason: 'ban_update_failed' });
  });
});
