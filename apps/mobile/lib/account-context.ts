/**
 * M1 — single account-context object (local-first).
 *
 * Every namespaced store (draft, queue, cache, telemetry, notifications,
 * sync cursors) derives its key via scopedKey(). On sign-out or account
 * switch, callers stop workers, clear memory, and wipe/quarantine the old
 * context's data. Old rows/drafts are never queryable under the new scope
 * because the scope is part of the key.
 */

export interface AccountContext {
  userId: string;
  tenantId: string;
  profileId: string;
  /** Current tenant policy version (M1.2: populated before stores init). */
  policyVersion?: number;
  /** Current tenant data mode (M1.2). */
  dataMode?: 'deidentified' | 'identifiable';
}

let current: AccountContext | null = null;
const listeners = new Set<(ctx: AccountContext | null) => void>();

export function getAccountContext(): AccountContext | null {
  return current;
}

export function setAccountContext(ctx: AccountContext): void {
  current = { ...ctx };
  listeners.forEach((fn) => fn(current));
}

export function clearAccountContext(): void {
  current = null;
  listeners.forEach((fn) => fn(null));
}

/** Namespace a storage key by account+tenant. Unset = legacy global (migration only). */
export function scopedKey(base: string): string {
  if (!current) return `global:${base}`;
  return `${current.userId}:${current.tenantId}:${base}`;
}

export function onContextChange(fn: (ctx: AccountContext | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
