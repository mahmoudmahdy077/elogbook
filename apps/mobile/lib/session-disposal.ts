/**
 * M1.3 — context disposal on sign-out / account switch.
 *
 * - Stops registered workers (sync timers, listeners) via callbacks.
 * - Cancels in-flight requests via registered abort callbacks.
 * - Clears in-memory identity (telemetry user/session, cached keys).
 * - Wipes the outgoing draft (AsyncStorage scoped key) and removes the
 *   legacy plaintext remnant.
 * - Quarantines queued work: items stay under the OLD scope key (never
 *   deleted, never visible to the new scope) for the next sign-in of the
 *   same account or explicit user recovery.
 * - Rotates push context + clears notification identity via callbacks.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAccountContext, scopedKey } from './account-context';
import { resetDbEncryptionKeyCacheForTests } from './db/encryption-key';
import { clearTelemetryQueue } from './production/telemetry';
import { disposeAuditBuffer } from './security/audit-trail';

export interface DisposalHooks {
  stopWorkers?: Array<() => void>;
  abortRequests?: Array<() => void>;
  clearTelemetryIdentity?: () => void;
  rotatePushContext?: () => void;
}

const DRAFT_KEY = 'case_form_draft.v1';
const LEGACY_DRAFT_KEY = 'case_form_draft';

export async function disposeAccountContext(hooks: DisposalHooks = {}): Promise<void> {
  for (const stop of hooks.stopWorkers ?? []) {
    try {
      stop();
    } catch {
      // best-effort
    }
  }
  for (const abort of hooks.abortRequests ?? []) {
    try {
      abort();
    } catch {
      // best-effort
    }
  }
  // Wipe outgoing draft + legacy remnant BEFORE dropping the scope pointer.
  try {
    await AsyncStorage.removeItem(scopedKey(DRAFT_KEY));
  } catch {
    // best-effort
  }
  try {
    await AsyncStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    // best-effort
  }
  // Durable queue items stay under the old scope key (quarantine, not loss).
  // Audit buffer: stop its flush worker and drop memory; the persisted
  // scoped copy stays under the old scope (quarantine, not loss).
  try {
    disposeAuditBuffer();
  } catch {
    // best-effort
  }
  // The analytics event queue is wiped (identity + behavior must not leak).
  try {
    await clearTelemetryQueue();
  } catch {
    // best-effort
  }
  try {
    hooks.clearTelemetryIdentity?.();
  } catch {
    // best-effort
  }
  try {
    hooks.rotatePushContext?.();
  } catch {
    // best-effort
  }
  resetDbEncryptionKeyCacheForTests();
  clearAccountContext();
}
