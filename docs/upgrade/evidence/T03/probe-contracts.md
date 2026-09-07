# T03 Evidence — Liveness/readiness/Caddy/proxy contracts

Ticket: T03 (dependency: T02)
Status: IMPLEMENTED (TLS/HTTPS validation BLOCKED: no Caddy binary, Docker, or test domain on this host)
Base commit: `95691b3` + working tree (this ticket)

## Defects reproduced and fixed (TDD, behavioral)

1. **F08 anonymous readiness redirect (P1).** Live `GET /api/ready` returned
   200 + login HTML: `middleware.ts` exempted `/api/health` but not
   `/api/ready`. Prerequisite one-liner landed in T02 (this ticket's probe
   caught it); recorded here as the T03 dependency fix. Verified by
   before/after HTTP bodies.
2. **Unbounded readiness DB ping.** A hung database would hang the probe
   instead of yielding 503. Regression test (never-resolving ping) failed
   via the 10s vitest timeout before the fix; passes after.
3. **Readiness leaked internals.** 503 bodies echoed raw DB messages
   (usernames, host IPs). Regression test failed with the exact leak
   (`dbError: password authentication failed for user "postgres"...`);
   bodies now carry `dbError: 'unavailable'`, details go to server logs.
4. **Caddy admin/healthcheck contradiction (F17).** `{ admin off }` while
   compose polls `localhost:2019/config/` — permanently-unhealthy caddy by
   construction, resting on an unverified "reachable even when off" claim.
   Changed to `admin localhost:2019` (loopback-only; 80/443 alone are
   published, so off-container exposure is unchanged) with a comment
   stating the agreement. `caddy validate` BLOCKED (no binary/Docker here);
   qualified-VPS evidence belongs to T06/T11.

## Changes

- `apps/web/app/api/ready/route.ts`: `READINESS_DB_TIMEOUT_MS`-bounded ping
  (default 5000ms, env-overridable for tests); sanitized `dbError`;
  server-side warn with detail; limiter-exception detail also server-side.
- `apps/web/app/api/ready/__tests__/route.test.ts`: +3 tests (timeout
  503 <4s, no-leak, recovery no-latch). Suite 13/13 with health suite.
- `config/Caddyfile`: loopback admin + agreement comment.

## Live verification (dev server, cloud project)

- `/api/health` → 200 `{"status":"healthy","timestamp"}` (no db/rateLimit).
- `/api/ready` → 200 `{"status":"ready","db":"ok","rateLimit":{...}}`.
- `verify-boot.mjs --probe-base-url=` → exit 0 (6/6 incl. secret scan).

## Unchanged (cited, not re-implemented)

- Proxy exempts both probes before the limiter; `:3000` unpublished;
  credential/availability failure split; `TRUSTED_PROXY_HOPS` derivation.

## Unverified / next

- Real HTTP→HTTPS + ACME renewal on a test domain; `caddy validate`;
  timeout-bound dependency health under orchestrator (needs VPS).
- T04 owns AAL2/status enforcement; T06 owns image/probe wiring.
