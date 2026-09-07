# T07 Evidence — Backup shell correctness (bounded substep)

Ticket: T07 (dependency: T02, T06). Full encrypted off-host backup,
escrow, rotation, monitoring owner, and the `apps/ops` durable flow are
EXPLICITLY DEFERRED: key custodian/escrow/rotation/compromise-response
decisions require the owner (adjudication amendment), and durable
execution belongs to T09/T10. This substep fixes the shell defects (F03)
that would corrupt any backup regardless of owner.
Status: IMPLEMENTED (local verification below; Docker drills belong to T27)

## Fixes (one file, `lib/setup/backup-manager.ts`)

1. Dump pipeline gains `set -o pipefail` (was: failed pg_dump → valid
   gzip → success manifest). Integrity gate added: `gzip -t` + non-empty
   check; failure deletes the partial dir and throws (no success manifest).
2. Restore pipeline gains pipefail + `psql -v ON_ERROR_STOP=1` (was:
   partial restore reported success).
3. Restore fails loudly when the manifest claims a database dump that is
   absent (was: silent success). Manifest is parsed defensively.
4. Retention floor is absolute via `shouldDeleteBackup` (was: over-quota
   stores breached `minimum_kept`); over-quota-at-floor emits a loud
   server warning instead of silently deleting.
5. Manifest honesty: `ssl_certs` no longer claims true for a copied
   Caddyfile (live certs live in the Caddy data volume; recovery
   re-issues via ACME until manager-owned escrow exists).
6. Traversal guard made portable (`path.relative` instead of POSIX
   `startsWith`; the old check rejected every path on Windows).

## Tests

- New `lib/setup/__tests__/backup-manager.test.ts`, 10/10 green:
  pipefail strings, ON_ERROR_STOP, floor-hold over quota, aged-excess
  deletion, traversal reject/neutralize. Pure exported seams
  (`buildDumpCommand`, `buildRestoreCommand`, `shouldDeleteBackup`,
  `safeBackupDirIn`) — no builtin mocking (empirically non-functional
  in this repo's Vitest setup; documented, not fought).
- Initial suite was RED (6/6) against the unfixed module for the
  identified reasons (missing pipefail/ON_ERROR_STOP/floor); green
  after the fix. One test expectation corrected during development
  (embedded traversal is neutralized by basename — verified with node
  path semantics, not assumed).

## Verification

- Suite 10/10, web typecheck 0, web lint 0.
- Runner image already carries `postgresql-client` (T06) for these paths.

## Deferred (owner + T09/T10/T27)

- Key custodian, escrow/recovery ceremony, rotation + compromise
  response, partial-restore policy, monitoring/alert owner.
- Durable jobs, crash recovery, off-host verification, restore drills
  with RPO/RTO measurement, retention holds.
