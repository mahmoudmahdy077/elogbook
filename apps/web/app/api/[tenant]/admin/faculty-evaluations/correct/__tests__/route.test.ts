import { beforeEach, describe, expect, it, vi } from 'vitest';

// A faculty evaluation's scores are write-once: the only supported way to change
// one is the correction command, which needs a live AAL2 privileged principal, a
// stated reason, and an append-only record. That command has no UI here, so the
// route that reaches it is new.
//
// What this suite pins about the route is the boundary it owns: it must not be a
// thinner door than the command. Every rejection the command makes has to survive
// the trip, a database failure must not become a stack trace, and the request
// shape must be closed rather than forwarded wholesale.

const state = vi.hoisted(() => ({
  security: null as unknown,
  rateLimit: { allowed: true, retryAfter: 0 },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: null as unknown, error: null as unknown },
}));

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => client) }));

vi.mock('@/lib/supabase/require-admin', () => ({
  requireTenantAdmin: vi.fn(async () => state.security),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => state.rateLimit),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const mockValidateOrigin = vi.fn<(request: Request) => unknown>().mockReturnValue(null);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: (request: Request) => mockValidateOrigin(request),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

const client = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ fn, args });
    return state.rpcResult;
  }),
};

import { POST, CORRECTION_ROLES } from '../route';

const TENANT = 'tenant-1-uuid';
const EVALUATION = '11111111-2222-4333-8444-555555555555';

const DIRECTOR = {
  ok: true as const,
  profile: { id: 'director-profile', tenant_id: TENANT, user_id: 'director-user', role: 'director' },
  user: { id: 'director-user' },
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/tenant-a/admin/faculty-evaluations/correct`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.elogbook.dev', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function params() {
  return { params: Promise.resolve({ tenant: 'tenant-a' }) };
}

function call(body: unknown) {
  return POST(post(body), params());
}

function rpcCall() {
  return state.rpcCalls.find((entry) => entry.fn === 'correct_faculty_evaluation');
}

beforeEach(() => {
  state.security = DIRECTOR;
  state.rateLimit = { allowed: true, retryAfter: 0 };
  state.rpcCalls = [];
  state.rpcResult = {
    data: { success: true, correction_id: 'c-1', replayed: false },
    error: null,
  };
  mockValidateOrigin.mockReturnValue(null);
  vi.clearAllMocks();
});

describe('faculty evaluation correction', () => {
  it('requires a privileged role, not just an authenticated session', async () => {
    state.security = {
      ok: false as const,
      error: 'Insufficient permissions',
      status: 403 as const,
    };
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
    });

    expect(response.status).toBe(403);
    expect(rpcCall()).toBeUndefined();
  });

  it('admits exactly the roles the command admits', () => {
    expect([...CORRECTION_ROLES].sort()).toEqual([
      'admin',
      'director',
      'institution_admin',
      'supervisor',
    ]);
  });

  it('forwards the correction to the command scoped to the caller tenant', async () => {
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
      idempotency_key: 'corr-key-1',
    });

    expect(response.status).toBe(200);
    const args = rpcCall()!.args;
    expect(args.p_tenant_id).toBe(TENANT);
    expect(args.p_evaluation_id).toBe(EVALUATION);
    expect(args.p_reason).toBe('score entered against the wrong criterion');
    expect(args.p_correction).toEqual({ clinical_skills: 5 });
    expect(args.p_idempotency_key).toBe('corr-key-1');
  });

  it('refuses a request with no reason before it reaches the command', async () => {
    for (const reason of [undefined, '', '   ', 'typo']) {
      const response = await call({
        evaluation_id: EVALUATION,
        reason,
        correction: { clinical_skills: 5 },
      });

      expect(response.status, `reason ${JSON.stringify(reason)} must be refused`).toBe(400);
    }
    expect(rpcCall()).toBeUndefined();
  });

  it('refuses a correction with no evaluation id', async () => {
    const response = await call({
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
    });
    expect(response.status).toBe(400);
    expect(rpcCall()).toBeUndefined();
  });

  it('refuses an empty correction', async () => {
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: {},
    });
    expect(response.status).toBe(400);
    expect(rpcCall()).toBeUndefined();
  });

  it('refuses a score outside the documented 1-5 range', async () => {
    for (const clinical_skills of [0, 6, -1, 2.5]) {
      const response = await call({
        evaluation_id: EVALUATION,
        reason: 'score entered against the wrong criterion',
        correction: { clinical_skills },
      });
      expect(response.status, `score ${clinical_skills} must be refused`).toBe(400);
    }
    expect(rpcCall()).toBeUndefined();
  });

  it('refuses a key the correction path does not own', async () => {
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
      resident_id: 'someone-else',
    });
    expect(response.status).toBe(400);
    expect(rpcCall()).toBeUndefined();
  });

  it('refuses a body that is not JSON', async () => {
    const response = await POST(
      post('not json', { 'content-type': 'application/json' }),
      params()
    );
    expect(response.status).toBe(400);
    expect(rpcCall()).toBeUndefined();
  });

  it('maps a refusal from the command to a refusal at the route', async () => {
    const cases: Array<[string, number]> = [
      ['forbidden', 403],
      ['evaluation_not_found', 404],
      ['reason_required', 400],
      ['invalid_request', 400],
      ['idempotency_conflict', 409],
    ];

    for (const [code, status] of cases) {
      state.rpcCalls = [];
      state.rpcResult = { data: { success: false, error: code }, error: null };
      const response = await call({
        evaluation_id: EVALUATION,
        reason: 'score entered against the wrong criterion',
        correction: { clinical_skills: 5 },
      });
      expect(response.status, `code ${code} must map to ${status}`).toBe(status);
    }
  });

  it('does not echo a database error to the caller', async () => {
    state.rpcResult = {
      data: null,
      error: { message: 'duplicate key value violates unique constraint "faculty_evaluation_corrections_tenant_id_idempotency_key_key"' },
    };
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
    });

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('faculty_evaluation_corrections');
    expect(body).not.toContain('unique constraint');
  });

  it('rate limits the command', async () => {
    state.rateLimit = { allowed: false, retryAfter: 30 };
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
    });
    expect(response.status).toBe(429);
    expect(rpcCall()).toBeUndefined();
  });

  it('rejects a cross-origin state change', async () => {
    mockValidateOrigin.mockReturnValue(
      new Response(JSON.stringify({ error: 'Origin not allowed' }), { status: 403 })
    );
    const response = await call({
      evaluation_id: EVALUATION,
      reason: 'score entered against the wrong criterion',
      correction: { clinical_skills: 5 },
    });
    expect(response.status).toBe(403);
    expect(rpcCall()).toBeUndefined();
  });
});
