export type AccountStatus = 'active' | 'suspended' | 'disabled';
export type TenantStatus = 'active' | 'suspended' | 'disabled';
export type DataMode = 'deidentified' | 'identifiable';
export type Aal = 'aal1' | 'aal2';

export interface CapabilitySnapshot {
  userId: string;
  tenantId: string;
  profileId: string;
  role: string;
  status: AccountStatus;
  tenantStatus: TenantStatus;
  policyVersion: number;
  dataMode: DataMode;
  aal: Aal | null;
  expiresAt: number | null;
  fetchedAt: number;
}

export type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
    getSession: () => Promise<{ data: { session: { expires_at?: number } | null } }>;
    mfa?: {
      getAuthenticatorAssuranceLevel?: () => Promise<{
        data?: { currentLevel?: unknown } | null;
        error?: unknown;
      }>;
    };
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

const DEFAULT_FRESH_MS = 5 * 60_000;
const ACCOUNT_STATUSES = ['active', 'suspended', 'disabled'] as const;
const TENANT_STATUSES = ['active', 'suspended', 'disabled'] as const;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`[capability] ${field} is missing`);
  }
  return value;
}

function requiredStatus<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`[capability] ${field} is missing or invalid`);
  }
  return value as T;
}

function isAal(value: unknown): value is Aal {
  return value === 'aal1' || value === 'aal2';
}

async function fetchServerAal(supabase: SupabaseLike): Promise<Aal | null> {
  const getAssurance = supabase.auth.mfa?.getAuthenticatorAssuranceLevel;
  if (typeof getAssurance !== 'function') return null;
  try {
    const result = await getAssurance.call(supabase.auth.mfa);
    if (result.error || !result.data) return null;
    return isAal(result.data.currentLevel) ? result.data.currentLevel : null;
  } catch {
    return null;
  }
}

export async function fetchCapabilitySnapshot(supabase: SupabaseLike): Promise<CapabilitySnapshot> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('[capability] no authenticated user');

  const [aal, profileResult] = await Promise.all([
    fetchServerAal(supabase),
    supabase
      .from('profiles')
      .select('id,user_id,tenant_id,role,status')
      .eq('user_id', user.id)
      .single(),
  ]);

  if (profileResult.error || !profileResult.data) {
    throw new Error('[capability] profile lookup failed (no metadata fallback)');
  }

  const profile = profileResult.data as Record<string, unknown>;
  const profileUserId = requiredString(profile.user_id, 'profile user_id');
  if (profileUserId !== user.id) throw new Error('[capability] profile identity mismatch');
  const profileId = requiredString(profile.id, 'profile id');
  const tenantId = requiredString(profile.tenant_id, 'profile tenant_id');
  const role = requiredString(profile.role, 'profile role');
  const status = requiredStatus(profile.status, ACCOUNT_STATUSES, 'profile status');

  const tenantResult = await supabase
    .from('tenants')
    .select('id,status')
    .eq('id', tenantId)
    .single();
  if (tenantResult.error || !tenantResult.data) {
    throw new Error('[capability] tenant lookup failed');
  }
  const tenant = tenantResult.data as Record<string, unknown>;
  const tenantStatus = requiredStatus(tenant.status, TENANT_STATUSES, 'tenant status');

  let policyVersion = 0;
  let dataMode: DataMode = 'deidentified';
  try {
    const { data: policy } = await supabase
      .from('tenant_data_policies')
      .select('mode,version')
      .eq('tenant_id', tenantId)
      .single();
    const pol = policy as { mode?: DataMode; version?: number } | null;
    if (pol?.mode === 'identifiable' || pol?.mode === 'deidentified') dataMode = pol.mode;
    if (typeof pol?.version === 'number') policyVersion = pol.version;
  } catch {
    dataMode = 'deidentified';
    policyVersion = 0;
  }

  let expiresAt: number | null = null;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.expires_at) expiresAt = session.expires_at * 1000;
  } catch {
    expiresAt = null;
  }

  return {
    userId: user.id,
    tenantId,
    profileId,
    role,
    status,
    tenantStatus,
    policyVersion,
    dataMode,
    aal,
    expiresAt,
    fetchedAt: Date.now(),
  };
}

export function isCapabilityFresh(snap: CapabilitySnapshot, maxAgeMs = DEFAULT_FRESH_MS): boolean {
  if (!snap.userId || !snap.profileId || !snap.tenantId) return false;
  if (snap.status !== 'active' || snap.tenantStatus !== 'active') return false;
  return Date.now() - snap.fetchedAt <= maxAgeMs;
}

const AAL2_ACTIONS = new Set([
  'export_identifiable',
  'export_deidentified',
  'view_identifiable',
  'approve_case',
  'manage_tenant',
  'tenant_read',
  'tenant_mutate',
  'evaluation_create',
  'duty_create',
  'attachment_upload',
  'ai_insights',
]);

export function requiresStepUp(snap: CapabilitySnapshot, action: string): boolean {
  if (!AAL2_ACTIONS.has(action)) return false;
  if (!snap.userId || !snap.profileId || !snap.tenantId) return true;
  if (snap.status !== 'active' || snap.tenantStatus !== 'active') return true;
  return snap.aal !== 'aal2';
}

export function hasServerAal2(snap: CapabilitySnapshot): boolean {
  return Boolean(snap.userId && snap.profileId && snap.tenantId) && snap.status === 'active' && snap.tenantStatus === 'active' && snap.aal === 'aal2';
}
