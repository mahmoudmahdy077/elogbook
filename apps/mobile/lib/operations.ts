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

/**
 * A request id for the decide command's idempotency ledger.
 *
 * The command is keyed by (tenant, actor, command, request_id): a retried tap
 * replays the stored decision instead of approving twice, and the same key with
 * different input is rejected. Generated per call, so a retry that means to
 * re-decide gets a fresh key and a retry of the same tap does not.
 */
function requestId(): string {
  const bytes = new Uint8Array(16);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webcrypto = (globalThis as any).crypto;
  if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
    throw new Error('policy: no secure random source');
  }
  webcrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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

/**
 * A supervisor decision, through decide_case_command.
 *
 * approve_case and reject_case are retired: they wrote the status and the
 * approval request with no idempotency ledger, no tenant match on the request
 * and no outbox row, so a retry could approve twice and a decision could land
 * on a case in another tenant's queue. decide_case_command resolves one locked
 * pending request in the same transaction as the status change and requires a
 * live AAL2 claim, and it is the only path the client can reach.
 */
export async function submitApproval(deps: {
  capability: CapabilitySnapshot | null;
  entryId: string;
  action: 'approve' | 'reject';
  comment?: string;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data?: { success?: unknown; error?: unknown } | null;
    error: { message: string } | null;
  }>;
}): Promise<OpOutcome> {
  return runGuardedMutation({
    capability: deps.capability,
    action: 'case:approve',
    write: async () => {
      // The command is AAL2-gated, so a session that is not re-authenticated is
      // refused server-side. The client gate is fail-fast only.
      if (!deps.capability?.userId) throw new Error('policy: no verified session');
      const result = await deps.rpc('decide_case_command', {
        p_case_id: deps.entryId,
        p_request_id: requestId(),
        p_decision: deps.action,
        p_reason: deps.action === 'reject' ? (deps.comment ?? null) : null,
      });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.success !== true) throw new Error('approval conflict');
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
