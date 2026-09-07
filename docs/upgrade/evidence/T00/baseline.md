# T00 Evidence — Baseline reconciliation

Ticket: T00
Status: IMPLEMENTED (verification below)
Base commit: `22e1d636e64fa2c2c6eb8784d2d68c287ecf99b1`
Environment: Windows/PowerShell, Node v22.23.1, pnpm 9.15.0
Working tree at inspection: dirty (`apps/web/next-env.d.ts` modified, review/QA artifacts untracked). Preserved, not reverted.

## Command inventory (package.json scripts)

- `pnpm typecheck` → `pnpm -r typecheck`
- `pnpm lint:all` → web + mobile eslint
- `pnpm test` → `pnpm test:unit` → web + mobile vitest only (NOT shared, NOT sql, NOT edge)
- `pnpm test:db` → `supabase db test` (requires CLI + Docker; BLOCKED locally, no Docker on PATH)
- `pnpm test:e2e` → Playwright web e2e
- `pnpm build:web` → Next production build
- `pnpm security:scan` → expects image `elogbook-web:scan` (must verify artifact identity before claiming coverage)
- `pnpm release:verify` → check + build + scan

## Tree inventory (OBSERVED 2026-09-07)

- Supabase migrations: 166 `*.sql` files under `supabase/migrations/`
- Web API routes: 48 `route.ts` files under `apps/web/app/api/`
- GitHub workflows: 13 files (backup, cd, ci, codeql, container-scan, dast, deploy-mobile, deploy-preview, deploy-web, gates, sbom, security, semgrep)
- Canonical plan: `ELOGBOOK_MASTER_UPGRADE_PLAN.md` (untracked at inspection; tracked by this ticket)
- Product context: `PRODUCT.md` (untracked at inspection; tracked by this ticket)

## Prior-plan finding classification (source review, not re-measured)

| Old ID | Disposition | Reason |
|---|---|---|
| PRODUCTION_UPGRADE_PLAN D-0..D-4 (rate limiter) | STALE — superseded | Limiter rewritten (atomic EVAL, RATE_LIMIT_MODE, contract test 16/16); revalidate against current `lib/rate-limit-redis.ts` before citing |
| PRODUCTION_UPGRADE_PLAN D-5 (setup control plane) | CURRENT | Setup/update/backup routes still present in web artifact with production 404 guards; isolated `apps/ops` not yet built (T09) |
| PRODUCTION_UPGRADE_PLAN D-6 (health/ready) | CURRENT with gaps | `/api/health` liveness + `/api/ready` exist and proxy exempts; F08 gap remains (middleware public-route omission, compose traffic gating) |
| PRODUCTION_UPGRADE_PLAN D-7 (flaky test) | UNVERIFIED | Default `pnpm test` worker-timeout failure recorded in master plan §2; stable config not yet established (T01 substep) |
| PRODUCTION_UPGRADE_PLAN D-9/D-10 (compose) | CURRENT with gaps | `docker-compose.yml` fixed (no api-gw, no :3000 publish, Caddyfile present); F01 notes `setup.docker-compose.yml` still mounts socket + publishes 3000 |
| F01–F17 (master plan §2) | CURRENT as inspection anchors | Line refs are anchors; re-read implementation before editing |
| Old "compilation failure" claim | STALE | `pnpm typecheck` exit 0 on current tree (master plan §2 baseline) |
| Old test-count claims | STALE | Counts replaced by behavioral assertions per plan Rule 10 |

## Active-document readiness posture (no contradictory claims)

- `LAUNCH_SCOPE.md`: restricted de-identified pilot preserved. No change by this ticket.
- `PRODUCT.md`: product context only; explicitly states it does not authorize deployment.
- `README.md`: points to `ELOGBOOK_MASTER_UPGRADE_PLAN.md` as canonical roadmap (this ticket); historical docs retained.
- No clean-release artifact claimed. Docker-dependent evidence BLOCKED locally.

## Verification (this ticket)

- `git diff --check`: see command output (pre-existing whitespace in `apps/web/next-env.d.ts` only; file not edited)
- `node scripts/verify-boot.mjs`: exit 0 (source-string checks only; runtime boot NOT proven)
- `node scripts/verify-security-tests.mjs`: exit 0 (suite presence only)

## Limitations / next

- T01 must remove non-blocking DB behavior and make Edge/SQL/shared coverage explicit.
- F01–F17 require revalidation against current code at each ticket; anchors above are not proof.
- Docker/production-Supabase evidence BLOCKED (no Docker on PATH); record as BLOCKED, never pass.
