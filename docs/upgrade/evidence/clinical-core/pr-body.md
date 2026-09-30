## Summary

Remediates the clinical core security and workflow boundaries: all case status
changes now go through database commands, direct clinical writers are gone,
approval and draft paths are guarded, the decision lifecycle returns stable
codes, sessions are revoked on deactivation, clinical commands emit bounded
correlated logs, and the static gates that protect these paths are now enforced
in required CI.

Base: `main`. Branch: `remediation/clinical-core-pr`.

## What changed

- **Command state machine** — the clinical transition is legal only as
  `draft → pending → approved|rejected`, and a rejected case is resubmitted
  through a two-step transition. RLS negative assertions were corrected so they
  test the policy that actually exists.
- **Submit path** — every submission goes through the API command with a
  per-decision `request_id`; the legacy authenticated submit route and the
  unowned request-verification writer are deleted.
- **Draft creation** — new `save_case_draft` command, guarded route, and
  `CaseForm` / `QuickAddCase` / `CaseImport` migrated off direct inserts.
- **Decision lifecycle** — new forward-only migration `20260926000004` returns
  `account_inactive` and `tenant_suspended` instead of raising, selects only a
  locked `pending` approval, fails closed on an already-resolved request, and
  rejects a null role. The committed boundary migration `20260926000001` is
  byte-identical to its original commit.
- **Session revocation** — admin deactivate/reactivate goes through
  `admin_set_profile_status` and bans the auth user, so live sessions stop.
- **Notification ownership** — approvals resolve the resident auth user and send
  a generic body with no clinical detail and no webhook copy.
- **Observability** — `resolveCorrelationId` takes a validated
  `x-correlation-id` or mints a UUID. The client `request_id` is never used as
  the correlation ID. Only command, opaque case/tenant ids, duration and result
  code are logged; a repeated header is rejected so layers cannot disagree.
- **Release gates** — a required `static-gates` job runs
  `verify-request-guards`, `verify-agent-boundaries` and `verify-test-inventory`
  with no `continue-on-error`. `p1_32` and `p1_34` are registered in Gate D and CI.

## Blocked, not passed

These are recorded as blocked. None is claimed as a pass.

- **pgTAP execution and container boot.** Docker is unavailable on the author
  workstation, so `supabase db reset` and `supabase db test` could not run. Both
  suites are statically consistent (`p1_32` `plan(23)` with 23 assertions,
  `p1_34` `plan(20)` with 20 assertions) and must be executed by the `db-tests`
  CI job. **This PR must not be merged until `db-tests` is green.**
- **`pnpm build:web`** and the authenticated Playwright clinical journey are not
  recorded as passing.
- **A single uninterrupted full `pnpm test` run** is not recorded. The web
  package exceeded 50 minutes under concurrent machine load. Two genuinely slow
  tests were timing out rather than failing and now carry explicit budgets; every
  other package suite passes (shared 147, mobile 450).

## Test commands

```
pnpm typecheck
pnpm lint:all
pnpm --filter @elogbook/shared test
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/web test
node scripts/verify-test-inventory.mjs
node scripts/verify-request-guards.mjs
node scripts/verify-agent-boundaries.mjs
node scripts/verify-secret-containment.mjs
node scripts/verify-release-containment.mjs
node scripts/lint-migrations.mjs
```

## Rollback class

Reversible by revert. The only schema change is additive: `20260926000004`
replaces two function bodies and reasserts their grants. No column is dropped,
renamed or retyped, and no data is rewritten. A revert restores the previous
function bodies; a forward-fix requires a new migration.

## Residual risk

- **An unexpired Supabase `service_role` JWT is committed** in
  `.hermes/swarm/staff-workflows.mjs`, `.hermes/swarm/staff-workflows-cleanup.mjs`
  and `.hermes/swarm/staff-workflows-tombstone-svc.mjs` in `main` history.
  `verify-secret-containment.mjs` passes because it does not scan history, so it
  does not cover this. **The credential must be rotated before any deployment.**
  This PR neither rotates it nor removes it from history.
- The web UI still exposes identifiable-entry controls in `CaseForm`,
  `QuickAddCase` and `CaseEditForm`. The server refuses identifiable drafts, so
  nothing reaches the database, but the PHI-capable inputs remain and are
  tracked as follow-up work.
- `decide_case_command` and `save_case_draft` have not executed against a real
  database on this branch; `db-tests` in CI is the first real execution.
