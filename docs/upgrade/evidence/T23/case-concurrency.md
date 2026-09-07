# T23 Evidence — Case-submit concurrency (substep 1 of N)

Ticket: T23 (dependency: T21). Full browser/viewport/accessibility
passes need browsers (BLOCKED this session); this substep fixes the
load-bearing concurrency defect with integration-grade mocks.
Status: IMPLEMENTED (this substep)

## Defect (reproduced in test)

`cases/[id]/submit` read the entry, checked `status === 'draft'`, then
wrote unconditionally: two concurrent submits both passed the check and
both created approval sets. Fixed with a conditional claim —
`.update({status:'pending'}).eq('id',id).eq('status','draft')` — where
zero matched rows returns 409 ("updated concurrently, reload and
retry") instead of minting approvals for a non-draft.

## Mock fidelity fix (same batch)

The shared supabase mock applied `update()` to ALL rows immediately and
ignored filter predicates, making conditional writes untestable (and
misleading every suite that used it). `update()` now defers to await
time and applies to filtered rows only, returning the matched set —
PostgREST semantics. Only two suites consume the mock; both green
(17/17 combined, incl. 2 new mock-level tests).

## Verification

- New 409 race test (forced lost race → 409 + concurrent wording).
- All 10 pre-existing submit tests unchanged and green (no behavior
  change on single-writer paths, incl. approval-rollback case).
- Typecheck 0, lint 0.

## Deferred (need browsers/devices)

Saved filters, empty states, status scanning, search feedback,
return-to-list, narrow-screen rendering, dashboard/report polish,
keyboard/zoom/motion/long-text/RTL matrix (G5), approvals batch scope,
concurrent-approval UX copy.
