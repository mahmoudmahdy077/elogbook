# Clinical core verification evidence

Branch: `remediation/clinical-core-pr`
Base: `main`
Date: 2026-09-28

## Commits on this branch

| Commit | Scope |
| --- | --- |
| `75cdc0f` | Repair the clinical command state machine and pgTAP contract |
| `daf7199` | Route clinical submissions through the API command with per-decision request ids |
| `9a5383f` | Delete the legacy direct clinical state writers |
| `5e382b8` | Enforce draft creation through `save_case_draft` |
| `a820087` | Land the shared request guard and security context modules |
| `f6f1647` | Harden the decision lifecycle, revoke sessions, register Gate D and CI |
| `2d4d38e` | Add correlation logging and block the clinical and boundary gates in CI |
| `4786956` | Add AI boundary schema tests and budget the slow crypto tests |

## Command results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint:all` | pass (0 errors, 8 pre-existing warnings) |
| `pnpm --filter @elogbook/shared test` | pass, 147 |
| `pnpm --filter @elogbook/mobile test` | pass, 450 |
| clinical focused suites (submit, draft, decisions, admin, session, observability, boundary) | pass, 55 + 25 + 63 + 24 + 19 |
| `node scripts/verify-test-inventory.mjs` | pass, 12 suites / 41 database tests |
| `node scripts/verify-request-guards.mjs` | pass |
| `node scripts/verify-agent-boundaries.mjs` | pass |
| `node scripts/verify-secret-containment.mjs` | pass |
| `node scripts/verify-release-containment.mjs` | pass |
| `node scripts/lint-migrations.mjs` | 0 errors, 112 pre-existing warnings |
| `supabase/tests/p1_32_clinical_command_boundary.sql` | static: `plan(23)` with 23 assertions |
| `supabase/tests/p1_34_save_case_draft_command.sql` | static: `plan(20)` with 20 assertions |

## Blocked, not passed

These are recorded as blocked. None of them was counted as a pass.

- **pgTAP execution.** Docker is unavailable on this workstation, so
  `supabase db reset` and `supabase db test` cannot run. Both suites are
  statically consistent and must be executed by the `db-tests` CI job.
- **`pnpm test` as a single green run.** The web package took 1865s and one
  run failed two tests in `app/signup/__tests__/page.test.tsx` with a vitest
  worker-startup timeout. That file passes in isolation. The two genuinely
  slow tests that did time out under load were given explicit budgets in
  `4786956`. A single uninterrupted full-suite pass has not been recorded on
  this workstation because concurrent work saturated the machine.
- **`pnpm build:web`.** Not recorded as passing.
- **Authenticated Playwright clinical journey.** Not recorded as passing.
- **Container boot and `/api/ready`.** Blocked with Docker.

## Residual risk

- The unexpired Supabase `service_role` JWT committed in
  `.hermes/swarm/staff-workflows.mjs`,
  `.hermes/swarm/staff-workflows-cleanup.mjs` and
  `.hermes/swarm/staff-workflows-tombstone-svc.mjs` is still unrotated.
  `verify-secret-containment.mjs` passes because it does not scan history,
  so it does not cover this. Rotation is required before deployment.
- The web UI still exposes identifiable-entry controls in `CaseForm`,
  `QuickAddCase` and `CaseEditForm`. The server refuses identifiable drafts,
  so nothing reaches the database, but the PHI-capable inputs remain.
- `decide_case_command` and `save_case_draft` have not been executed against a
  real database on this branch.

## Rollback class

Reversible by revert. The only schema change on this branch is additive:
`20260926000004` replaces two function bodies and reasserts their grants. No
column is dropped, renamed or retyped, and the committed boundary migration
`20260926000001` is byte-identical to `75cdc0f`.
