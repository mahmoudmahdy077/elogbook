import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => {
  const state = {
    tables: [] as string[],
    inserted: [] as { table: string; values: Record<string, unknown> }[],
    inviteInsertError: null as unknown,
    emailQueueError: null as unknown,
    auditError: null as unknown,
    lastServiceClient: null as unknown,
  };

  function queryFor(table: string) {
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn(async () =>
      table === 'tenant_invites'
        ? state.inviteInsertError
          ? { data: null, error: state.inviteInsertError }
          : { data: { id: 'invite-id' }, error: null }
        : { data: null, error: null },
    );
    query.insert = vi.fn((values: unknown) => {
      state.inserted.push({ table, values: values as Record<string, unknown> });
      if (table === 'tenant_invites') {
        return { select: vi.fn(() => query) };
      }
      return Promise.resolve({ error: table === 'email_queue' ? state.emailQueueError : state.auditError });
    });
    query.delete = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    return query;
  }

  function serviceClient() {
    const client = {
      from: vi.fn((table: string) => {
        state.tables.push(table);
        return queryFor(table);
      }),
      auth: {
        admin: {
          inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: 'x' } }, error: null })),
          deleteUser: vi.fn(async () => ({ data: {}, error: null })),
        },
      },
    };
    state.lastServiceClient = client;
    return client;
  }

  return {
    state,
    serviceClient,
    createServerSupabase: vi.fn(),
    requireTenantAdmin: vi.fn(),
    checkRateLimit: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: mocks.requireTenantAdmin,
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => mocks.serviceClient(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError, warn: vi.fn() },
}));

function request(body: unknown = {
  email: 'invitee@example.test',
  full_name: 'Invitee',
  role: 'supervisor',
}) {
  return new Request('http://localhost:3000/api/tenant-a/admin/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  });
}

function insertedFor(table: string) {
  return mocks.state.inserted.filter((row) => row.table === table);
}

function tokenFromQueuedLink(payload: Record<string, unknown>): string {
  const link = String(payload.onboarding_url ?? '');
  return new URL(link).searchParams.get('invitation') ?? '';
}

describe('tenant admin invitation issuance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.tables.length = 0;
    mocks.state.inserted.length = 0;
    mocks.state.inviteInsertError = null;
    mocks.state.emailQueueError = null;
    mocks.state.auditError = null;
    mocks.state.lastServiceClient = null;
    mocks.createServerSupabase.mockResolvedValue({});
    mocks.requireTenantAdmin.mockResolvedValue({
      ok: true,
      profile: { tenant_id: 'tenant-id', role: 'admin' },
      user: { id: 'admin-user' },
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  });

  it('stores only a digest of the invitation token', async () => {
    const { POST } = await import('../invite/route');

    const res = await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });
    const raw = await res.text();

    expect(res.status).toBe(201);
    const invite = insertedFor('tenant_invites')[0];
    const tokenHash = String(invite.values.token_hash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(invite.values.token);
    expect(raw).not.toContain(tokenHash);
    // The queued link carries the raw token; the digest must not match it.
    const queued = insertedFor('email_queue')[0];
    const token = tokenFromQueuedLink(queued.values.payload as Record<string, unknown>);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash('sha256').update(token, 'utf8').digest('hex')).toBe(tokenHash);
  });

  it('binds the invitation to the admin own tenant and the invited role', async () => {
    const { POST } = await import('../invite/route');

    await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    const invite = insertedFor('tenant_invites')[0];
    expect(invite.values.tenant_id).toBe('tenant-id');
    expect(invite.values.role).toBe('supervisor');
    expect(invite.values.email).toBe('invitee@example.test');
    expect(invite.values.invited_by).toBe('admin-user');
    expect(invite.values.status).toBe('pending');
  });

  it('sets a bounded expiry so an invitation cannot live forever', async () => {
    const { POST } = await import('../invite/route');

    await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    const invite = insertedFor('tenant_invites')[0];
    const expiresAt = new Date(String(invite.values.expires_at)).getTime();
    const now = Date.now();
    expect(expiresAt).toBeGreaterThan(now);
    expect(expiresAt).toBeLessThanOrEqual(now + 72 * 60 * 60 * 1000 + 5000);
  });

  it('queues only safe link material and never the token in a separate field', async () => {
    const { POST } = await import('../invite/route');

    await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    const queued = insertedFor('email_queue')[0];
    expect(queued.values.template_key).toBe('invite.welcome');
    expect(queued.values.to_email).toBe('invitee@example.test');
    expect(queued.values.tenant_id).toBe('tenant-id');
    const payload = queued.values.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['onboarding_url', 'role']);
    expect(payload.role).toBe('supervisor');
    expect(String(payload.onboarding_url)).toMatch(/^https?:\/\/[^/]+\/signup\?invitation=[A-Za-z0-9_-]{43}$/);
  });

  it('never creates the auth identity so redemption stays token-gated', async () => {
    const { POST } = await import('../invite/route');

    await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    const client = mocks.state.lastServiceClient as {
      auth: { admin: { inviteUserByEmail: ReturnType<typeof vi.fn> } };
    };
    expect(client.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('returns no secret material on success', async () => {
    const { POST } = await import('../invite/route');

    const res = await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    expect(await res.json()).toEqual({ success: true });
  });

  it('removes the invitation when the email cannot be queued', async () => {
    mocks.state.emailQueueError = new Error('queue unavailable');
    const { POST } = await import('../invite/route');

    const res = await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    expect(res.status).toBe(502);
    expect(mocks.state.tables.filter((table) => table === 'tenant_invites')).toHaveLength(2);
  });

  it('removes the invitation when the audit record cannot be written', async () => {
    mocks.state.auditError = new Error('audit unavailable');
    const { POST } = await import('../invite/route');

    const res = await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    expect(res.status).toBe(500);
    expect(mocks.state.tables.filter((table) => table === 'tenant_invites')).toHaveLength(2);
  });

  it('fails closed when the invitation row cannot be created', async () => {
    mocks.state.inviteInsertError = new Error('insert rejected');
    const { POST } = await import('../invite/route');

    const res = await POST(request(), { params: Promise.resolve({ tenant: 'tenant-a' }) });

    expect(res.status).toBe(500);
    expect(insertedFor('email_queue')).toHaveLength(0);
  });
});
