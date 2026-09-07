# T06 Evidence — Portable hardened application image

Ticket: T06 (dependencies: T02, T03)
Status: IMPLEMENTED (two-domain digest run + Trivy verdict via CI; no Docker on this host)
Base commit: `9d0c0b4` + working tree (this ticket)

## Defects fixed (one per change area, TDD where behavioral)

1. **CSP blocked self-hosted origins (F07, behavioral, TDD red→green).**
   `connect-src`/`img-src` hardcoded `*.supabase.co`; a custom Supabase
   URL failed closed in the browser. New `lib/csp.ts` derives the
   configured origin per request (proxy is server-side): https+wss (or
   http+ws for local hosts), strict http(s) parsing, garbage contributes
   nothing. `proxy.ts` delegates to it (behavior identical for cloud).
   Suite `lib/__tests__/csp.test.ts` 7/7 (was module-missing red).
2. **Dockerfile drift (static).** `apps/web/Dockerfile` installed with
   `--no-frozen-lockfile` and ran as root; root `Dockerfile.web` was
   unreferenced by Compose/CI and contained invalid `COPY ... 2>/dev/null`
   syntax. Consolidated: frozen installs, `nextjs:nodejs` (1001) runner
   with chown copies, `HOSTNAME`, wget `HEALTHCHECK` on liveness,
   `postgresql-client` in the RUNNER (backup-manager shells pg_dump;
   previously builder-only), `Dockerfile.web` deleted (only a historical
   doc referenced it).
3. **No compiled boot evidence.** New CI `docker-boot` job builds the
   authoritative image and asserts: `USER=nextjs`; production boot
   without `RATE_LIMIT_MODE` exits non-zero; boot with valid dummy env
   passes the live Gate-C probe (`/api/health` 200, `/api/ready` JSON,
   setup routes 404). Trivy verdict stays in `container-scan.yml`
   (builds the same Dockerfile).

## Runtime public-config contract (allowlist; enforcement deferred)

Server/secret config stays server-only. Public (browser-safe) keys that a
release may vary per domain without code changes:

| Key | Consumer | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser/server clients, CSP derivation | custom origin now works (this ticket) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon client | public by design |
| `NEXT_PUBLIC_SITE_URL` | redirects, CORS/CSRF origin sets | must match served origin |

Deferred to T11/T12: full runtime injection (same digest, new domain, no
rebuild) needs entrypoint-generated config + manager-owned release flow.
Until then, per-domain values are build args and the two-domain digest
proof belongs to the qualified-VPS evidence (T27). No placeholder URL,
secret, socket, or executor exists in the app artifact (compose mounts
only the data volume; verified by inspection + Gate C).

## Files changed

- `apps/web/lib/csp.ts`, `apps/web/lib/__tests__/csp.test.ts`, `apps/web/proxy.ts`
- `apps/web/Dockerfile`, `Dockerfile.web` (deleted)
- `.github/workflows/ci.yml` (`docker-boot` job)

## Verification

- csp suite 7/7 green (red first: missing module); web typecheck 0,
  lint 0, Gate C 0, Gate H (export compat for the proxy refactor) 0.
- Docker build/boot/probe evidence: CI `docker-boot` on push (BLOCKED
  locally — no Docker); `container-scan` already builds this Dockerfile
  per push.
