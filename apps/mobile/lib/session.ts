/**
 * M1 — one authoritative session boundary.
 *
 * Boot resolves the server capability snapshot (never client metadata) and
 * populates the full account context BEFORE draft/queue/cache/sync init.
 * Refresh triggers: boot, foreground, 401/403 (noteAuthFailure), tenant
 * switch, sensitive actions (requireFreshCapability), sign-out.
 * Suspended/non-active accounts never receive a write scope.
 */

import { fetchCapabilitySnapshot, isCapabilityFresh, type CapabilitySnapshot } from './capability';
import { setAccountContext, clearAccountContext } from './account-context';

export type SessionState = 'idle' | 'resolving' | 'ready' | 'signed-out' | 'suspended' | 'error';

export interface Session {
  state: SessionState;
  capability: CapabilitySnapshot | null;
  error: string | null;
}

type SupabaseLike = Parameters<typeof fetchCapabilitySnapshot>[0];

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

/** Test-only: age the cached snapshot to force a refetch. */
export function __ageSessionForTests(ms: number): void {
  if (current.capability) {
    current = { ...current, capability: { ...current.capability, fetchedAt: Date.now() - ms } };
  }
}

/** Called by network layers on 401/403: next requireFreshCapability refetches. */
export function noteAuthFailure(status: number): void {
  if (status === 401 || status === 403) refreshRequested = true;
}

function populateContext(cap: CapabilitySnapshot): void {
  setAccountContext({
    userId: cap.userId,
    tenantId: cap.tenantId,
    profileId: cap.profileId,
    policyVersion: cap.policyVersion,
    dataMode: cap.dataMode,
  });
}

export async function bootSession(supabase: SupabaseLike): Promise<Session> {
  current = { state: 'resolving', capability: null, error: null };
  lastSupabase = supabase;
  try {
    const cap = await fetchCapabilitySnapshot(supabase);
    if (cap.status !== 'active') {
      clearAccountContext();
      current = { state: 'suspended', capability: cap, error: null };
      return current;
    }
    populateContext(cap);
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

/** Fresh capability for sensitive actions; refetches when stale or flagged by 401/403. */
export async function requireFreshCapability(supabase: SupabaseLike): Promise<CapabilitySnapshot> {
  lastSupabase = supabase;
  const needsRefresh = refreshRequested || !current.capability || !isCapabilityFresh(current.capability);
  refreshRequested = false;
  if (!needsRefresh && current.capability) return current.capability;
  const cap = await fetchCapabilitySnapshot(supabase);
  current = { ...current, capability: cap };
  if (cap.status === 'active') populateContext(cap);
  return cap;
}

/** Last supabase handle seen (for foreground refresh wiring). */
export function lastSupabaseSeen(): SupabaseLike | null {
  return lastSupabase;
}

/**
 * N1 best-known capability for submit paths.
 *
 * Tries a fresh snapshot; on failure (offline) keeps the cached one so the
 * adapter can apply the explicit offline policy (queue on mode match, never
 * a blind server write). Returns null only when no session was ever
 * resolved — callers must fail closed in that case.
 */
export async function bestKnownCapability(supabase: SupabaseLike): Promise<CapabilitySnapshot | null> {
  try {
    return await requireFreshCapability(supabase);
  } catch {
    return getSession().capability;
  }
}
