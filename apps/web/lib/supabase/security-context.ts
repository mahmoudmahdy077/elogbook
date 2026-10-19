import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { UserRole } from './auth';
import { createServerSupabase } from './server';

export type Aal = 'aal1' | 'aal2';
export type SecurityDenialReason =
  | 'unauthenticated'
  | 'session_required'
  | 'session_unavailable'
  | 'session_mismatch'
  | 'profile_not_found'
  | 'profile_unavailable'
  | 'invalid_profile'
  | 'account_inactive'
  | 'tenant_not_found'
  | 'tenant_unavailable'
  | 'invalid_tenant'
  | 'tenant_inactive'
  | 'aal1_required'
  | 'aal2_required'
  | 'server_unavailable';

export type SecurityContext = {
  user: User;
  profile: {
    id: string;
    tenant_id: string;
    user_id?: string;
    role: UserRole;
    status: 'active';
    full_name?: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    status: 'active';
  };
  aal: Aal | null;
};

export type SecurityContextResult =
  | { ok: true; context: SecurityContext }
  | { ok: false; reason: SecurityDenialReason; status: 401 | 403 | 500 };

export type SecurityContextOptions = {
  requiredAal?: Aal;
};

const USER_ROLES: readonly UserRole[] = [
  'resident',
  'supervisor',
  'director',
  'institution_admin',
  'admin',
];

function deny(
  reason: SecurityDenialReason,
  status: 401 | 403 | 500,
): Extract<SecurityContextResult, { ok: false }> {
  return { ok: false, reason, status };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isAal(value: unknown): value is Aal {
  return value === 'aal1' || value === 'aal2';
}

function isNotFoundError(error: unknown): boolean {
  const record = asRecord(error);
  return record?.code === 'PGRST116' || record?.status === 404;
}

function meetsAal(actual: Aal | null, required: Aal): boolean {
  if (required === 'aal1') return actual !== null;
  return actual === 'aal2';
}

function readAalFromJwt(accessToken: string): Aal | null {
  const payloadSegment = accessToken.split('.')[1];
  if (!payloadSegment) return null;

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = globalThis.atob(padded);
    const payload = JSON.parse(decoded) as unknown;
    const record = asRecord(payload);
    return isAal(record?.aal) ? record.aal : null;
  } catch {
    return null;
  }
}

export async function getServerVerifiedAal(
  supabase: SupabaseClient,
  session: Session | null,
): Promise<Aal | null> {
  const auth = supabase.auth as SupabaseClient['auth'] & {
    mfa?: {
      getAuthenticatorAssuranceLevel?: (jwt: string) => Promise<{
        data?: { currentLevel?: unknown } | null;
        error?: unknown;
      }>;
    };
  };
  const accessToken = session?.access_token;

  if (typeof auth.mfa?.getAuthenticatorAssuranceLevel !== 'function' && process.env.NODE_ENV === 'production') {
    return null;
  }

  if (accessToken && typeof auth.mfa?.getAuthenticatorAssuranceLevel === 'function') {
    try {
      const result = await auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
      if (result.error || !result.data) return null;
      return isAal(result.data.currentLevel) ? result.data.currentLevel : null;
    } catch {
      return null;
    }
  }

  const sessionRecord = asRecord(session);
  const sessionAal = sessionRecord?.aal;
  if (isAal(sessionAal)) return sessionAal;

  return accessToken ? readAalFromJwt(accessToken) : null;
}

function normalizeRole(value: unknown): UserRole | null {
  return USER_ROLES.includes(value as UserRole) ? value as UserRole : null;
}

function isSupabaseClient(value: unknown): value is SupabaseClient {
  const record = asRecord(value);
  return record !== null && 'auth' in record && 'from' in record;
}

export async function getSecurityContext(
  clientOrOptions?: SupabaseClient | SecurityContextOptions,
  options: SecurityContextOptions = {},
): Promise<SecurityContextResult> {
  let client: SupabaseClient;
  let resolvedOptions: SecurityContextOptions;
  try {
    if (isSupabaseClient(clientOrOptions)) {
      client = clientOrOptions;
      resolvedOptions = options;
    } else {
      client = await createServerSupabase();
      resolvedOptions = clientOrOptions ?? options;
    }
  } catch {
    return deny('server_unavailable', 500);
  }

  let user: User | null;
  try {
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) return deny('unauthenticated', 401);
    user = result.data.user;
  } catch {
    return deny('unauthenticated', 401);
  }

  let session: Session | null = null;
  const getSession = client.auth.getSession;
  if (typeof getSession === 'function') {
    try {
      const result = await getSession.call(client.auth);
      if (result.error) return deny('session_unavailable', 401);
      session = result.data.session;
      if (session?.user?.id && session.user.id !== user.id) {
        return deny('session_mismatch', 401);
      }
    } catch {
      return deny('session_unavailable', 401);
    }
  } else {
    return deny('session_required', 401);
  }

  if (!session) return deny('session_required', 401);

  const aal = await getServerVerifiedAal(client, session);
  if (resolvedOptions.requiredAal && !meetsAal(aal, resolvedOptions.requiredAal)) {
    return deny(resolvedOptions.requiredAal === 'aal2' ? 'aal2_required' : 'aal1_required', 403);
  }

  let profile: Record<string, unknown> | null;
  try {
    const result = await client
      .from('profiles')
      .select('id, tenant_id, user_id, role, status, full_name')
      .eq('user_id', user.id)
      .single();
    if (result.error) {
      const notFound = isNotFoundError(result.error);
      return deny(notFound ? 'profile_not_found' : 'profile_unavailable', notFound ? 403 : 500);
    }
    profile = asRecord(result.data);
  } catch {
    return deny('profile_unavailable', 500);
  }

  if (!profile) return deny('profile_not_found', 403);

  const profileId = asNonEmptyString(profile.id);
  const tenantId = asNonEmptyString(profile.tenant_id);
  const role = normalizeRole(profile.role);
  if (!profileId || !tenantId || !role) return deny('invalid_profile', 403);
  if (profile.status !== 'active') return deny('account_inactive', 403);
  if (profile.user_id !== undefined && profile.user_id !== user.id) {
    return deny('invalid_profile', 403);
  }

  let tenant: Record<string, unknown> | null;
  try {
    const result = await client
      .from('tenants')
      .select('id, slug, status')
      .eq('id', tenantId)
      .single();
    if (result.error) {
      const notFound = isNotFoundError(result.error);
      return deny(notFound ? 'tenant_not_found' : 'tenant_unavailable', notFound ? 403 : 500);
    }
    tenant = asRecord(result.data);
  } catch {
    return deny('tenant_unavailable', 500);
  }

  if (!tenant) return deny('tenant_not_found', 403);

  const resolvedTenantId = asNonEmptyString(tenant.id) ?? tenantId;
  const tenantSlug = asNonEmptyString(tenant.slug);
  if (!resolvedTenantId || !tenantSlug) return deny('invalid_tenant', 403);
  if (tenant.status !== 'active') return deny('tenant_inactive', 403);

  return {
    ok: true,
    context: {
      user,
      profile: {
        id: profileId,
        tenant_id: tenantId,
        ...(typeof profile.user_id === 'string' ? { user_id: profile.user_id } : {}),
        role,
        status: 'active',
        ...(typeof profile.full_name === 'string' ? { full_name: profile.full_name } : {}),
      },
      tenant: {
        id: resolvedTenantId,
        slug: tenantSlug,
        status: 'active',
      },
      aal,
    },
  };
}
