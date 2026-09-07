# T16 Evidence — Management surface (bounded substep)

Ticket: T16 (dependencies: T12–T15, T17 — T17 landed this batch).
Full one-action qualified updates need the review-gated executor
(T10-full/T14); concurrent-job 409s and outage-proof management come
with it. This substep makes the surface honest and correctly gated.
Status: IMPLEMENTED

## Changes

- `api/update/check`: tenant ADMIN_ROLES → `requirePlatformAdmin`
  (directors/institution_admins denied by API and UI); response adds
  backup freshness (`count`/`latest_at`/`latest_id`) the operator must
  confirm. Version states pass through unchanged (T13).
- `api/update/execute`: platform gate replaces the `admin`-label check;
  weak per-route AAL2 block removed (guard enforces strictly); the
  synchronous git-pull/compose updater (F02) is retired behind
  `ELOGBOOK_LEGACY_UPDATER=true` (non-production recovery only) —
  default is 503 `unavailable` with an explanatory message, never fake
  success. Input validation and audit preserved (audit uses the
  operator's home profile tenant).
- `app/update/page.tsx`: backup-status line alongside the per-component
  states; checkboxes only for actionable updates (T13).
- `SETUP_COMPLETE_PATH` env seam in both routes (prod path unchanged)
  for hermetic tests.

## Tests

- New `app/api/update/__tests__/management.test.ts`, 5/5 (red first:
  4×400/200-vs-expected from the old gates and missing seam).
- Re-ran platform-guard suite: 11/11 combined green.

## Verification

- management 5/5, web typecheck 0, lint 0.

## Deferred to T16-full (executor-gated)

Job submission/status/reconnect UI, 409 concurrency proof, history with
redacted diagnostics, recovery-point display, maintenance banner wiring,
management availability during application outage.
