import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => {
  const state = {
    inviteRow: null as Record<string, unknown> | null,
    inviteLookupError: null as unknown,
    inviteAuthError: null as unknown,
    inviteAuthData: { user: { id: 'created-user' } } as { user: { id: string } } | null,
    lastClient: null as unknown,
    lastInviteChain: null as Record<string, unknown> | null,
    fromCalls: [] as string[],
  };

  const buildClient = () => {
    const client = {
      from: vi.fn((table: string) => {
        state.fromCalls.push(table);
        if (table === 'tenant_invites') {
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn(() => chain);
          chain.eq = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () =>
            state.inviteLookupError
              ? { data: null, error: state.inviteLookupError }
              : { data: state.inviteRow, error: null },
          );
          state.lastInviteChain = chain;
          return chain;
        }
        throw new Error(`unexpected table ${table}`);
      }),
      auth: {
        admin: {
          inviteUserByEmail: vi.fn(async () => ({
            data: state.inviteAuthData,
            error: state.inviteAuthError,
          })),
          deleteUser: vi.fn(async () => ({ data: {}, error: null })),
        },
      },
    };
    state.lastClient = client;
    return client;
  };

  return {
    state,
    buildClient,
    checkRateLimit: vi.fn(),
    rateLimitResponse: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => mocks.buildClient(),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));

const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
const NOW = new Date();

function validInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    tenant_id: 'tenant-a',
    email: 'invitee@example.test',
    role: 'supervisor',
    status: 'pending',
    expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function acceptRequest(body: unknown) {
  return new Request('http://localhost:3000/api/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

type AuthAdminMock = {
  from: ReturnType<typeof vi.fn>;
  auth: {
    admin: {
      inviteUserByEmail: ReturnType<typeof vi.fn>;
      deleteUser: ReturnType<typeof vi.fn>;
    };
  };
};

describe('POST /api/invitations/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.inviteRow = validInvite();
    mocks.state.inviteLookupError = null;
    mocks.state.inviteAuthError = null;
    mocks.state.inviteAuthData = { user: { id: 'created-user' } };
    mocks.state.fromCalls.length = 0;
    mocks.state.lastInviteChain = null;
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  });

  it('looks the invitation up by digest, never by the raw token', async () => {
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(201);
    const chain = mocks.state.lastInviteChain as {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    expect(chain.select).toHaveBeenCalledWith('id, tenant_id, email, role, status, expires_at');
    expect(chain.eq).toHaveBeenCalledWith('token_hash', TOKEN_HASH);
    expect(JSON.stringify(chain.eq.mock.calls)).not.toContain(TOKEN);
    expect(mocks.state.fromCalls).toEqual(['tenant_invites']);
  });

  it('sends the tenant-scoped auth invite and returns no secret material', async () => {
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );
    const raw = await res.text();

    expect(res.status).toBe(201);
    expect(JSON.parse(raw)).toEqual({ success: true });
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(TOKEN_HASH);
    const client = mocks.state.lastClient as AuthAdminMock;
    expect(client.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      'invitee@example.test',
      expect.objectContaining({ redirectTo: expect.stringContaining('/auth/callback') }),
    );
  });

  it('refuses an expired invitation with 410', async () => {
    mocks.state.inviteRow = validInvite({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(410);
    const client = mocks.state.lastClient as AuthAdminMock;
    expect(client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('refuses a second redemption of the same invitation with 409', async () => {
    mocks.state.inviteRow = validInvite({ status: 'accepted' });
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(409);
    const client = mocks.state.lastClient as AuthAdminMock;
    expect(client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('refuses an unknown token with a coarse 404', async () => {
    mocks.state.inviteRow = null;
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Invitation not found' });
  });

  it('refuses an unknown email without revealing which addresses are invited', async () => {
    mocks.state.inviteRow = validInvite();
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'someone-else@example.test' }), );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Invitation not found' });
    const client = mocks.state.lastClient as AuthAdminMock;
    expect(client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('refuses a structurally invalid token without a database round-trip', async () => {
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: 'short', email: 'invitee@example.test' }), );

    expect(res.status).toBe(400);
    expect(mocks.state.fromCalls).toEqual([]);
  });

  it('rejects a caller-supplied tenant so redemption cannot cross tenants', async () => {
    const { POST } = await import('../accept/route');

    const res = await POST(
      acceptRequest({ token: TOKEN, email: 'invitee@example.test', tenant_id: 'tenant-b' }),
    );

    expect(res.status).toBe(400);
    expect(mocks.state.fromCalls).toEqual([]);
  });

  it('rejects a caller-supplied role so redemption cannot escalate', async () => {
    const { POST } = await import('../accept/route');

    const res = await POST(
      acceptRequest({ token: TOKEN, email: 'invitee@example.test', role: 'admin' }),
    );

    expect(res.status).toBe(400);
  });

  it('fails closed when the tenant invitation record cannot be read', async () => {
    mocks.state.inviteLookupError = new Error('database unavailable');
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(500);
    const raw = await res.text();
    expect(raw).not.toContain('database unavailable');
  });

  it('fails closed when the auth invite cannot be created', async () => {
    mocks.state.inviteAuthError = new Error('auth unavailable');
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(502);
    const client = mocks.state.lastClient as AuthAdminMock;
    expect(client.auth.admin.deleteUser).toHaveBeenCalledWith('created-user');
  });

  it('rate limits redemption attempts', async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    mocks.rateLimitResponse.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }) as never,
    );
    const { POST } = await import('../accept/route');

    const res = await POST(acceptRequest({ token: TOKEN, email: 'invitee@example.test' }), );

    expect(res.status).toBe(429);
    expect(mocks.state.fromCalls).toEqual([]);
  });
});
