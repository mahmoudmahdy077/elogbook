/**
 * M1 — single account-context object (local-first).
 *
 * Every namespaced store (draft, queue, cache, telemetry, notifications,
 * sync cursors) derives its key via scopedKey(). On sign-out or account
 * switch, callers stop workers, clear memory, and remove the old context's
 * data. Old rows/drafts are never queryable under the new scope because the
 * scope is part of the key.
 *
 * The session discriminator is durable. The queue stamps every item with the
 * session that wrote it and refuses to flush an item whose stamp no longer
 * matches, so a discriminator that restarted at 1 on every cold start would let
 * a new process claim the previous one's queued work. It is a per-account
 * monotonic counter in AsyncStorage, keyed by the account scope so session
 * disposal removes it with everything else that account owns — and so no
 * account's record is addressable from another's. `primeAccountContext` reads
 * it before the first context is built; without that read the allocator still
 * never repeats, it just cannot promise ordering.
 */

/**
 * AsyncStorage is loaded on demand rather than at import time: this module is
 * pulled in by plain logic that must not drag the native storage module into
 * its graph, and a device that cannot load it simply gets no durable ordering.
 */
interface DurableStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

let storagePromise: Promise<DurableStorage | null> | null = null;

function durableStorage(): Promise<DurableStorage | null> {
  storagePromise ??= import('@react-native-async-storage/async-storage')
    .then((loaded) => ((loaded as { default?: DurableStorage }).default ?? (loaded as unknown as DurableStorage)) ?? null)
    .catch(() => null);
  return storagePromise;
}

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

/** Account-scoped: `${userId}:${tenantId}:account_context.session_epoch.v1`. */
export const SESSION_EPOCH_KEY = 'account_context.session_epoch.v1';

let current: AccountContext | null = null;
let last: AccountContext | null = null;
let previous: AccountContext | null = null;
// Seeded from the wall clock rather than zero: an unprimed cold start must not
// walk back into the range a previous process already issued.
let sessionSequence = Date.now();
let durableIdentity: string | null = null;
let durableEpoch: number | null = null;
let hydration: Promise<void> | null = null;
// Serialized so a disposal that waits on the newest write cannot be overtaken
// by an older one still in flight.
let epochWrite: Promise<unknown> = Promise.resolve();
const listeners = new Set<(ctx: AccountContext | null) => void>();

function identityOf(ctx: Pick<AccountContext, 'userId' | 'tenantId' | 'profileId'>): string {
  return `${ctx.userId}:${ctx.tenantId}:${ctx.profileId}`;
}

function epochKey(ctx: Pick<AccountContext, 'userId' | 'tenantId'>): string {
  return scopedKeyForContext(ctx as AccountContext, SESSION_EPOCH_KEY);
}

/**
 * Read this account's durable epoch before a context is built.
 *
 * Awaited from the session boot path. A read failure is not fatal: the
 * allocator falls back to a range no previous process could have issued, so a
 * failed read costs ordering and nothing else.
 */
export async function primeAccountContext(
  ctx: Pick<AccountContext, 'userId' | 'tenantId' | 'profileId'>,
): Promise<void> {
  const identity = identityOf(ctx);
  if (durableIdentity === identity && hydration) {
    await hydration;
    return;
  }
  durableIdentity = identity;
  durableEpoch = null;
  hydration = (async () => {
    let stored: number | null = null;
    try {
      const storage = await durableStorage();
      const raw = storage ? await storage.getItem(epochKey(ctx)) : null;
      const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
      stored = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      stored = null;
    }
    // A read for a different identity that lands late must not lower this one.
    if (durableIdentity !== identity) return;
    durableEpoch = stored;
    if (stored !== null) sessionSequence = Math.max(sessionSequence, stored);
  })();
  await hydration;
}

function nextDiscriminator(ctx: AccountContext): string {
  const epoch = Math.max(sessionSequence, durableEpoch ?? 0) + 1;
  sessionSequence = epoch;
  const identity = identityOf(ctx);
  // Fire-and-forget: a failed write costs ordering, never correctness, and a
  // write that had to be awaited would make session construction asynchronous
  // for every caller in the app. The chain is serialized so a disposal that
  // waits for the newest write is not overtaken by an older one.
  epochWrite = epochWrite
    .then(() => durableStorage())
    .then((storage) => storage?.setItem(epochKey(ctx), String(epoch)))
    .catch(() => undefined);
  return `${identity}:${epoch}`;
}

/**
 * Resolves once every epoch write issued so far has settled.
 *
 * Session disposal awaits this before it wipes, so an in-flight write cannot
 * re-create the very key the disposal just removed.
 */
export function whenSessionEpochSettled(): Promise<void> {
  return epochWrite.then(() => undefined, () => undefined);
}

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
      : nextDiscriminator(ctx),
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
