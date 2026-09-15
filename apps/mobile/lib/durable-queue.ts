/**
 * N3 — durable local-first outbox (supported queue).
 *
 * Append-only per-account queue with stable client operation IDs. Flush
 * executes the fixed-schema `submit_case_operation` RPC per op (tenant +
 * ownership + allowlist + tombstone enforced server-side); the upsert path
 * is retired. Mutations are serialized through an in-process mutex so
 * enqueue-during-flush cannot be lost. Crash between server response and
 * local delete is safe: the op ID is reused on retry and the server op log
 * dedupes replays. Bounded size/count; corruption is backed up visibly.
 * Error taxonomy never drops policy/auth/unknown silently — they quarantine
 * with user-visible state.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { encryptText, decryptText, CryptoError } from './crypto/aead';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { getAccountContext, scopedKey } from './account-context';
import { logWarn } from './logger';
import { t } from './copy';

export const DURABLE_QUEUE_KEY = 'durable_queue.v1';
export const DURABLE_SCHEMA_VERSION = 1;
/** N3 bounds: the queue refuses new work instead of growing without limit. */
export const MAX_QUEUE_ITEMS = 200;
export const MAX_QUEUE_BYTES = 5 * 1024 * 1024;

export type QueueAction = 'insert' | 'update' | 'delete';
export type QueueState = 'queued' | 'sending' | 'quarantined';
export type QueueErrorClass = 'transient' | 'auth' | 'policy' | 'validation' | 'conflict' | 'tamper' | 'unknown';

export interface DurableQueueItem {
  opId: string;
  accountId: string;
  tenantId: string;
  table: string;
  action: QueueAction;
  schemaVersion: number;
  ciphertext: string;
  createdAt: number;
  updatedAt: number;
  attemptCount: number;
  state: QueueState;
  lastError: string | null;
}

export interface FlushResult {
  synced: number;
  transient: number;
  quarantined: number;
  skippedForeign: number;
  lastError: string | null;
}

export interface OpRpcResult {
  success: boolean;
  id?: string;
  already_deleted?: boolean;
  error?: string;
}

type SupabaseLike = {
  rpc: (
    fn: 'submit_case_operation',
    args: { p_op_id: string; p_action: QueueAction; p_row_id: string | null; p_payload: Record<string, unknown> },
  ) => Promise<{ data: OpRpcResult | null; error: { message: string } | null }>;
};

// In-process mutex: every mutation chains onto this promise.
let mutex: Promise<void> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function uuidv4(): string {
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.crypto || typeof g.crypto.getRandomValues !== 'function') {
    throw new Error('[durable-queue] No CSPRNG available');
  }
  g.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let lastCorruptKey: string | null = null;

/** Key of the most recent corrupt-queue backup (test/operator visibility). */
export function lastCorruptBackupKey(): string | null {
  return lastCorruptKey;
}

async function readRaw(): Promise<DurableQueueItem[]> {
  const key = scopedKey(DURABLE_QUEUE_KEY);
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Crash recovery: anything left in `sending` goes back to `queued`.
    return (parsed as DurableQueueItem[]).map((it) =>
      it.state === 'sending' ? { ...it, state: 'queued' as QueueState } : it,
    );
  } catch {
    // N3 corrupt visibility: back the bytes up under a visible key instead
    // of silently treating the queue as empty.
    try {
      lastCorruptKey = `${key}.corrupt.${Date.now()}`;
      await AsyncStorage.setItem(lastCorruptKey, raw);
    } catch {
      // best-effort backup
    }
    logWarn('durable-queue.corrupt-backup');
    return [];
  }
}

async function writeRaw(items: DurableQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(scopedKey(DURABLE_QUEUE_KEY), JSON.stringify(items));
}

export function classifyQueueError(message: string): QueueErrorClass {
  const m = message.toLowerCase();
  if (/network|fetch|timeout|abort|connect|5\d\d|econn|etimedout|offline|op_in_progress|free plan limit|quota/.test(m)) {
    return 'transient';
  }
  if (/jwt|token|expired|refresh|unauthorized|401|403.*auth|mfa|step-up/.test(m)) return 'auth';
  if (/policy|rls|revok|permission|privilege|insufficient|denied|not allowed|disallowed|forbidden|approved_locked|identifier_locked|identifiable_not|mode_immutable/.test(m)) {
    return 'policy';
  }
  if (/validation|invalid|immutable|check constraint|not-null|22p02/.test(m)) return 'validation';
  if (/duplicate|conflict|23505|already exists|on conflict/.test(m)) return 'conflict';
  if (/mac|tamper|corrupt|decrypt|crypto/.test(m)) return 'tamper';
  return 'unknown';
}

export function newOperationId(): string {
  return uuidv4();
}

export async function enqueueDurable(
  table: string,
  action: QueueAction,
  data: Record<string, unknown>,
  opts?: { opId?: string },
): Promise<string> {
  const ctx = getAccountContext();
  if (!ctx) throw new Error('[durable-queue] no account context (refuse global enqueue)');
  const keyHex = await getOrCreateDbEncryptionKey();
  const envelope = encryptText(hexToBytes(keyHex), JSON.stringify(data));
  const opId = opts?.opId ?? uuidv4();
  const now = Date.now();
  const item: DurableQueueItem = {
    opId,
    accountId: ctx.userId,
    tenantId: ctx.tenantId,
    table,
    action,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    ciphertext: envelope,
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    state: 'queued',
    lastError: null,
  };
  await serialized(async () => {
    const items = await readRaw();
    // N3 bounds: refuse new work instead of unbounded growth (storage quota
    // exhaustion surfaces here as an explicit error, not a silent drop).
    if (items.length >= MAX_QUEUE_ITEMS) {
      throw new Error(`local queue full (${MAX_QUEUE_ITEMS} ops) — sync or discard quarantined work and retry`);
    }
    const stored = await AsyncStorage.getItem(scopedKey(DURABLE_QUEUE_KEY)).catch(() => null);
    if (stored && stored.length > MAX_QUEUE_BYTES) {
      throw new Error('local queue full (size budget) — sync or discard quarantined work and retry');
    }
    items.push(item);
    await writeRaw(items);
  });
  return opId;
}

export async function readDurableQueue(): Promise<DurableQueueItem[]> {
  return readRaw();
}

export async function getDurableCounts(): Promise<{ queued: number; quarantined: number; total: number }> {
  const items = await readRaw();
  return {
    queued: items.filter((i) => i.state === 'queued').length,
    quarantined: items.filter((i) => i.state === 'quarantined').length,
    total: items.length,
  };
}

/**
 * M3.4 — user-visible queue states with safe recovery copy.
 * Never claims "submitted" before server confirmation.
 * N7.4: copy comes from the centralized table (locale-aware).
 */
export function queueStatusCopy(counts: { queued: number; quarantined: number }, locale = 'en'): string {
  if (counts.quarantined > 0 && counts.queued > 0) {
    return `${counts.queued} waiting to send · ${counts.quarantined} need your attention`;
  }
  if (counts.quarantined > 0) return t('sync.attention', locale);
  if (counts.queued > 0) return `${counts.queued} ${t('offline.willSend', locale)}`;
  return t('sync.sent', locale);
}

export async function flushDurableQueue(supabase: SupabaseLike): Promise<FlushResult> {
  return serialized(async () => {
    const ctx = getAccountContext();
    const items = await readRaw();
    const result: FlushResult = { synced: 0, transient: 0, quarantined: 0, skippedForeign: 0, lastError: null };
    if (items.length === 0) return result;

    const keyHex = await getOrCreateDbEncryptionKey();
    const keyBytes = hexToBytes(keyHex);
    const remaining: DurableQueueItem[] = [];

    for (const item of items) {
      // Account isolation: never flush another account's work after switch.
      if (!ctx || item.accountId !== ctx.userId || item.tenantId !== ctx.tenantId) {
        result.skippedForeign += 1;
        remaining.push(item);
        continue;
      }
      if (item.state === 'quarantined') {
        result.quarantined += 1;
        remaining.push(item);
        continue;
      }
      const keepTransient = (msg: string) => {
        result.transient += 1;
        result.lastError = msg;
        remaining.push({ ...item, attemptCount: item.attemptCount + 1, updatedAt: Date.now(), lastError: msg });
      };
      const keepQuarantined = (cls: string, msg: string) => {
        // Policy/auth/validation/conflict/tamper/unknown → quarantine, never silent drop.
        result.quarantined += 1;
        result.lastError = msg;
        remaining.push({ ...item, state: 'quarantined', attemptCount: item.attemptCount + 1, updatedAt: Date.now(), lastError: `${cls}: ${msg}` });
      };
      try {
        const plaintext = decryptText(keyBytes, item.ciphertext);
        const data = JSON.parse(plaintext) as Record<string, unknown>;
        // N3: server-managed identity stays server-side. The op RPC takes the
        // tenant from auth and the op ID from its own parameter.
        const fields: Record<string, unknown> = { ...data };
        delete fields.id;
        delete fields.tenant_id;
        delete fields.client_operation_id;
        const rowId = item.action === 'insert' ? null : typeof data.id === 'string' ? (data.id as string) : null;
        if (item.action !== 'insert' && !rowId) {
          keepQuarantined('validation', 'missing row id for queued update/delete');
          continue;
        }
        let rpcRes: { data: OpRpcResult | null; error: { message: string } | null };
        try {
          rpcRes = await supabase.rpc('submit_case_operation', {
            p_op_id: item.opId,
            p_action: item.action,
            p_row_id: rowId,
            p_payload: fields,
          });
        } catch (err) {
          keepTransient(err instanceof Error ? err.message : String(err));
          continue;
        }
        if (rpcRes.error) {
          const cls = classifyQueueError(rpcRes.error.message);
          if (cls === 'transient') keepTransient(rpcRes.error.message);
          else keepQuarantined(cls, rpcRes.error.message);
          continue;
        }
        const body = rpcRes.data;
        if (body && body.success) {
          result.synced += 1;
          continue;
        }
        const msg = (body && body.error) || 'empty operation result';
        const cls = classifyQueueError(msg);
        if (cls === 'transient') keepTransient(msg);
        else keepQuarantined(cls, msg);
      } catch (err) {
        if (err instanceof CryptoError) {
          keepQuarantined('tamper', 'corrupted queue item quarantined');
          const last = remaining[remaining.length - 1];
          if (last) last.lastError = 'tamper: MAC failed';
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          const cls = classifyQueueError(msg);
          if (cls === 'transient') keepTransient(msg);
          else keepQuarantined(cls, msg);
        }
      }
    }

    await writeRaw(remaining);
    return result;
  });
}
