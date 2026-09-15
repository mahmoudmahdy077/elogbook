/**
 * M1 — server capability snapshot (local-first).
 *
 * Replaces `user_metadata.role` as an authorization input. Role/status/
 * tenant/policy/MFA/expiry come from server tables (profiles + tenant
 * policy) via the authenticated client's RLS. Client metadata is
 * display-only and never grants access.
 */

export type AccountStatus = 'active' | 'suspended' | 'disabled';
export type DataMode = 'deidentified' | 'identifiable';

export interface CapabilitySnapshot {
  userId: string;
  tenantId: string;
  profileId: string;
  /** Display hint only — never use for authorization. */
  role: string;
  status: AccountStatus;
  policyVersion: number;
  dataMode: DataMode;
  mfaVerifiedAt: number | null;
  expiresAt: number | null;
  fetchedAt: number;
}

type SupabaseLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null } }>;
    getSession: () => Promise<{ data: { session: { expires_at?: number } | null } }>;
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

export async function fetchCapabilitySnapshot(
  supabase: SupabaseLike,
  opts?: { mfaVerifiedAt?: number | null },
): Promise<CapabilitySnapshot> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('[capability] no authenticated user');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,user_id,tenant_id,role,status')
    .eq('user_id', user.id)
    .single();
  if (profileError || !profile) throw new Error('[capability] profile lookup failed (no metadata fallback)');

  const p = profile as { id: string; tenant_id: string; role: string; status: AccountStatus };
  if (!p.tenant_id) throw new Error('[capability] profile has no tenant');

  let policyVersion = 0;
  let dataMode: DataMode = 'deidentified';
  try {
    const { data: policy } = await supabase
      .from('tenant_data_policies')
      .select('mode,version')
      .eq('tenant_id', p.tenant_id)
      .single();
    const pol = policy as { mode?: DataMode; version?: number } | null;
    if (pol?.mode === 'identifiable' || pol?.mode === 'deidentified') dataMode = pol.mode;
    if (typeof pol?.version === 'number') policyVersion = pol.version;
  } catch {
    // Policy unreadable → safest default (deidentified, version 0); server still enforces.
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
    tenantId: p.tenant_id,
    profileId: p.id,
    role: p.role,
    status: p.status ?? 'active',
    policyVersion,
    dataMode,
    mfaVerifiedAt: opts?.mfaVerifiedAt ?? null,
    expiresAt,
    fetchedAt: Date.now(),
  };
}

export function isCapabilityFresh(snap: CapabilitySnapshot, maxAgeMs = DEFAULT_FRESH_MS): boolean {
  if (snap.status !== 'active') return false;
  return Date.now() - snap.fetchedAt <= maxAgeMs;
}

const SENSITIVE_ACTIONS = new Set(['export_identifiable', 'view_identifiable', 'approve_case', 'manage_tenant']);

export function requiresStepUp(snap: CapabilitySnapshot, action: string): boolean {
  if (!SENSITIVE_ACTIONS.has(action)) return false;
  if (snap.status !== 'active') return true;
  if (!snap.mfaVerifiedAt) return true;
  return Date.now() - snap.mfaVerifiedAt > DEFAULT_FRESH_MS;
}
