/**
 * Bootstrap setup-progress model (T12, bounded substep).
 *
 * The 9 steps of section 5.3 as data. The T12-full GUI renders this model;
 * the T10-full manager persists per-step state in its journal (progress =
 * persisted steps, so refresh/reconnect resumes the same operation).
 * Cancellation before irreversible steps is representable; automatic
 * deletion never is. Full browser flow + adoption workflow need the
 * manager HTTP layer (BLOCKED on T10-full review gate).
 */

export interface SetupStepDef {
  id: string;
  title: string;
  /** Retry of a failed step is safe. */
  reversible: boolean;
  /** Step may only run after these step ids are done. */
  requires: string[];
}

export const SETUP_STEPS: readonly SetupStepDef[] = [
  { id: 'claim', title: 'Claim installation', reversible: true, requires: [] },
  { id: 'preflight', title: 'Preflight checks', reversible: true, requires: ['claim'] },
  { id: 'domains', title: 'Domains and services', reversible: true, requires: ['preflight'] },
  { id: 'review', title: 'Review plan', reversible: true, requires: ['domains'] },
  { id: 'provision', title: 'Provision stack', reversible: false, requires: ['review'] },
  { id: 'schema', title: 'Schema and functions', reversible: false, requires: ['provision'] },
  { id: 'operator', title: 'Operator and tenant', reversible: false, requires: ['schema'] },
  { id: 'verify', title: 'Verify and hand over', reversible: true, requires: ['operator'] },
  { id: 'close', title: 'Close bootstrap', reversible: false, requires: ['verify'] },
];

export type SetupStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface SetupStepState {
  id: string;
  status: SetupStepStatus;
  error?: string;
}

export interface SetupProgress {
  overall: 'in-progress' | 'failed' | 'complete';
  currentStepId: string | null;
  failed: string[];
  canRetry: boolean;
  /** False only when every step is done: bootstrap ingress must be closed. */
  bootstrapOpen: boolean;
}

const KNOWN = new Map(SETUP_STEPS.map((s) => [s.id, s]));

export function setupProgress(states: SetupStepState[]): SetupProgress {
  const byId = new Map<string, SetupStepStatus>();
  for (const s of states) {
    if (!KNOWN.has(s.id)) throw new Error(`unknown setup step: ${s.id}`);
    byId.set(s.id, s.status);
  }
  const failed = SETUP_STEPS.filter((s) => byId.get(s.id) === 'failed').map((s) => s.id);
  if (failed.length > 0) {
    return { overall: 'failed', currentStepId: failed[0], failed, canRetry: true, bootstrapOpen: true };
  }
  const next = SETUP_STEPS.find((s) => byId.get(s.id) !== 'done');
  if (!next) {
    return { overall: 'complete', currentStepId: null, failed: [], canRetry: false, bootstrapOpen: false };
  }
  return { overall: 'in-progress', currentStepId: next.id, failed: [], canRetry: false, bootstrapOpen: true };
}
