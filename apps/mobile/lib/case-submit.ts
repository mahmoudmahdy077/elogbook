/**
 * M3 — the real case submit path (single queue format).
 *
 * Screens call submitCase() instead of touching Supabase or any queue
 * directly. Outcomes are honest:
 *  - submitted: server confirmed (canonical server id when returned).
 *  - queued-locally: transient-network failure persisted an encrypted op
 *    with a stable client_operation_id; UI must say "saved on this device",
 *    never "submitted".
 *  - rejected: capability denial or non-transient server refusal. Nothing
 *    is stored; the caller surfaces the reason. Server denial is final.
 */

import { canPerform, type SensitiveAction } from './authorization';
import { isCapabilityFresh } from './capability';
import { classifyQueueError, enqueueDurable, newOperationId } from './durable-queue';
import type { CapabilitySnapshot } from './capability';
import { logInfo, logWarn } from './logger';

export type SubmitAction = 'insert' | 'update' | 'delete';

export type SubmitOutcome =
  | { kind: 'submitted'; serverId: string | null }
  | { kind: 'queued-locally'; opId: string }
  | { kind: 'rejected'; reason: string };

export interface SubmitDeps {
  capability: CapabilitySnapshot | null;
  insertRow: (payload: Record<string, unknown>) => Promise<{ serverId?: string | null }>;
  updateRow: (targetId: string, payload: Record<string, unknown>) => Promise<unknown>;
}

const ACTION_GATE: Record<SubmitAction, SensitiveAction> = {
  insert: 'case:create',
  update: 'case:edit',
  delete: 'case:delete',
};

export async function submitCase(
  deps: SubmitDeps,
  input: { action: SubmitAction; targetId?: string; payload: Record<string, unknown> },
): Promise<SubmitOutcome> {
  const cap = deps.capability;
  if (!cap) {
    // N1 fail-closed: no verified session — nothing is attempted or stored
    // here (the screen's encrypted draft autosave already holds the work).
    return {
      kind: 'rejected',
      reason: 'No verified session — your draft is saved on this device. Sign in and retry.',
    };
  }
  const gate = canPerform(cap, ACTION_GATE[input.action]);
  if (!gate.ok) {
    logWarn('case-submit.denied', { reason: gate.reason ?? 'denied' });
    return { kind: 'rejected', reason: gate.reason ?? 'not permitted' };
  }

  // N1 mode match BEFORE any persistence: the requested de-identification
  // must equal the server policy mode. Server denial stays final.
  const flag = input.payload.is_deidentified;
  const requestedMode = typeof flag === 'boolean' ? (flag ? 'deidentified' : 'identifiable') : null;
  if (requestedMode && requestedMode !== cap.dataMode) {
    logWarn('case-submit.mode-mismatch');
    return {
      kind: 'rejected',
      reason: `This tenant uses ${cap.dataMode} records — switch the case mode and retry. Nothing was saved.`,
    };
  }

  // One operation ID per submit attempt, shared by the online try and the
  // queued retry: a crash between server success and local bookkeeping
  // cannot fork a duplicate row (server upserts on client_operation_id).
  const opId = newOperationId();

  if (!isCapabilityFresh(cap)) {
    // N1 offline policy: a stale snapshot never authorizes a blind server
    // write. Queue locally only with an explicit mode match; otherwise reject.
    if (!requestedMode) {
      return { kind: 'rejected', reason: 'Session needs refresh before this can be saved. Retry when online.' };
    }
    const queuedPayload =
      input.action === 'insert' ? { ...input.payload } : { ...input.payload, id: input.targetId };
    await enqueueDurable('case_entries', input.action, queuedPayload, { opId });
    logInfo('case-submit.queued-locally');
    return { kind: 'queued-locally', opId };
  }

  try {
    if (input.action === 'insert') {
      const res = await deps.insertRow({ ...input.payload, client_operation_id: opId });
      logInfo('case-submit.submitted');
      return { kind: 'submitted', serverId: res?.serverId ?? null };
    }
    if (!input.targetId) return { kind: 'rejected', reason: 'missing target id' };
    await deps.updateRow(input.targetId, { ...input.payload, client_operation_id: opId });
    logInfo('case-submit.submitted');
    return { kind: 'submitted', serverId: input.targetId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cls = classifyQueueError(msg);
    if (cls === 'transient') {
      const queuedPayload =
        input.action === 'insert' ? { ...input.payload } : { ...input.payload, id: input.targetId };
      try {
        await enqueueDurable('case_entries', input.action, queuedPayload, { opId });
      } catch (queueErr) {
        // N3: a full/unwritable queue is an explicit rejection, never a throw
        // into the screen (which would surface as a crash, not guidance).
        const qmsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
        logWarn('case-submit.queue-full');
        return { kind: 'rejected', reason: `${qmsg}. Free space by syncing, then retry.` };
      }
      logInfo('case-submit.queued-locally');
      return { kind: 'queued-locally', opId };
    }
    logWarn('case-submit.rejected', { errorClass: cls });
    return { kind: 'rejected', reason: msg };
  }
}
