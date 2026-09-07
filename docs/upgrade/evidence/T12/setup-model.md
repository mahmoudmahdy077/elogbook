# T12 Evidence — Setup-progress model (bounded substep)

Ticket: T12 (dependencies: T10–T11). The browser-driven flow, adoption
workflow, and manager APIs need T10-full (review-gated) + VPS.
Status: MODEL-ONLY (6/6 suite); full flow BLOCKED, stated plainly.

## Delivered (`apps/ops/src/setup-progress.ts`)

- The 9 section-5.3 steps as data with reversibility + prerequisites.
- `setupProgress(states)` → overall/current/failed/canRetry/bootstrapOpen.
  `bootstrapOpen` is false ONLY when every step is done (the property the
  manager and GUI must enforce: restart never reopens bootstrap).
- Unknown step ids throw (fail closed on schema drift).

## GUI contract for T12-full (to be built against this model)

- Render steps from `SETUP_STEPS` (never a hardcoded copy); poll the
  manager job (`jobs.ts` states) and map onto step states.
- Confirm irreversible steps (`provision`, `schema`, `operator`, `close`)
  explicitly; offer retry only when `canRetry`.
- Reconnect/resume via job id in the URL; cancellation only pre-mutation
  (see `jobs.ts` cancel rules). No delete-on-cancel, ever.
- Bootstrap credential UI dies with `bootstrapOpen === false`.

## Verification

- Suite 6/6, package 33/33, ops typecheck 0.

## Blocked

Manager HTTP/journal, adoption inventory+backup flow, duplicate-admin
prevention proof, credential-death proof, host-passing workflows — all
need T10-full + qualified VPS (T11).
