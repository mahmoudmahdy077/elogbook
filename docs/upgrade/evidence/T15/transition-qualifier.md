# T15 Evidence — Bundle-transition qualifier (bounded substep)

Ticket: T15 (dependencies: T11, T13–T14). Staged execution, rehearsal,
and post-update service verification need VPS + restored clone (BLOCKED).
Status: IMPLEMENTED (decision procedure below)

## Delivered (`apps/ops/src/bundle-transition.ts`)

`qualifyBundleTransition` reuses T11 primitives (pin validation, merge
conflicts) and decides: `proceed` | `blocked` (fixable: unpinned target,
merge conflicts, acknowledged-but-unrehearsed breaking steps) |
`unsupported-manual` (major Postgres upgrade, unacknowledged breaking
steps — guided procedure only, never auto-applied).

## Tests

- 5/5 suite (package 51/51), covering proceed, conflict block,
  major-upgrade classification, ack+rehearsal gating, and pin rejection.

## Verification

- ops 51/51, typecheck 0, gate H 0 (run with push).

## Deferred to T15-full

Staged config apply, rehearsal on restored clone, one supported
transition proof, data/key/Functions compatibility verification, and
the unsupported-classification of live-stack mutation.
