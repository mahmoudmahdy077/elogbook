/**
 * Shared stubs for control-plane route tests.
 *
 * These build the minimum Supabase client surface that
 * `requirePlatformAdmin` (and the audit insert that follows it) touches, so the
 * routes can be exercised against the REAL guard: registry membership, live
 * profile status, and server-verified AAL are all decided by production code
 * rather than by a mocked return value.
 *
 * The module deliberately contains no `vi.mock` calls — vitest hoists those to
 * the importing test file. See `control-plane-authorization.test.ts` for the
 * static source assertions that keep the routes honest between runs.
 */

export type PrincipalSpec = {
  userId?: string | null;
  profile?: Record<string, unknown> | null;
  registryRow?: Record<string, unknown> | null;
  /** Server-verified authenticator assurance level. `null` = no session. */
  aal?: string | null;
  factors?: { status: string }[];
};

export type AuditRow = Record<string, unknown>;

const ACCESS_TOKEN = 'header.payload.signature';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A server (cookie-bound) Supabase client stub.
 *
 * `auth.mfa.getAuthenticatorAssuranceLevel` is present so the guard exercises
 * the server-verified AAL path rather than trusting `session.aal`.
 */
export function buildServerClientStub(spec: PrincipalSpec): unknown {
  const profile = spec.profile === undefined
    ? { id: 'profile-uuid-0000-0000-000000000001', tenant_id: 'tenant-uuid-0000-0000-0000000000a1', status: 'active' }
    : spec.profile;
  const aal = spec.aal === undefined ? 'aal2' : spec.aal;
  const factors = spec.factors === undefined ? [{ status: 'verified' }] : spec.factors;
  const userId = spec.userId === undefined ? 'operator-user-uuid' : spec.userId;
  const session = aal === null || userId === null
    ? null
    : { access_token: ACCESS_TOKEN, aal, user: { id: userId } };

  return {
    auth: {
      getUser: async () => ({ data: { user: userId === null ? null : { id: userId } }, error: null }),
      getSession: async () => ({ data: { session }, error: null }),
      mfa: {
        listFactors: async () => ({ data: { all: factors }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: aal }, error: null }),
      },
    },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table read: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: profile, error: null }),
          }),
        }),
      };
    },
  };
}

/**
 * A service-role client stub. `platform_admins` lookups are served from
 * `registryRow`; every `audit_logs` insert is pushed to `auditRows` so tests can
 * assert the payload contains no secrets and no cross-tenant identifiers.
 */
export function buildServiceRoleStub(spec: PrincipalSpec, auditRows: AuditRow[]): unknown {
  const registryRow = spec.registryRow === undefined
    ? { user_id: spec.userId === undefined ? 'operator-user-uuid' : spec.userId, status: 'active' }
    : spec.registryRow;

  return {
    from: (table: string) => {
      if (table === 'platform_admins') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: registryRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (row: AuditRow) => {
            if (isRecord(row)) auditRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected service-role table write: ${table}`);
    },
  };
}

/** A platform operator that satisfies every guard check. */
export function operatorSpec(overrides: PrincipalSpec = {}): PrincipalSpec {
  return {
    userId: 'operator-user-uuid',
    profile: {
      id: 'profile-uuid-0000-0000-000000000001',
      tenant_id: 'tenant-uuid-0000-0000-0000000000a1',
      status: 'active',
      role: 'resident',
    },
    registryRow: { user_id: 'operator-user-uuid', status: 'active' },
    aal: 'aal2',
    factors: [{ status: 'verified' }],
    ...overrides,
  };
}

/** A tenant administrator: active profile, privileged role label, no registry row. */
export function tenantAdminSpec(overrides: PrincipalSpec = {}): PrincipalSpec {
  return operatorSpec({
    profile: {
      id: 'profile-uuid-0000-0000-0000000000ff',
      tenant_id: 'tenant-uuid-0000-0000-0000000000bb',
      status: 'active',
      role: 'admin',
    },
    registryRow: null,
    ...overrides,
  });
}
