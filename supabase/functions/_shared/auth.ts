import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const DEFAULT_ORIGINS = [
  'https://elogbook.dev',
  'https://app.elogbook.dev',
  'http://localhost:3000',
  'http://localhost:19006',
  'http://localhost:8081',
];

const ALLOWED_ORIGINS: string[] = (() => {
  const env = Deno.env.get('ALLOWED_ORIGINS');
  if (env) return env.split(',').map((o) => o.trim());
  return DEFAULT_ORIGINS;
})();

type EdgeSupabaseClient = ReturnType<typeof createClient>;

export type AuthAal = 'aal1' | 'aal2';

const PRINCIPAL_ROLES = new Set(['resident', 'supervisor', 'director', 'institution_admin', 'admin']);

export interface AuthoritativePrincipal {
  userId: string;
  profileId: string;
  tenantId: string;
  role: string;
  profileStatus: string;
  tenantStatus: string;
  aal: AuthAal;
}

export interface PrincipalLookupResponse {
  data?: unknown;
  error?: unknown;
}

export interface PrincipalLookupClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<PrincipalLookupResponse>;
}

export interface AuthResult {
  supabase: EdgeSupabaseClient;
  user: NonNullable<Awaited<ReturnType<ReturnType<typeof createClient>['auth']['getUser']>>['data']['user']>;
  tenantId: string;
  role: string;
  aal: AuthAal;
  principal: AuthoritativePrincipal;
}

function principalRecord(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function principalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseAuthoritativePrincipal(data: unknown, authUserId: string): AuthoritativePrincipal | null {
  const record = principalRecord(data);
  if (!record || !authUserId) return null;
  const userId = principalString(record, 'user_id');
  const profileId = principalString(record, 'profile_id');
  const tenantId = principalString(record, 'tenant_id');
  const role = principalString(record, 'role');
  const profileStatus = principalString(record, 'profile_status');
  const tenantStatus = principalString(record, 'tenant_status');
  const aal = principalString(record, 'aal');
  if (!userId || userId !== authUserId || !profileId || !tenantId || !role || !profileStatus || !tenantStatus) return null;
  if (aal !== 'aal1' && aal !== 'aal2') return null;
  return { userId, profileId, tenantId, role, profileStatus, tenantStatus, aal };
}

export async function resolveAuthoritativePrincipal(
  client: PrincipalLookupClient,
  authUserId: string,
): Promise<AuthoritativePrincipal | null> {
  try {
    const result = await client.rpc('get_authoritative_principal_with_aal');
    if (result.error) return null;
    return parseAuthoritativePrincipal(result.data, authUserId);
  } catch {
    return null;
  }
}

export async function getServerVerifiedAal(
  supabase: EdgeSupabaseClient,
): Promise<AuthAal | null> {
  const auth = supabase.auth as typeof supabase.auth & {
    mfa?: {
      getAuthenticatorAssuranceLevel?: () => Promise<{
        data?: { currentLevel?: unknown } | null;
        error?: unknown;
      }>;
    };
  };
  const getAssurance = auth.mfa?.getAuthenticatorAssuranceLevel;
  if (typeof getAssurance !== 'function') return null;
  try {
    const result = await getAssurance.call(auth.mfa);
    if (result.error || !result.data) return null;
    return result.data.currentLevel === 'aal1' || result.data.currentLevel === 'aal2'
      ? result.data.currentLevel
      : null;
  } catch {
    return null;
  }
}

export interface PrincipalRequirements {
  roles?: readonly string[];
  aal?: AuthAal;
  tenantId?: string;
}

export type PrincipalDecision =
  | { ok: true; principal: AuthoritativePrincipal }
  | { ok: false; response: Response };

export type Authenticator = (request: Request) => Promise<AuthResult | Response>;

function forbiddenResponse(): Response {
  return new Response(
    JSON.stringify({ error: 'Forbidden' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}

export function authorizePrincipal(
  principal: AuthoritativePrincipal,
  requirements: PrincipalRequirements = {},
): PrincipalDecision {
  if (principal.profileStatus !== 'active' || principal.tenantStatus !== 'active') {
    return { ok: false, response: forbiddenResponse() };
  }
  if (!PRINCIPAL_ROLES.has(principal.role)) {
    return { ok: false, response: forbiddenResponse() };
  }
  if (requirements.roles && !requirements.roles.includes(principal.role)) {
    return { ok: false, response: forbiddenResponse() };
  }
  if (requirements.aal === 'aal2' && principal.aal !== 'aal2') {
    return { ok: false, response: forbiddenResponse() };
  }
  if (requirements.tenantId && requirements.tenantId !== principal.tenantId) {
    return { ok: false, response: forbiddenResponse() };
  }
  return { ok: true, principal };
}

export async function requirePrincipal(
  request: Request,
  requirements: PrincipalRequirements = {},
  authenticator: Authenticator = authenticate,
): Promise<AuthResult | Response> {
  const result = await authenticator(request);
  if (result instanceof Response) return result;
  const decision = authorizePrincipal(result.principal, requirements);
  return decision.ok ? result : decision.response;
}

function getEnvVars(): { url: string; anonKey: string; serviceRoleKey: string } {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, anonKey, serviceRoleKey };
}

export async function authenticate(request: Request): Promise<AuthResult | Response> {
  let envVars: { url: string; anonKey: string; serviceRoleKey: string };
  try {
    envVars = getEnvVars();
  } catch (_error) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.slice(7);

  const supabase = createClient(envVars.url, envVars.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid or expired token' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const principal = await resolveAuthoritativePrincipal(
    supabase as unknown as PrincipalLookupClient,
    user.id,
  );

  if (!principal) {
    return forbiddenResponse();
  }

  const decision = authorizePrincipal(principal);
  if (!decision.ok) return decision.response;

  return {
    supabase: supabase as EdgeSupabaseClient,
    user,
    tenantId: principal.tenantId,
    role: principal.role,
    aal: principal.aal,
    principal,
  };
}

export { ALLOWED_ORIGINS };

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.some((o) => origin === o)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}