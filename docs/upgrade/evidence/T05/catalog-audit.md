# T05 Evidence — Final-schema tenant/security audit

Ticket: T05 (dependencies: T02, T04)
Status: IMPLEMENTED (fresh-install + upgrade catalog replay BLOCKED: no Docker; CI db-tests is the gate)
Base commit: `ea03ee9` + working tree (this ticket)

## Catalog inventory (source-observed)

- 167 migrations (166 + this ticket's drop); 18 files set FORCE RLS;
  RLS-bearing tables covered by 00049/00096/2026082615 sweeps.
- Privileged surface: ~30 SECURITY DEFINER `public.*` functions (RPCs,
  triggers, crypto helpers). No app-code references to debug functions.
- Storage: `case-attachments` private (20MB, allowlisted MIME); 4
  tenant-folder policies (select/insert/update/delete) in 2026082526.
- Seeds create NO auth users (verified by tree search): demo accounts are
  manual-only; `00095` purges demo tenant/accounts in prod when the demo
  GUC is unset. No action needed.

## Live probes (demo project, 2026-09-07, non-mutating unless noted)

| Probe | Result |
|---|---|
| Resident read `case_entries` with forged `tenant_id` | 0 rows (PASS) |
| Resident INSERT with forged `tenant_id` | 403 denied (PASS) |
| Resident read `audit_logs` with forged `tenant_id` | 0 rows (PASS) |
| Anon `GET /storage/v1/bucket` | 200 `[]` — no disclosure (checked, not a finding) |
| Resident list `case-attachments` root | 0 rows (checked) |
| institution_admin PATCH own `role`→`admin` (T04 probe) | P0001 MFA-block, role unchanged |

## Fix in this ticket (one defect)

- Debug artifacts survived into fresh installs: `_swarm_debug_results`
  table + `debug_exp_tombstone()`, `debug_policies_full()`,
  `dbg_cap_deleted()` (all SECURITY DEFINER, callable). The earlier drop
  (2026082507) predates the migrations recreating them.
- New migration `20260907000001_drop_debug_artifacts.sql` (IF EXISTS,
  history untouched) + pgTAP `p2_10_no_debug_artifacts.sql` asserting
  absence from `pg_proc`/`pg_tables`; wired into blocking CI db-tests.

## Files changed

- `supabase/migrations/20260907000001_drop_debug_artifacts.sql`
- `supabase/tests/p2_10_no_debug_artifacts.sql`
- `.github/workflows/ci.yml` (suite list)

## Unverified / next

- Fresh-install replay + upgrade-convergence catalog diff needs Docker
  (T08 owns the migrator; CI executes the suites).
- T04c candidate (assign-role tenant-scoping) and per-route integration
  tests remain under the service-role inventory (`docs/service-role-
  inventory.md`); T05 found no additional live isolation failures.
