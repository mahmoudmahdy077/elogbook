# T10 Evidence — Durable-job core (bounded substep)

Ticket: T10 (dependency: T09). Executor, HTTP transport, SQLite journal,
and crash-reboot proofs start ONLY after the T09 review sign-off
(threat-model section 7) — explicitly NOT in this batch.
Status: IMPLEMENTED (pure core below; Docker/host proofs BLOCKED to T10-full)

## Implemented (`apps/ops/src/jobs.ts`)

- Full operation state machine from section 5.5 (queued → … → succeeded;
  recovering → recovered/needs_operator; cancelled pre-mutation only).
- Terminal immutability; stale fencing-token rejection; post-mutation
  `failed`/`cancelled` rerouted to explicit recovery errors.
- Idempotent acceptance: same key returns the same job; conflicting
  active job raises (409-style) instead of forking a second executor.
- `Journal` interface + single-writer memory implementation (fencing
  counter included); SQLite backend must satisfy these same semantics.
- `redactSecrets` for bounded executor logs (bearer/password/key=value).

## Tests

- `apps/ops/src/__tests__/jobs.test.ts`, 10/10 green alongside the 7
  bootstrap tests (17/17 package total).
- Red history: initial map forbade queued→failed and mis-scoped cancel;
  two test/implementation rounds corrected map and error precedence with
  failing assertions first.

## Verification

- ops suite 17/17, ops typecheck 0.
- Gate H boundary (no app imports of ops) still green (verified in T09
  batch run; recheck on push via gates.yml).

## Deferred to T10-full (review-gated)

HTTP/Unix-socket transport, per-call auth envelope, SQLite journal +
crash-recovery proofs, constrained executor + allowlists, worker
crash/reboot matrix, cancel/status observability, chaos cases T9.x.
