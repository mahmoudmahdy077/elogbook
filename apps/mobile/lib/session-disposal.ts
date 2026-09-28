/**
 * M1.3 — context disposal on sign-out / account switch.
 *
 * - Stops registered workers (sync timers, listeners) via callbacks.
 * - Cancels in-flight requests via registered abort callbacks.
 * - Clears in-memory identity (telemetry user/session, cached keys).
 * - Resets the WatermelonDB singleton and removes old scoped drafts,
 *   queues, audit buffers, checkpoints, and notification cursors.
 * - Rotates push context + clears notification identity via callbacks.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAccountContext, clearPreviousAccountContext, getAccountContext, getLastAccountContext, scopedKeyForContext, type AccountContext } from './account-context';
import { resetDatabase } from './db/database';
import { clearDurableQueueForContext } from './durable-queue';
import { invalidateDbEncryptionKey, resetDbEncryptionKeyCacheForTests } from './db/encryption-key';
import { clearTelemetryIdentity, clearTelemetryState } from './production/telemetry';
import { clearAuditLogForContext, disposeAuditBuffer } from './security/audit-trail';

export interface DisposalHooks {
  stopWorkers?: Array<() => void>;
  abortRequests?: Array<() => void>;
  clearTelemetryIdentity?: () => void;
  rotatePushContext?: () => void;
  clearIdentityCaches?: () => void;
}

const DRAFT_KEY = 'case_form_draft.v1';
const LEGACY_DRAFT_KEY = 'case_form_draft';
const LEGACY_QUEUE_KEY = 'offline_case_queue_v2';
const LEGACY_AUDIT_KEY = 'audit_trail_buffer_v1';
const AUDIT_STATUS_KEY = 'audit_trail_status_v1';
const AUDIT_QUARANTINE_KEY = 'audit_trail_buffer_v1.quarantine';
const NOTIFICATION_KEY = 'last_notification_check';
const SYNC_CHECKPOINT_KEY = 'sync_checkpoint_v1';
const WAL_KEY = 'write_ahead_log_v1';
const SYNC_TIMESTAMP_KEY = 'last_sync_timestamp';

async function removeScopedStorage(context: AccountContext | null): Promise<void> {
  let keys: string[] = [];
  try {
    keys = await AsyncStorage.getAllKeys();
  } catch {
    return;
  }
  const prefix = context ? `${context.userId}:${context.tenantId}:` : 'global:';
  for (const key of keys) {
    if (key.startsWith(prefix)) await AsyncStorage.removeItem(key);
  }
}

async function removeStorage(keys: string[]): Promise<void> {
  for (const key of keys) await AsyncStorage.removeItem(key);
}

export async function disposeAccountContext(hooks: DisposalHooks = {}, contextOverride?: AccountContext | null): Promise<void> {
  const context = contextOverride ?? getAccountContext() ?? getLastAccountContext();
  let disposalError: unknown = null;
  const attempt = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      disposalError ??= error;
    }
  };

  for (const stop of hooks.stopWorkers ?? []) {
    try {
      stop();
    } catch (error) {
      disposalError ??= error;
    }
  }
  for (const abort of hooks.abortRequests ?? []) {
    try {
      abort();
    } catch (error) {
      disposalError ??= error;
    }
  }

  await attempt(async () => {
    if (typeof resetDatabase === 'function') await resetDatabase();
  });
  if (context) {
    await attempt(() => clearDurableQueueForContext(context));
    await attempt(() => clearAuditLogForContext(context));
    await attempt(() => removeScopedStorage(context));
  } else {
    await attempt(() => removeStorage([LEGACY_DRAFT_KEY, LEGACY_QUEUE_KEY, LEGACY_AUDIT_KEY, AUDIT_QUARANTINE_KEY, `global:${AUDIT_STATUS_KEY}`]));
  }
  await attempt(() => removeStorage([
    context ? scopedKeyForContext(context, DRAFT_KEY) : `global:${DRAFT_KEY}`,
    LEGACY_DRAFT_KEY,
    LEGACY_QUEUE_KEY,
    LEGACY_AUDIT_KEY,
    AUDIT_QUARANTINE_KEY,
    `global:${AUDIT_STATUS_KEY}`,
    NOTIFICATION_KEY,
    SYNC_CHECKPOINT_KEY,
    WAL_KEY,
    SYNC_TIMESTAMP_KEY,
  ]));
  await attempt(() => clearTelemetryState());
  await attempt(async () => {
    let keys: string[] = [];
    try {
      keys = await AsyncStorage.getAllKeys();
    } catch {
      return;
    }
    for (const key of keys) {
      if (key.startsWith('@elogbook/ratelimit:')) await AsyncStorage.removeItem(key);
    }
  });
  try {
    hooks.clearIdentityCaches?.();
  } catch (error) {
    disposalError ??= error;
  }

  try {
    clearTelemetryIdentity();
    hooks.clearTelemetryIdentity?.();
  } catch (error) {
    disposalError ??= error;
  }
  try {
    hooks.rotatePushContext?.();
  } catch (error) {
    disposalError ??= error;
  }
  await attempt(() => invalidateDbEncryptionKey());
  resetDbEncryptionKeyCacheForTests();
  disposeAuditBuffer();
  const activeAfterDisposal = getAccountContext();
  const shouldClearActiveContext = !contextOverride
    || !activeAfterDisposal
    || !context
    || (activeAfterDisposal.userId === context.userId && activeAfterDisposal.tenantId === context.tenantId && activeAfterDisposal.profileId === context.profileId);
  if (shouldClearActiveContext) clearAccountContext();
  clearPreviousAccountContext();

  if (disposalError) {
    await invalidateDbEncryptionKey().catch(() => undefined);
    throw disposalError;
  }
}
