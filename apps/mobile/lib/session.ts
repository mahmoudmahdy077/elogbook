import { fetchCapabilitySnapshot, isCapabilityFresh, type CapabilitySnapshot, type SupabaseLike } from './capability';
import { primeAccountContext, setAccountContext, clearAccountContext } from './account-context';

export type SessionState = 'idle' | 'resolving' | 'ready' | 'signed-out' | 'suspended' | 'error';

export interface Session {
  state: SessionState;
  capability: CapabilitySnapshot | null;
  error: string | null;
}

let current: Session = { state: 'idle', capability: null, error: null };
let refreshRequested = false;
let lastSupabase: SupabaseLike | null = null;

export function getSession(): Session {
  return current;
}

export function resetSessionForTests(): void {
  current = { state: 'idle', capability: null, error: null };
  refreshRequested = false;
  lastSupabase = null;
}

export function __ageSessionForTests(ms: number): void {
  if (current.capability) {
    current = { ...current, capability: { ...current.capability, fetchedAt: Date.now() - ms } };
  }
}

export function noteAuthFailure(status: number): void {
  if (status === 401 || status === 403) refreshRequested = true;
}

async function populateContext(cap: CapabilitySnapshot): Promise<void> {
  // The durable session discriminator is read before it is minted, so a new
  // session never lands on a key the previous one already used.
  await primeAccountContext(cap);
  setAccountContext({
    userId: cap.userId,
    tenantId: cap.tenantId,
    profileId: cap.profileId,
    role: cap.role,
    status: cap.status,
    tenantStatus: cap.tenantStatus,
    expiresAt: cap.expiresAt,
    policyVersion: cap.policyVersion,
    dataMode: cap.dataMode,
  });
}

function stateForDeniedCapability(cap: CapabilitySnapshot): Session {
  const explicitlyDenied = cap.status !== 'active' || cap.tenantStatus !== 'active';
  clearAccountContext();
  return {
    state: explicitlyDenied ? 'suspended' : 'error',
    capability: cap,
    error: explicitlyDenied ? null : 'account or tenant status unavailable',
  };
}

export async function bootSession(supabase: SupabaseLike): Promise<Session> {
  current = { state: 'resolving', capability: null, error: null };
  lastSupabase = supabase;
  try {
    const cap = await fetchCapabilitySnapshot(supabase);
    if (cap.status !== 'active' || cap.tenantStatus !== 'active') {
      current = stateForDeniedCapability(cap);
      return current;
    }
    await populateContext(cap);
    current = { state: 'ready', capability: cap, error: null };
    return current;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no authenticated user/i.test(msg)) {
      clearAccountContext();
      current = { state: 'signed-out', capability: null, error: null };
      return current;
    }
    clearAccountContext();
    current = { state: 'error', capability: null, error: msg };
    return current;
  }
}

export async function requireFreshCapability(supabase: SupabaseLike): Promise<CapabilitySnapshot> {
  lastSupabase = supabase;
  const needsRefresh = refreshRequested || !current.capability || !isCapabilityFresh(current.capability);
  refreshRequested = false;
  if (!needsRefresh && current.capability) return current.capability;
  const cap = await fetchCapabilitySnapshot(supabase);
  if (cap.status !== 'active' || cap.tenantStatus !== 'active') {
    current = stateForDeniedCapability(cap);
  } else {
    await populateContext(cap);
    current = { state: 'ready', capability: cap, error: null };
  }
  return cap;
}

export function lastSupabaseSeen(): SupabaseLike | null {
  return lastSupabase;
}

export async function bestKnownCapability(supabase: SupabaseLike): Promise<CapabilitySnapshot | null> {
  try {
    return await requireFreshCapability(supabase);
  } catch {
    return getSession().capability;
  }
}
