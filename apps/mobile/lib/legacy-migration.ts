/**
 * M2/M3 — one-time upgrade migration off legacy storage formats.
 *
 * - Legacy global queue (`offline_case_queue_v2`): decrypt each v2 item
 *   with the device key and re-enqueue into the durable per-account outbox
 *   (stable new op IDs; server dedupes on payload identity only for fresh
 *   writes — migrated items are new submissions, never silent resubmits).
 *   The legacy key is deleted only after every item migrates; a second call
 *   is a no-op. With no account context the legacy key is left intact.
 * - Legacy plaintext draft (`case_form_draft`): deleted outright (drafts
 *   are ephemeral autosaves; the encrypted store is authoritative).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { decryptText, CryptoError } from './crypto/aead';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { getAccountContext, scopedKey } from './account-context';
import { OFFLINE_QUEUE_KEY, type QueuedCasePayload } from './offline-queue';
import { enqueueDurable } from './durable-queue';
import { logWarn } from './logger';

export const LEGACY_DRAFT_KEY = 'case_form_draft';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function migrateLegacyQueueOnce(): Promise<number> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  const ctx = getAccountContext();
  if (!ctx) return 0;

  let items: QueuedCasePayload[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY).catch(() => undefined);
      return 0;
    }
    items = parsed as QueuedCasePayload[];
  } catch {
    logWarn('legacy-migration.unparseable-queue');
    return 0;
  }

  const keyBytes = hexToBytes(await getOrCreateDbEncryptionKey());
  let migrated = 0;
  for (const item of items) {
    try {
      const plaintext = decryptText(keyBytes, item.ciphertext);
      const data = JSON.parse(plaintext) as Record<string, unknown>;
      // v2 held case inserts only. N3: preserve the legacy UUID as the op ID
      // so replay protection survives migration (no fresh IDs, no forks).
      await enqueueDurable('case_entries', 'insert', data, { opId: item.id });
      migrated += 1;
    } catch (err) {
      if (err instanceof CryptoError) {
        // Tampered legacy item: drop (fail-closed) but keep migrating rest.
        logWarn('legacy-migration.tampered-item-dropped');
        migrated += 0;
        continue;
      }
      // Any other failure: stop, keep the legacy key for the next attempt.
      logWarn('legacy-migration.retry-later');
      return migrated;
    }
  }

  // All items accounted for (migrated or fail-closed-dropped): delete legacy.
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY).catch(() => undefined);
  return migrated;
}

export async function migrateLegacyDraftOnce(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // best-effort
  }
}

const LEGACY_AUDIT_KEY = 'audit_trail_buffer_v1';
const AUDIT_QUARANTINE_KEY = 'audit_trail_buffer_v1.quarantine';
const AUDIT_MAX = 500;

interface AuditRow {
  user_id?: unknown;
  [k: string]: unknown;
}

/**
 * N1: move a legacy GLOBAL audit buffer into per-account scope without
 * reattribution. Entries whose actor matches the current account move to
 * the scoped buffer (newest 500 win); all other entries move to a visible
 * quarantine key (never deleted, never attributed). The global key is
 * removed only when every entry is accounted for.
 */
export async function migrateAuditBufferOnce(): Promise<{ moved: number; quarantined: number }> {
  const empty = { moved: 0, quarantined: 0 };
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(LEGACY_AUDIT_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  const ctx = getAccountContext();
  if (!ctx) return empty;

  let rows: AuditRow[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await AsyncStorage.removeItem(LEGACY_AUDIT_KEY).catch(() => undefined);
      return empty;
    }
    rows = parsed as AuditRow[];
  } catch {
    logWarn('legacy-migration.unparseable-audit-buffer');
    return empty;
  }
  if (rows.length === 0) {
    await AsyncStorage.removeItem(LEGACY_AUDIT_KEY).catch(() => undefined);
    return empty;
  }

  const mine = rows.filter((r) => r.user_id === ctx.userId);
  const foreign = rows.filter((r) => r.user_id !== ctx.userId);

  try {
    const scopedRaw = await AsyncStorage.getItem(scopedKey(LEGACY_AUDIT_KEY));
    const scoped = scopedRaw ? ((JSON.parse(scopedRaw) as AuditRow[]) ?? []) : [];
    const merged = [...scoped, ...mine].slice(-AUDIT_MAX);
    await AsyncStorage.setItem(scopedKey(LEGACY_AUDIT_KEY), JSON.stringify(merged));
    if (foreign.length > 0) {
      const qRaw = await AsyncStorage.getItem(AUDIT_QUARANTINE_KEY);
      const q = qRaw ? ((JSON.parse(qRaw) as AuditRow[]) ?? []) : [];
      await AsyncStorage.setItem(AUDIT_QUARANTINE_KEY, JSON.stringify([...q, ...foreign].slice(-AUDIT_MAX)));
    }
  } catch {
    logWarn('legacy-migration.retry-later');
    return empty;
  }

  await AsyncStorage.removeItem(LEGACY_AUDIT_KEY).catch(() => undefined);
  return { moved: mine.length, quarantined: foreign.length };
}
