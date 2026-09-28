/**
 * M1 — single account-context object (local-first).
 *
 * Every namespaced store (draft, queue, cache, telemetry, notifications,
 * sync cursors) derives its key via scopedKey(). On sign-out or account
 * switch, callers stop workers, clear memory, and remove the old context's
 * data. Old rows/drafts are never queryable under the new scope because the
 * scope is part of the key.
 */

export interface AccountContext {
  userId: string;
  tenantId: string;
  profileId: string;
  role?: string;
  sessionId?: string;
  status?: 'active' | 'suspended' | 'disabled';
  tenantStatus?: 'active' | 'suspended' | 'disabled';
  expiresAt?: number | null;
  /** Current tenant policy version (M1.2: populated before stores init). */
  policyVersion?: number;
  /** Current tenant data mode (M1.2). */
  dataMode?: 'deidentified' | 'identifiable';
}

let current: AccountContext | null = null;
let last: AccountContext | null = null;
let previous: AccountContext | null = null;
let sessionSequence = 0;
const listeners = new Set<(ctx: AccountContext | null) => void>();

export function getAccountContext(): AccountContext | null {
  return current;
}

export function setAccountContext(ctx: AccountContext): void {
  const sameIdentity = current
    && current.userId === ctx.userId
    && current.tenantId === ctx.tenantId
    && current.profileId === ctx.profileId;
  const next: AccountContext = {
    ...ctx,
    sessionId: sameIdentity && current?.sessionId
      ? current.sessionId
      : `${ctx.userId}:${ctx.tenantId}:${ctx.profileId}:${++sessionSequence}`,
  };
  if (current && !sameIdentity) previous = current;
  current = next;
  last = next;
  listeners.forEach((fn) => fn(current));
}

export function clearAccountContext(): void {
  last = current;
  current = null;
  listeners.forEach((fn) => fn(null));
}

export function getLastAccountContext(): AccountContext | null {
  return last;
}

export function getPreviousAccountContext(): AccountContext | null {
  return previous;
}

export function clearPreviousAccountContext(): void {
  previous = null;
}

/** Namespace a storage key by an explicitly captured account scope. */
export function scopedKeyForContext(ctx: AccountContext, base: string): string {
  return `${ctx.userId}:${ctx.tenantId}:${base}`;
}

/** Namespace a storage key by account+tenant. Unset = legacy global (migration only). */
export function scopedKey(base: string): string {
  if (!current) return `global:${base}`;
  return scopedKeyForContext(current, base);
}

export function onContextChange(fn: (ctx: AccountContext | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
