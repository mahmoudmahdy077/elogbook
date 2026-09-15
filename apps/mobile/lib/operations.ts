/**
 * N2 — typed operation adapters for non-queue writes.
 *
 * Every sensitive screen action runs through runGuardedMutation with a fresh
 * capability and returns a TYPED outcome (confirmed | queued | denied |
 * conflict | transient | terminal). Screens map kinds to fixed copy — raw
 * server error strings never reach UI/telemetry (they go to the logger).
 * Server denial remains authoritative; these adapters only fail fast.
 */

import { canPerform, type SensitiveAction } from './authorization';
import { classifyQueueError } from './durable-queue';
import type { CapabilitySnapshot } from './capability';
import { logInfo, logWarn } from './logger';

export type OpOutcome =
  | { kind: 'confirmed' }
  | { kind: 'denied'; reason: string }
  | { kind: 'transient' }
  | { kind: 'terminal'; copy: string };

const TERMINAL_COPY = 'The server refused this action. Check your role and tenant status, then retry.';

export async function runGuardedMutation(deps: {
  capability: CapabilitySnapshot | null;
  action: SensitiveAction;
  write: () => Promise<unknown>;
}): Promise<OpOutcome> {
  const gate = canPerform(deps.capability, deps.action);
  if (!gate.ok) {
    logWarn('operations.denied', { reason: gate.reason ?? 'denied' });
    return { kind: 'denied', reason: gate.reason ?? 'not permitted' };
  }
  try {
    await deps.write();
    logInfo('operations.confirmed');
    return { kind: 'confirmed' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cls = classifyQueueError(msg);
    if (cls === 'transient') return { kind: 'transient' };
    logWarn('operations.terminal', { errorClass: cls });
    return { kind: 'terminal', copy: TERMINAL_COPY };
  }
}

export async function submitApproval(deps: {
  capability: CapabilitySnapshot | null;
  entryId: string;
  action: 'approve' | 'reject';
  comment?: string;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
}): Promise<OpOutcome> {
  return runGuardedMutation({
    capability: deps.capability,
    action: 'case:approve',
    write: async () => {
      // approve_case/reject_case require the caller's own id (verified server-side).
      const supervisorId = deps.capability?.userId;
      if (!supervisorId) throw new Error('policy: no verified session');
      const { error } = await deps.rpc(deps.action === 'approve' ? 'approve_case' : 'reject_case', {
        p_entry_id: deps.entryId,
        p_supervisor_id: supervisorId,
        p_comment: deps.action === 'reject' ? (deps.comment ?? '') : null,
      });
      if (error) throw new Error(error.message);
    },
  });
}

export async function submitEvaluation(deps: {
  capability: CapabilitySnapshot | null;
  write: () => Promise<unknown>;
}): Promise<OpOutcome> {
  return runGuardedMutation({ capability: deps.capability, action: 'evaluation:create', write: deps.write });
}

export async function submitDutyHours(deps: {
  capability: CapabilitySnapshot | null;
  write: () => Promise<unknown>;
}): Promise<OpOutcome> {
  return runGuardedMutation({ capability: deps.capability, action: 'duty:create', write: deps.write });
}
