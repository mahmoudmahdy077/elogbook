# Clinical Core Baseline Evidence

**Date:** 2026-09-23
**Branch:** `remediation/clinical-core-pr`
**Base HEAD:** `e787191`
**Working tree:** intentionally dirty; pre-existing remediation work preserved

## Commands and results

| Command | Result | Evidence/limit |
| --- | --- | --- |
| `pnpm typecheck` | PASS (exit 0) | Required temporary PATH entry: `C:\Program Files\nodejs`; pnpm shim otherwise could not resolve node. |
| `node scripts/verify-test-inventory.mjs` | PASS | 12 required suites and 39 database tests registered. |
| `node scripts/verify-release-containment.mjs` | PASS | Reported pass markers in CD, deploy-web, and deploy-mobile workflows. |
| `node scripts/verify-secret-containment.mjs` | PASS (exit 0) | Working-tree scanner passed; this is not sufficient evidence of history safety. |
| `node scripts/verify-request-guards.mjs` | PASS | Route request-guard coverage marker. |
| `node scripts/verify-agent-boundaries.mjs` | PASS | Agent boundary marker. |
| `pnpm --filter @elogbook/web test -- lib/cases/__tests__/submit-flow.test.ts lib/__tests__/clinical-command-boundary.test.ts` | PASS (34 tests) | Focused unit/static tests do not execute the real Supabase command path. |
| `supabase --version` | PASS | CLI 2.109.1 available. |
| `docker --version` | BLOCKED | Docker executable unavailable; database replay, container boot, and restore qualification cannot run locally. |

## Confirmed blockers before implementation

1. `p1_32_clinical_command_boundary.sql` currently expects synthetic `42501` exceptions for RLS-filtered updates, but PostgreSQL `USING` filters rows without raising. The assertions must prove no-op state instead.
2. `submit_case_command` currently attempts `rejected -> pending` directly while the state machine allows `rejected -> draft`; the command needs a legal two-step transition inside one transaction.
3. The current client submit path is not proven to resolve `/api/{tenant}/cases/{id}/submit`; static tests assert only that a submit string exists.
4. The approval route requires `request_id`, but caller coverage must be verified for every approval caller.
5. Legacy authenticated routes still contain direct clinical/approval writers and must be removed or migrated.
6. `decide_case_command` raises for some denials while the route contract expects stable JSON codes; notification ownership and session revocation also require verification.
7. An unexpired Supabase `service_role` JWT is reachable from `origin/main` in three tracked `.hermes` files. Values are not recorded here. Rotation/revocation is an external operator action and blocks any deployment or PHI operation.
8. The working-tree secret scanner returning pass does not invalidate the independent history finding; the scanner's history coverage is insufficient and must be addressed before release.

## Limits

No production database, deployed environment, container, browser session, or credential rotation was performed. No secret value, environment file content, or patient data is recorded in this evidence file.
