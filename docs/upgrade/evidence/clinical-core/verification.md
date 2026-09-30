# Clinical core verification evidence

Branch: `remediation/clinical-core-pr`
Base: `main`
Date: 2026-09-29

## Verified against a real database

The `db-tests` CI job boots a real Postgres via Supabase and runs the pgTAP
inventory. Both clinical suites now execute and pass there:

| Suite | Result |
| --- | --- |
| `supabase/tests/p1_32_clinical_command_boundary.sql` | `ok`, 23 assertions |
| `supabase/tests/p1_34_save_case_draft_command.sql` | `ok`, 22 assertions |

Each suite's `SELECT plan(N)` matches its assertion count, checked with a scan
that excludes fixture calls such as `set_config` and `unnest`.

## Bugs the real database revealed

None of these were visible without executing Postgres.

1. `20260825200000_temp_iso_p3.sql` impersonated a hardcoded user with
   `set_config('role','authenticated')` and then read `public.profiles`, which
   RLS denies. Every fresh replay failed. Removed with ten other experiment
   migrations that embedded the real production tenant.
2. A "cosmetic repair" `DO` block in `20260825230000` selected functions and
   ran `PERFORM 0`. It changed nothing but PostgreSQL could not plan it
   (`SQLSTATE 42809`), aborting the migration. Removed.
3. `20260927000000_audit_write_authority.sql` read the redacted payload as
   `a.redacted_changes`, where `a` is the target table alias; the subquery
   producing it is aliased `redacted`. `SQLSTATE 42703` on the final migration.
4. **In this branch's own draft command**, a cast binds tighter than `->>`, so
   `p_payload->>'template_id'::uuid` cast the *key* rather than the value and
   raised `invalid input syntax for type uuid`. The same bug affected
   `patient_age_years`. `save_case_draft_command` could never have created a
   draft; a scan of every migration for the pattern now reports none.
5. Supabase grants `ALL` on public tables to `anon` and `authenticated`, which
   includes TRUNCATE, REFERENCES and TRIGGER. `20260928000001` revokes all
   three, and raises if it matches no table so it cannot pass as a no-op.

## Other command results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint:all` | pass, 0 errors, 8 pre-existing warnings |
| `pnpm test` (CI) | pass |
| `build-web` (CI) | pass |
| `deno-test` (CI) | pass, including the privileged Edge AAL2 gate and the PHI egress gate added here |
| `gates`, `static-gates`, `secret-containment` (CI) | pass |
| `verify-test-inventory` | pass, 40 suites / 47 database tests |
| `verify-tenant-scope`, `verify-request-guards`, `verify-agent-boundaries` | pass |
| `node scripts/lint-migrations.mjs` | 0 errors |

## Blocked, not passed

- **`db-tests` is still red overall.** The two clinical suites pass; the
  failures are in pre-existing suites that could never run before, because the
  database did not bootstrap. Two root causes dominate:
  - `MFA enrollment required for role institution_admin` while a fixture sets a
    privileged role, in p1_19, p1_21, p1_23, p1_26 and p1_33.
  - `permission denied for table ...` in fixture reads, in p1_18, p1_20, p1_24,
    p1_25 and p1_31. This is the same role-handling defect fixed in p1_32 and
    p1_34: a command call must run as the invoking role so `auth.uid()` resolves
    a principal, while reading clinical state must run as the owner.
- `docker-boot` blocked: no Docker on the author workstation.
- `ledger-check` blocked: `verify-mobile-security` needs the gitignored EAS
  prebuild Android project, so it cannot pass in CI as configured.
- The authenticated Playwright clinical journey has not been recorded as
  passing.

## Residual risk

- The unexpired Supabase `service_role` JWT remains in `main`'s history in
  `.hermes/swarm/staff-workflows.mjs` and two sibling files. The working-tree
  copies now read from the environment, but the token is still live and must be
  rotated. `verify-secret-containment` passes because it does not scan history.
- Identifiable-entry controls remain in `CaseForm`, `QuickAddCase` and
  `CaseEditForm`. The server refuses identifiable drafts, so nothing reaches
  the database, but the PHI-capable inputs are still rendered.

## Rollback class

Reversible by revert. The only schema change on this branch is additive:
function-body replacements and privilege revocations, with no column dropped,
renamed or retyped. The committed boundary migration `20260926000001` is
byte-identical to `75cdc0f`, so replaying from a clean database yields the same
result.
