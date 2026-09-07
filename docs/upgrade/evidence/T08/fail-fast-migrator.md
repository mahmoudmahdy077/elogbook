# T08 Evidence — Authoritative fail-fast migrations

Ticket: T08 (dependencies: T02, T07)
Status: IMPLEMENTED (clean-install + upgrade catalog replay via CI/drills; no Docker on this host)
Base commit: `b74eefd` + working tree (this ticket)

## Defects fixed in `lib/setup/db-migrator.ts` (F04)

1. Continue-after-error → fail fast. First error stops the run; all
   unattempted files report `skipped`. Proven red pre-fix by the new
   suite (`['success','error','success']` observed).
2. Parallel custom ledger → CLI history adopted. Applied set = UNION of
   Supabase CLI `supabase_migrations.schema_migrations` (read-only; CLI
   bookkeeping stays the CLI's) and the custom table. Absent CLI history
   is normal, not an error.
3. No tamper evidence → sha256 checksum recorded per application
   (`ADD COLUMN IF NOT EXISTS checksum`); a changed already-applied file
   errors with `checksum mismatch` and blocks everything after it — never
   re-run, never blind-mark.
4. No serialization → `pg_advisory_lock(hashtext('elogbook-migrator'))`
   around the run, released in `finally` (matches the T10 one-lock model).
5. Transactional-only execution → `CONCURRENTLY`/`VACUUM`/DB-level files
   run unwrapped with an explicit partial-application warning in the
   error text (migrations 00016/00020/2026082616 use CONCURRENTLY and
   previously failed inside the forced BEGIN).

## Tests

- New `lib/setup/__tests__/db-migrator.test.ts`, 6/6 green (red first,
  above): fail-fast ordering, lock/unlock presence, checksum stability +
  mismatch block, CLI-union skip, non-transactional no-BEGIN/COMMIT.
  `pg` mocked (npm package — mockable, unlike node builtins); migration
  files in real temp dirs.

## Verification

- Suite 6/6, web typecheck 0, web lint 0.
- Setup route already reports `success: errors.length === 0`; with
  fail-fast it can no longer apply later migrations past a failure.

## Deferred (needs hosts/data)

- Clean-install vs upgrade catalog-equivalence replay, rerun idempotency
  against real Postgres, concurrent-runner serialization proof, drift
  verification, old-client contract retention — T27 drills + CI db-tests
  (which exercise real migrations, not this helper).
- Per-installation history inventory and unsupported-adoption paths
  (adjudication amendment) require the owner-attested install list.
