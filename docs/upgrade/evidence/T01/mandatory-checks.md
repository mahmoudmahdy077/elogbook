# T01 Evidence — Mandatory CI security checks

Ticket: T01 (substeps: inventory → shared jobs → DB/Edge jobs → enforcement)
Status: IMPLEMENTED (CI run pending on push)
Base commit: `734dfec` + working tree (this ticket)

## Substep 1 — Inventory (OBSERVED)

- SQL suites maintained (non-legacy): 9 files under `supabase/tests/`
  (`p1_1b`, `p1_3`, `p2_01`–`p2_08`). Legacy dir holds 6 superseded files
  (excluded from required jobs; retained as evidence).
- Shared package: 7 `*.test.*` files, previously no `test` script, excluded
  from root `test:unit` (web+mobile only).
- Edge: `payment-webhook/index.test.ts` (isolated unit) +
  `lifecycle.test.ts` (needs live Supabase at localhost:54321).
- Stale allow-failure paths removed: `db-tests.continue-on-error`,
  `deno-test.if:false`. One `continue-on-error` remains, reviewed and kept:
  `semgrep.yml:48` on the *community-rules* step, explicitly labeled
  advisory-only; the curated `.semgrep.yml` step next to it runs without
  allow-failure and uploads SARIF for both (findings visible in Security
  tab, fixed incrementally). No test/assertion job swallows failures.

## Substep 2 — Shared jobs (VERIFIED locally)

- `packages/shared/package.json`: added `"test": "vitest run"` + devDep
  `vitest ^4.1.9` (same pinned major as workspace; lockfile updated via
  `pnpm install --lockfile-only`, exit 0).
- `pnpm --filter @elogbook/shared test` → 7 files / 113 passed, exit 0
  (Node v22.23.1, Windows, 2026-09-07).
- `pnpm --filter @elogbook/shared typecheck` → exit 0.
- Root `test:unit` now runs shared → web → mobile in that order.

## Substep 3 — DB jobs (IMPLEMENTED, CI-verified on push)

- `db-tests` is now blocking (no `continue-on-error`). Startup retries kept
  bounded (3 attempts, 30s) — retries cover image-pull flakes only; failed
  security assertions fail the job.
- SQL list expanded 2 → 9 maintained suites (command in `ci.yml:73-77`).
- Missing-prerequisite behavior: `supabase start` failing 3× exits 1
  (explicit failed job, not silent pass).
- Local DB evidence BLOCKED (no Docker on PATH); fresh-install migration
  replay relies on CI runner Docker. Temp-migration NULL guards (commit
  `0f77a25`) address the last observed `supabase start` failure mode.

## Substep 4 — Edge jobs (VERIFIED locally, CI-required)

- Root cause of prior `deno-test` failure: test file uses `Deno.env`
  (recovery-path tests) but CI flags omitted `--allow-env`, producing an
  uncaught permission error. Reproduced the principle locally: without
  `--allow-env` the suite errors; with it, 7/7 pass.
- `deno test --no-lock --no-check --allow-import --allow-net=localhost
  --allow-env supabase/functions/payment-webhook/index.test.ts` →
  7 passed / 0 failed, exit 0 (deno 2.9.5, Windows, 2026-09-07).
- `lifecycle.test.ts` intentionally NOT in CI: requires live Supabase
  functions endpoint; documented in step name. Runs after `supabase start`
  locally.
- `if: false` removed; job is required again.

## Substep 5 — Enforcement (owner manual step)

- Branch protection cannot be set from code. Owner must require these
  statuses on `main` in GitHub settings: typecheck, lint, test, build-web,
  db-tests, deno-test, Gates. Until set, the mechanism (blocking jobs)
  exists but is not enforced — recorded here, not claimed.
- Negative control: reverting any guard (e.g., re-adding
  `continue-on-error`) must be rejected in review; `gates.yml` Gate D
  additionally fails when a named security suite is absent.

## Files changed

- `packages/shared/package.json`, `pnpm-lock.yaml`
- `package.json` (`test:unit`)
- `.github/workflows/ci.yml`

## Unverified / next

- Full 9-suite DB run has never been observed green (BLOCKED locally).
  First CI run on this commit is the evidence; fix failures per-suite
  rather than narrowing the list.
- T02 owns compiled-image probes and fake-auth removal.
