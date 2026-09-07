# T14 Evidence — Update-plan builder (bounded substep)

Ticket: T14 (dependencies: T07–T08, T10, T13). Execution (fence,
migrate, switch, drain, verify, induced-failure matrix, N→N+1 workflow
proofs) needs the review-gated executor + VPS and is BLOCKED there.
Status: IMPLEMENTED (plan model below)

## Delivered (`apps/ops/src/update-plan.ts`)

- `buildUpdatePlan` produces ordered steps (preflight → backup →
  verify-backup → stage → [maintenance] → [migrate] → candidate-verify
  → switch → drain) plus the adjudication-mandated rollback record:
  strategy (image-only / schema-compatible / restore-based),
  irreversible migrations, max window, expected data loss, exact
  operator action.
- Incompatible transitions and missing required backups BLOCK with
  reasons instead of planning (6/6 suite).
- Consumes T11 preflight/merge and T13 compatibility data by shape;
  drives `jobs.ts` update operations in T14-full.

## Verification

- Suite 6/6 (package 46/46), ops typecheck 0, gate H 0 (run with push).

## Deferred to T14-full

Preflight/backup/fence execution, expand/contract migration runs,
candidate health + traffic switch + drain, compatible-rollback proof,
induced-failure matrix, web-restart/page-reload job survival.
