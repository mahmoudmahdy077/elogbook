/**
 * Durable-job core (T10, bounded substep).
 *
 * Pure state machine + journal interface + idempotent acceptance + log
 * redaction. Deliberately NO transport (HTTP/Unix socket), NO process
 * spawning, NO Docker access here: the constrained executor and its
 * command allowlists start only after the T09 review sign-off
 * (docs/upgrade/evidence/T09/threat-model.md section 7).
 *
 * Journal persistence (SQLite, single writer, crash recovery) is T10-full;
 * `createMemoryJournal` implements the same interface for tests and dev.
 */

export type OperationType = 'install' | 'backup' | 'restore' | 'update' | 'recover';

export type OperationStatus =
  | 'queued'
  | 'validating'
  | 'acquiring_lock'
  | 'backing_up'
  | 'backup_verified'
  | 'staging'
  | 'maintenance'
  | 'migrating'
  | 'switching'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'recovering'
  | 'recovered'
  | 'needs_operator'
  | 'cancelled';

export interface Operation {
  id: string;
  type: OperationType;
  installationId: string;
  idempotencyKey: string;
  status: OperationStatus;
  /** Monotonic fencing token: only the holder may advance the operation. */
  fencingToken: number;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  log: string[];
}

const FORWARD: Record<OperationStatus, readonly OperationStatus[]> = {
  // Pre-mutation states accept failed/cancelled; post-mutation states
  // accept recovering (never plain failed/cancelled).
  queued: ['validating', 'failed', 'cancelled'],
  validating: ['acquiring_lock', 'failed', 'cancelled'],
  acquiring_lock: ['backing_up', 'failed', 'cancelled'],
  backing_up: ['backup_verified', 'failed', 'cancelled'],
  backup_verified: ['staging', 'failed', 'cancelled'],
  staging: ['maintenance', 'failed', 'cancelled'],
  maintenance: ['migrating', 'recovering'],
  migrating: ['switching', 'recovering'],
  switching: ['verifying', 'recovering'],
  verifying: ['succeeded', 'recovering'],
  succeeded: [],
  failed: [],
  recovering: ['recovered', 'needs_operator'],
  recovered: [],
  needs_operator: [],
  cancelled: [],
};

const TERMINAL: ReadonlySet<OperationStatus> = new Set([
  'succeeded',
  'failed',
  'recovered',
  'needs_operator',
  'cancelled',
]);

/** States at or after which host mutation may have happened. */
const POST_MUTATION: ReadonlySet<OperationStatus> = new Set([
  'migrating',
  'switching',
  'verifying',
  'recovering',
  'recovered',
  'needs_operator',
]);

let idCounter = 0;

export function createOperation(args: {
  type: OperationType;
  installationId: string;
  idempotencyKey: string;
  now?: number;
}): Operation {
  if (!args.installationId) throw new Error('installationId is required');
  if (!args.idempotencyKey) throw new Error('idempotencyKey is required');
  const now = args.now ?? Date.now();
  idCounter += 1;
  return {
    id: `op_${now.toString(36)}_${idCounter.toString(36)}`,
    type: args.type,
    installationId: args.installationId,
    idempotencyKey: args.idempotencyKey,
    status: 'queued',
    fencingToken: 1,
    attempt: 1,
    createdAt: now,
    updatedAt: now,
    log: [],
  };
}

export function applyTransition(
  op: Operation,
  next: OperationStatus,
  args: { now?: number; fencingToken: number; error?: string },
): Operation {
  if (TERMINAL.has(op.status)) {
    throw new Error(`terminal operation ${op.id} (${op.status}) cannot transition`);
  }
  if (args.fencingToken !== op.fencingToken) {
    throw new Error(`stale fencing token for ${op.id}: worker was fenced`);
  }
  // Failure after mutation must route to recovery, never plain failed.
  if (next === 'failed' && POST_MUTATION.has(op.status)) {
    throw new Error(`use recovering (not failed) for post-mutation failure of ${op.id}`);
  }
  // Cancellation is only meaningful before mutation began; afterwards
  // the operator must drive recovery explicitly.
  if (next === 'cancelled' && POST_MUTATION.has(op.status)) {
    throw new Error(`cannot cancel ${op.id} after mutation began (${op.status})`);
  }
  if (!FORWARD[op.status].includes(next)) {
    throw new Error(`invalid transition ${op.status} -> ${next} for ${op.id}`);
  }
  return {
    ...op,
    status: next,
    updatedAt: args.now ?? Date.now(),
    error: args.error ?? (next === 'failed' || next === 'recovering' ? op.error : undefined),
    log: [...op.log],
  };
}

export interface Journal {
  save(op: Operation): void;
  load(id: string): Operation | null;
  findByIdempotencyKey(installationId: string, key: string): Operation | null;
  activeFor(installationId: string): Operation | null;
  list(installationId: string): Operation[];
  nextFencingToken(): number;
}

/** Process-local journal. T10-full replaces persistence, not semantics. */
export function createMemoryJournal(): Journal {
  const ops = new Map<string, Operation>();
  let fencing = 1;
  return {
    save(op) {
      ops.set(op.id, structuredClone(op));
    },
    load(id) {
      const op = ops.get(id);
      return op ? structuredClone(op) : null;
    },
    findByIdempotencyKey(installationId, key) {
      for (const op of ops.values()) {
        if (op.installationId === installationId && op.idempotencyKey === key) {
          return structuredClone(op);
        }
      }
      return null;
    },
    activeFor(installationId) {
      for (const op of ops.values()) {
        if (op.installationId === installationId && !TERMINAL.has(op.status)) {
          return structuredClone(op);
        }
      }
      return null;
    },
    list(installationId) {
      return [...ops.values()]
        .filter((op) => op.installationId === installationId)
        .map((op) => structuredClone(op));
    },
    nextFencingToken() {
      fencing += 1;
      return fencing;
    },
  };
}

/**
 * Idempotent submission: the same key returns the same job (409-style
 * conflict when another job is active). Callers surface duplicates and
 * conflicts distinctly — a retry must never fork a second executor.
 */
export function acceptIdempotent(
  journal: Journal,
  args: { type: OperationType; installationId: string; idempotencyKey: string; now?: number },
): Operation {
  const existing = journal.findByIdempotencyKey(args.installationId, args.idempotencyKey);
  if (existing) return existing;
  const active = journal.activeFor(args.installationId);
  if (active) {
    throw new Error(
      `conflicting operation ${active.id} (${active.type}/${active.status}) holds the installation lock`,
    );
  }
  const op = createOperation(args);
  journal.save(op);
  return op;
}

/** Mask secret material in bounded executor logs. Best-effort, fail-safe. */
export function redactSecrets(line: string): string {
  return line
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, 'Bearer [REDACTED]')
    .replace(/\b(PGPASSWORD|api_key|apikey|secret|passwd|password|token)\s*=\s*\S+/gi, '$1=[REDACTED]');
}
