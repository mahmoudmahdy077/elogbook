# eLogbook Production Upgrade Plan — v2.2

**Revision:** v2.2 (2026-09-02) — supersedes v1 after three rounds of adversarial review by ChatGPT
**Target:** Production-ready PHI-handling medical residency logbook
**Status of this document:** Design decision record + gated pre-production program. **Not** evidence of production readiness. Accepted design; **implementation pending.**
**Evidence stamp for every `VERIFIED` claim below:** commit `e027c27`, **dirty working tree** (D-0 present), Node v22.23.1, pnpm 9.15.0, 2026-09-02.

---

## Status legend — every claim in this document carries one

| Marker | Meaning |
|---|---|
| `VERIFIED` | Executed on a machine meeting the repo's engine constraints; command, exit status, tree identifier and toolchain versions recorded |
| `IMPLEMENTED` | Code changed in the working tree, **not** yet verified |
| `ACCEPTED` | Design decision agreed, **no code written** |
| `OPEN` | Unsourced question requiring a named owner and a retrieval date |

v1's central drafting flaw was omitting this legend: it used "Adopted" for decisions with no code behind them, which a reviewer reasonably read as completion. Every section below is marked.

**A `VERIFIED` claim is not a verified release.** Everything marked `VERIFIED` here was executed against a *dirty* tree that does not compile. It establishes that a defect exists; it establishes nothing about a shippable artifact. Release verification requires a clean tree, a tagged commit, and the full Gate C matrix. The two must never be conflated, and the stamp above exists so a reviewer can tell them apart without asking.

## Revision history

**v1 → v2 changes, and why:**

1. Added the status legend above. `ACCEPTED ≠ IMPLEMENTED ≠ VERIFIED.`
2. **Resolved the rate-limit contract contradiction.** v1 contained three incompatible statements of the same contract (Task 0.1, Gate B, TICKET-001). One contract now, stated once, in the acceptance test. See Rule 10.
3. Restructured the schedule into Phases 0-6, separating pilot-readiness blockers from market-expansion strategy. v1 put competitor research on the same serial path as security remediation.
4. Replaced all snapshot-count acceptance criteria (`expect "Test Files 32 passed"`) with behavioral assertions. v1's counts created pressure to delete tests to hit a number.
5. Relabelled Gate A from "the load-bearing part" to a detector with documented false-negative classes.
6. Marked every ACGME/SCFHS/WebADS/competitor claim `OPEN`. One web search is not research.
7. Downgraded setup routes from "mitigated" to "unauthenticated privileged endpoints; remove from the PHI build."
8. Deleted the parenthetical calling the flaky cross-tenant test "non-blocking on re-run." A flaky security test is blocking, because the customary reaction to flake — retry loops, `continue-on-error` — manufactures a false green.
9. Changed the pilot data rule from de-identified "preferred" to **required**.
10. Recorded three defects in the rate-limit control that v1 did not contain, two of which make the control non-functional independently of v1's P0.
11. Renamed §II from "Critical path to production (30 days)" — that heading invited a reading of PHI-in-30-days that the body never claimed.

**v2 → v2.1, after ChatGPT's adjudication of `CHATGPT_REVIEW_RESPONSE.md`:**

12. Added **D-0** at the top of the register — the working tree does not compile, because of my own interrupted repair. Ranked above the defect it was repairing.
13. Added **Rule 11** (atomic completeness) and its ordering requirement: contract test first, new implementation alongside the old, switch the exports, delete the old. Every intermediate state compiles.
14. Added **D-4** — rate-limit keys are client-controlled across 14 files with no trusted-proxy configuration anywhere. Withdrew v2's claim that `localBudget()` "bounds brute force at 5 × instances": with an attacker-chosen key, the bound is vacuous, not merely weak.
15. Added `WAIVER: mechanical-sweep` to Rule 2, plus **Gate G**, because D-4's fix touches 14 files and cannot satisfy the ≤3-file budget. Deliberately unusable for anything requiring judgment.
16. Extended **D-6**: `/api/ready` does not exist, `/api/health` performs a DB round-trip, and `proxy.ts` rate-limits `/api/health` itself. Under v1's regressed fail-closed config that combination is a crash loop, not an outage.
17. Added §V (ticket backlog, all `ACCEPTED`), §VI (open questions, all `OPEN`, with the grep-verified absence-of-artifact facts separated from the unsourced market claims), and §VII (falsifiability conditions).
18. TICKET-001 rewritten to a single contract table and a per-change red/green requirement. v1's version is withdrawn — it contradicted its own acceptance test.

**v2.1 → v2.2, after ChatGPT's third-round adjudication:**

19. **Three new verified defects, found while checking the adjudication's "readiness needs an actual consumer" point.** The production `docker-compose.yml` cannot start (**D-9**: `depends_on` names an undefined service; the Caddyfile it bind-mounts does not exist), the app publishes port 3000 directly to the host so the reverse proxy is bypassable (**D-10**), and nothing in the application validates configuration at boot (**D-11**). D-10 falsifies the trusted-proxy premise D-4's fix depends on; D-11 falsifies v2.1's own claim that `RATE_LIMIT_MODE` is validated "at startup."
20. **Withdrew the phrase "startup validation" from TICKET-001's contract table.** `resolveMode()` is lazy and `packages/env` validates per-call inside factory functions, so the first failure surfaces on the first *request*, in middleware, as a 500 — not at boot. TICKET-001 now requires an `instrumentation.ts` `register()` hook to make the claim true.
21. Added the mechanical enforcement Rule 11 was missing: a CI **export-compatibility check** that fails when a symbol imported anywhere in the repo disappears from its module. A rule enforced only in prose is a rule a small model can skip.
22. **Governed `WAIVER: mechanical-sweep`** with four requirements (machine-generated file list, diff-normalization proof, changed-line ceiling, named human approver) after conceding it was gameable as written. A "mechanical" label never waives security review or integration tests.
23. **Gate G downgraded to necessary-but-not-sufficient.** Centralizing the header read does not make the value trustworthy; TICKET-002 now carries the trust-boundary specification and a five-case test matrix (direct access, spoofed header, multiple hops, absent header, IPv6).
24. TICKET-003 expanded to five co-required elements, including the deployment configuration that consumes readiness. A `rateLimiterHealth()` with no endpoint and no orchestrator wiring is observability code, not readiness behavior.
25. TICKET-004 now requires *proof of absence* from the PHI artifact — build-manifest inspection plus runtime route probing plus a network rule — not inaccessibility by convention.
26. Rule 8's two-attempt escalation explicitly relabelled a **heuristic, not a safety guarantee**, pending measurement.
27. Added the evidence stamp above and the "`VERIFIED` is not a verified release" paragraph. Every prior `VERIFIED` in this document was measured on a tree that does not compile.
28. Adopted the adjudication's eight-step required implementation order as §III's execution sequence, with one insertion: **step 4 fixes the compose stack** (D-9/D-10) before steps 5-7, because D-10 makes the trusted-proxy premise false and D-9 makes deployment evidence unobtainable.
29. **TICKET-001's contract table gained a seventh row** answering what happens when `RATE_LIMIT_MODE=single-instance` is set *with* Upstash credentials present: credentials are ignored, one warning is logged, and the mode is the authority. Inferring mode from credentials is exactly the implicit-policy-selection defect the enum exists to remove.
30. **TICKET-001 answers seven precise questions the adjudication asked,** now written as contract rather than prose: the exact `EVAL` wire shape (both request and response); degradation ordering (set *before* returning the denied request); `retryAfter` when TTL is -1 or -2 (both → 60, and -1 logs); clearing degradation (immediately on next success, no threshold); local fallback keying and bound (same key as Redis, per-process Map, credential keys capped at 5, **documented as no bound** against a distributed attacker); `single-instance` with credentials (row 7); and the mechanism that makes boot validation real (`instrumentation.ts`, verified by observing a non-zero exit).
31. TICKET-001 now requires **per-change red/green proof, not per-ticket.** Six changes passing together after all six land does not show any one test detects its own defect. Revert change 2 alone → D-2's row must go red. Revert change 6 alone → Gate C's exit-code assertion must go red.
32. **TICKET-008 added** — fix the compose stack. Closes D-9 (define or remove `api-gw`, write the Caddyfile) and D-11's deployment half (boot validation is TICKET-001's). Marked **human-only** (deployment topology decision).
33. TICKET-002 now **blocked on TICKET-008** and explicitly closes D-10 alongside D-4, because the trusted-proxy specification is meaningless while :3000 is published to the host.
34. TICKET-003 now requires **repointing the compose healthcheck** from `/api/health` to wherever the pilot's orchestrator consumes liveness.
35. §VII added four falsifiability conditions for D-9/D-10/D-11 and the required-implementation-order claim: `docker compose config` exit code; :3000 reachability; a production boot with `RATE_LIMIT_MODE` unset; and whether TICKET-002 can close soundly with the port still published.

---

## Executive Summary

**Verdict:** eLogbook must not hold live PHI yet. It is a credible candidate for a de-identified controlled pilot once Phase 0-2 evidence exists.

**What is genuinely good.** RLS with `FORCE ROW LEVEL SECURITY` on every policy-bearing table, offline-first mobile with per-field PHI encryption, multi-framework milestone/EPA scaffolding, de-identification constraints enforced in the schema (`deidentified_no_phi`), audit-log PHI redaction, SSO/SCIM/webhooks, white-label, and a real multi-tenant model. The foundations are not the problem.

**What blocks a PHI launch.** The rate-limiting control is non-functional in four independent ways (§II, D-1 to D-4), the installer/setup control plane is unauthenticated and present in the production build (D-5), **the production compose stack cannot start at all** (D-9), the reverse proxy it depends on is bypassable (D-10), nothing validates configuration before the process accepts traffic (D-11), and there is no reproducible deployment evidence — no clean-database migration run, no backup-restore drill, no readiness endpoint, no external assessment, no executed BAA/DPA.

**The working tree is currently broken.** `VERIFIED`: `pnpm typecheck` fails with 53 errors across 25 files, because a partial rewrite of `lib/rate-limit-redis.ts` removed `checkRateLimit` and `rateLimitResponse` while 27 files still import from it. Nothing may be committed or tagged until this is resolved. Recorded as D-0.

**Strategy.** Web-only, de-identified, 1-3 programs, after Phase 0-2. Hold mobile offline sync and all installer routes out of the first release. External security assessment and executed BAA/DPA before any PHI. Market-expansion research runs in parallel and gates nothing.

**What this document is for.** The implementation work is intended to be executed by smaller models. §IV is the protocol that makes their mistakes mechanically unmergeable. §I of the companion response document is direct evidence that the protocol's own author does not reliably follow it, which is the argument for enforcing it in CI rather than in prose.

---

## I. VERIFIED CURRENT STATE

### A. Security fixes applied in the working tree

`VERIFIED` by reading the working tree on 2026-09-02. All uncommitted.

| # | Fix | Location | Status |
|---|---|---|---|
| 1 | Cross-tenant authz — PUT/DELETE constrain target by `tenant_id` + explicit 403 | `api/[tenant]/admin/users/[id]/route.ts:80-89,145-153` | `VERIFIED` |
| 2 | Cross-tenant authz — action route target lookup + all three branches | `api/[tenant]/admin/users/[id]/action/route.ts:24-70` | `VERIFIED` |
| 3 | Reset-password uses a real `recovery` link, not `magiclink` with `email: ''` + `crypto.randomBytes` | same file | `VERIFIED` |
| 4 | Shadow login route deleted (108 lines, no rate limit, hand-rolled cookie, bypassed MFA) | `api/auth/login/route.ts` — gone | `VERIFIED` |
| 5 | CI gates — `continue-on-error` removed, `set -euo pipefail`, `pipefail` before `\| tail`, Node 22 everywhere | `.github/workflows/ci.yml:15,25,35,45,63-82` | `VERIFIED` |
| 6 | Setup response no longer returns `serviceRoleKey` / `jwtSecret` / `postgresPassword`; config file `mode: 0o600` | `api/setup/deploy-supabase/route.ts:63-74` | `VERIFIED` |
| 7 | Installer hardening — `role='admin'` only, 5/min limit, AAL2 gate, audit log, input allowlists | `api/uninstall/route.ts`, `api/update/execute/route.ts` | `VERIFIED` |
| 8 | "HIPAA-compliant" claim removed from landing page | `app/page.tsx:43` | `VERIFIED` |
| 9 | Cross-tenant regression test added | `api/[tenant]/admin/users/__tests__/cross-tenant.test.ts` | `VERIFIED` (untracked) |

Fix 6 removed secrets from the *response*. It did not authenticate the *endpoint*. See D-5.

### B. Baseline toolchain measurements

`VERIFIED` 2026-09-02 on Node v22.23.1 / pnpm 9.15.0, which satisfy `engines: { node: "22.x", pnpm: ">=9.0.0 <10" }` and `packageManager: pnpm@9.15.0`.

| Command | Result |
|---|---|
| `pnpm typecheck` | **FAILS — 53 errors / 25 files, all TS2305** (D-0, current tree) |
| `pnpm lint:all` | exit 0, 8 warnings (measured before D-0 was introduced) |
| `pnpm test` (web) | 31 files / 302 passed / 1 skipped, exit 0 (measured before D-0) |
| `pnpm build:web` | exit 0, 47 routes (measured before D-0) |

**These four numbers are a snapshot, not a contract, and they are weak evidence.** The v1 rate-limiter change satisfied all four and would have denied every production API request. They are recorded to date the baseline, not to license a claim of readiness. No acceptance criterion anywhere in this document may reference a test *count*.

---

## II. DEFECT REGISTER

Severity is assigned on production impact with PHI present. Each entry names the evidence so a reviewer can falsify it.

### D-0 — Working tree does not compile · P0 · `VERIFIED`

A partial rewrite of `lib/rate-limit-redis.ts` (begun while drafting v1's TICKET-001, interrupted mid-edit) removed `checkRateLimit` and `rateLimitResponse`. 27 files still import from the module, including `proxy.ts:3`.

```
pnpm typecheck → FAILS (ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL)
53 × error TS2305: Module '"@/lib/rate-limit-redis"' has no exported member 'checkRateLimit' | 'rateLimitResponse'
```

The file now contains `resolveMode`, `rateLimiterHealth`, `redisCommand`, and a `WINDOW_SCRIPT` constant that is **never called**, plus `redisDegradedSince` which is read and reset but **never assigned**. The atomic limiter and readiness signal described in the v1 response are design fragments, not behavior. Nothing may be committed or tagged in this state.

*Process lesson, recorded deliberately:* this defect was introduced by the reviewing model, mid-edit, in the middle of authoring the document about preventing exactly this. It is the strongest available argument for Rule 11 (atomic completeness).

### D-1 — `REQUIRE_REDIS_IN_PROD` escape hatch was inert · P0 · superseded by D-0

v1 shipped `const REQUIRE_REDIS_IN_PROD = process.env.REQUIRE_REDIS_IN_PROD === 'true' || isProd`, which is unconditionally `true` in production. Because the fail-closed predicate matched the `api:` prefix, and `proxy.ts:39-42` applies `api:${ip}` to every `/api/*` request except `/api/auth`, a production deploy without Upstash would have returned 429 to **every API request including `/api/health`**. The documented `REQUIRE_REDIS_IN_PROD=false` opt-out could not disable it. `REQUIRE_REDIS_IN_PROD` was never added to `packages/env` or `.env.example`.

This is the defect that motivated the whole exercise: it typechecked, linted, passed 302 tests, and built.

### D-2 — The Redis limiter has never denied a request · P0 · `VERIFIED`

```ts
async function redisCommand(command: string, ...args: string[]): Promise<string | null> {
  const res = await fetch(`${UPSTASH_URL}/${command}/${args.join('/')}`, { ... });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return res.json();          // returns the Upstash envelope, not the value
}
```

Upstash REST replies `{"result": "<value>"}`. The envelope is never unwrapped, so:

- `parseInt({result:'…'}, 10)` → `parseInt('[object Object]')` → `NaN`
- `!currentWindow` with `currentWindow === NaN` → **true** → a fresh window starts on every request
- `NaN >= maxRequests` → **false** → the threshold is never reached

In `distributed` mode — the configuration this entire plan treats as the secure one — the limiter allows every request. `grep -rln "rate-limit-redis" --include=*.test.ts` returns 4 files; all 4 **mock** the module. Zero tests execute the Redis path. That is how a security control stays dead for its whole lifetime with every gate green.

Both reviewers analyzed the control flow and missed the wire format. Consequence for the protocol: any external-service integration requires a test that mocks the vendor's *documented response shape* and asserts on the parsed value.

### D-3 — Non-atomic window, plus four round-trips on the hot path · P1 · `VERIFIED` by inspection

`GET` window → `SET` → `SET` → `EXPIRE` → `GET` count → `INCR` is not atomic. Concurrent requests can each observe a missing window and each reset the counter; two requests at `max-1` can both pass before either increments. Separately, up to four sequential HTTPS round-trips to Upstash execute on a path applied to every `/api/*` request — a latency defect independent of correctness. A single Lua `EVAL` (`INCR`, `EXPIRE` only when the result is 1, return `{count, ttl}`) fixes correctness, atomicity, and round-trip count together.

### D-4 — Rate-limit keys are client-controlled · P1 · `VERIFIED`

```ts
const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || ...
```

The **first** `X-Forwarded-For` value is the client-supplied one. Taking it as identity is safe only when a trusted proxy overwrites the entire header; nothing in the repo establishes or documents that. Any client sending a rotating `X-Forwarded-For` gets an unlimited number of buckets, defeating the limiter in **both** modes regardless of D-1/D-2/D-3.

Confirmed present in **14 files** (`proxy.ts:24` plus 13 route handlers), copy-pasted, with no shared helper and no trusted-proxy configuration anywhere in the codebase.

Two consequences worth stating explicitly:

1. **It invalidates a claim made in v1.** v1 argued the local per-process budget "bounds brute force at 5 × instances." With spoofable keys that bound is not weak, it is **vacuous** — an attacker rotates the header and gets unlimited attempts. The local fallback is a reduced-security mode, not a bounded guarantee, and must be documented as such.
2. **It breaks a rule in this document.** Fixing 14 files exceeds Rule 2's ≤3-file budget. Either the budget forces a bad split or it gets waived on the first real ticket. See Rule 2's revised waiver clause.
3. **The fix's premise is currently false.** A trusted-proxy correction assumes traffic arrives through the proxy. `docker-compose.yml:16-17` publishes the app's port 3000 to the host, so it does not have to. See D-10 — TICKET-002 cannot be closed by application code alone.

### D-5 — Unauthenticated privileged control plane in the production build · P0 · `VERIFIED`

`/api/setup/deploy-supabase` is authorized by exactly this:

```ts
function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}
```

No authentication, no CSRF or origin check, no rate limit, no network restriction. It clones Supabase, writes `.env`, pulls 11 images, runs `docker compose up -d`, and writes `supabase-config.json` containing the service-role key, JWT secret, and Postgres password. Sibling routes with the same or adjacent exposure: `/api/setup/create-admin`, `/api/setup/migrate`, `/api/backup`, `/api/backup/restore`, `/api/uninstall`, `/api/update/execute` — the last four read `config.postgresPassword` and connect as `postgres`.

v1 called this "mitigated but not isolated." That was too reassuring. Correct status: **an unauthenticated remote-code-execution and secret-exfiltration surface that must be removed from the PHI build or bound to a private bootstrap network with a one-time expiring enrollment token.**

Required tests before this is considered closed: unauthenticated request rejected, cross-origin request rejected, repeated invocation rejected, post-`.setup-complete` invocation rejected, and — for the PHI build — the route absent from the build manifest entirely.

### D-6 — Liveness and readiness are conflated · P1 · `VERIFIED`

`/api/ready` does not exist. `/api/health` performs a database round-trip and returns **503** when the query errors — readiness semantics on a liveness path. Under an orchestrator, a transient DB blip restarts otherwise-healthy pods instead of removing them from rotation. And because `proxy.ts:39` matches all of `/api/*` except `/api/auth`, `/api/health` is itself rate-limited: any limiter defect takes the health signal down with the app, which is precisely how D-1 escalated from "auth is strict" to "total outage."

Required: `/api/health` = process liveness only, no dependencies, never rate-limited. `/api/ready` = database, migration state, Redis (when `distributed`), consuming `rateLimiterHealth()`, with a defined status code for degraded and a documented orchestrator behavior for each state.

**The consumer exists and is already pointed at the wrong endpoint.** `docker-compose.yml:35-40` configures `healthcheck: wget -qO- http://localhost:3000/api/health`, `interval: 30s`, `retries: 3` — and `docker-compose.yml:29-31` gates the app's own start on `depends_on: condition: service_healthy`. So the DB round-trip and the rate limit are both on the path a container-health probe polls every 30 seconds. Compose alone marks the container unhealthy rather than restarting it, but under Swarm, Kubernetes, or any `autoheal` sidecar that status is a restart trigger, and `restart: unless-stopped` is already set. The adjudication's point that readiness needs a real consumer is correct; the sharper version is that this repo has a consumer wired to the liveness path and no readiness path to move it to.

### D-7 — Flaky security test · P1 · `VERIFIED` (reproduced)

The cross-tenant regression suite intermittently fails with `Failed to start forks worker` and **exit 1**. Proven non-deterministic by running the identical command twice with different outcomes (7 passed / 3 errors / exit 1, then 10 passed / 59 tests / exit 0).

The failure is loud, not silent — so it does not currently produce a false green. It is nonetheless blocking, because the customary human response to flake is a retry loop or restoring `continue-on-error`, and either one converts a flaky-red security test into the false green that the original review correctly warned about. v1's parenthetical calling this "non-blocking on re-run" is withdrawn.

### D-8 — Dead config state in the setup wizard · P3 · `VERIFIED`

```ts
const [, setSupabaseConfig] = useState<SupabaseConfig | null>(null);   // setup/page.tsx:49
setSupabaseConfig(data.config);                                        // setup/page.tsx:99
```

The route no longer returns `config`, so this writes `undefined`. The getter is discarded, so nothing reads it. **Dead code, not a functional break** — the wizard works. The `SupabaseConfig` interface (which declares `postgresPassword: string`) and both lines should be deleted. Recorded at P3 deliberately: severity calibration is what makes the rest of this register worth reading.

### D-9 — The production compose stack cannot start · P0 · `VERIFIED`

Two independent hard failures in the only deployment artifact the repository ships.

```yaml
# docker-compose.yml:29-31
    depends_on:
      api-gw:
        condition: service_healthy
```

`api-gw` is **never defined as a service.** `grep -rn "api-gw" --include=*.yml .` returns exactly one hit — that `depends_on` key. Compose rejects a dependency on an undefined service at config-validation time, before pulling anything. `docker compose up` fails immediately.

```yaml
# docker-compose.yml:49-50
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile:ro
```

`config/` contains one file: `mcporter.json`. **There is no Caddyfile anywhere in the repository** (`find . -iname "*caddyfile*"` → no matches). Docker creates a *directory* at a missing bind-mount source, so Caddy would receive a directory where its config file should be. The TLS terminator and reverse proxy are unconfigured.

Consequence: **the documented production deployment has never been executed.** This is the missing evidence Phase 2 exists to produce, and it explains why: there was nothing to produce it from. It also means every deployment-shaped assumption elsewhere in this document — proxy behavior, TLS termination, network isolation, health probing — is unverified by construction.

### D-10 — The reverse proxy is bypassable · P1 · `VERIFIED`

```yaml
# docker-compose.yml:16-17
    ports:
      - "3000:3000"
```

The app container publishes 3000 on the host while Caddy holds 80/443. Any client that can reach the host can address the application directly, which means:

- **D-4's fix cannot work in this topology.** Trusting `X-Forwarded-For` requires that every request pass through a proxy that overwrites it. Here requests need not pass through the proxy at all, so no application-side parsing rule makes the value trustworthy. TICKET-002 is therefore *not* purely a code change — it requires removing this publish, or binding it to `127.0.0.1`.
- **TLS is optional in practice.** Caddy terminates TLS on 443; port 3000 is plain HTTP. With PHI present that is a reportable exposure, not a hardening nit.
- **D-5 is reachable on 3000** regardless of what the proxy is configured to route.

### D-11 — Nothing validates configuration at boot · P1 · `VERIFIED`

v2.1's TICKET-001 claimed `RATE_LIMIT_MODE` would be validated "at startup." That claim was false, and the reason generalizes past the rate limiter.

- `resolveMode()` is lazy and memoised — it runs on the first limiter call.
- `packages/env/src/index.ts` exports only *functions*: `parseWebPublicEnv`, `parseWebServerEnv`, `parseWebFullEnv`, and `env = () => parseOrThrow(...)`. Nothing is parsed at module scope.
- Its only callers are **inside factory functions** — `lib/supabase/server.ts:6` and `lib/supabase/admin.ts:5` — so validation runs when a client is first constructed, i.e. during a request.
- There is no `apps/web/instrumentation.ts`. Next.js's one boot hook is unused.

So a misconfigured production deployment **starts successfully**, passes any probe that does not touch the failing path, and then fails per request. Worse for the limiter specifically: `proxy.ts` runs before every route handler, so a `resolveMode()` throw surfaces as a middleware exception — a 500 on every request, from a container the orchestrator believes is healthy. A rolling deploy would replace every instance with a broken one and report success.

Required: `instrumentation.ts` with a `register()` that calls `parseWebFullEnv(process.env)` and `resolveMode()`, so misconfiguration fails the process before it accepts traffic. This is a precondition for TICKET-001's contract table being honest, not an enhancement.

### Register summary

| ID | Defect | Severity | Blocks pilot? | Blocks PHI? |
|---|---|---|---|---|
| D-0 | Tree does not compile | P0 | **Yes** | Yes |
| D-1 | Inert fail-closed escape hatch | P0 | **Yes** | Yes |
| D-2 | Redis limiter never denies | P0 | **Yes** | Yes |
| D-3 | Non-atomic window + 4 RTT | P1 | No | Yes |
| D-4 | Spoofable rate-limit keys | P1 | No | Yes |
| D-5 | Unauthenticated control plane | P0 | **Yes** | Yes |
| D-6 | Liveness/readiness conflated | P1 | **Yes** | Yes |
| D-7 | Flaky security test | P1 | **Yes** | Yes |
| D-8 | Dead setup state | P3 | No | No |
| D-9 | Compose stack cannot start | P0 | **Yes** | Yes |
| D-10 | Reverse proxy bypassable (:3000 published) | P1 | **Yes** | Yes |
| D-11 | No boot-time config validation | P1 | No | Yes |

D-1 through D-4 are four independent defects in a single control. Any one of them defeats it. That is the strongest argument in this document for the position that the codebase's problem is not missing features — it is that no one had executed the security controls under test.

D-9 through D-11 make the same argument about the deployment: the stack has never run, so nothing downstream of "it starts" has ever been observed. D-9 is ranked P0 and blocks the pilot because Phase 2's exit evidence is unobtainable without it, and because D-4's and D-6's fixes both depend on topology facts that cannot be established until the topology exists.

---

## III. PHASED PROGRAM

Structure adopted from ChatGPT's review. v1 put security remediation, clean-DB migration, backup-restore, legal contracting, competitor research, and SCFHS discovery on one serial 30-day path. They are different tracks with different owners and different gating power. **No duration below is a commitment; each phase exits on evidence, not on a date.**

### Phase 0 — Fix the launch contract · `ACCEPTED`

Nothing else starts until `LAUNCH_SCOPE.md` exists and names:

- First jurisdiction and specialty(ies)
- Deployment topology — single-process self-hosted, or horizontally scaled
- **Whether PHI is permitted in the pilot** (default: no)
- Supported roles, and features explicitly excluded from release 1
- The rate-limit mode implied by the topology

Then, in code (Phase 1 work, contract decided here):

- One required enum `RATE_LIMIT_MODE=distributed|single-instance`, in `packages/env` Zod schema **and** `.env.example`. "Validated at startup" is only true if something calls the validator at startup — see D-11: nothing in this application currently does. It therefore also requires `apps/web/instrumentation.ts` with a `register()` hook.
- `/api/health` = liveness, no dependencies, exempt from rate limiting. `/api/ready` = dependencies, consuming `rateLimiterHealth()`, with a defined status code per state, **and a deployment configuration that actually consumes it** (`docker-compose.yml`'s healthcheck currently polls `/api/health`).

**Why one enum and not two booleans.** ChatGPT proposed `REDIS_REQUIRED=true|false` plus a separate `SINGLE_INSTANCE_MODE=true`. Two booleans encoding one decision admit a fourth state — `REDIS_REQUIRED=true` **and** `SINGLE_INSTANCE_MODE=true`, "Redis mandatory in a mode that does not use Redis" — which is the same under-specification class as D-1. The principle (never silently choose a security policy; fail validation when unset in production) is adopted in full; the encoding is a single required enum with no undefined states.

**Exit criteria:** `LAUNCH_SCOPE.md` merged; `RATE_LIMIT_MODE` in schema and example; production boot fails fast when unset — demonstrated by starting the container without it and observing a non-zero exit, not by reading the code.

### Required implementation order · `ACCEPTED`

Adopted from ChatGPT's third-round adjudication, with D-9/D-10/D-11 inserted where they gate the steps that follow. **Nothing may be reordered to make progress look faster.** Steps 1-3 are the only ones a small model may take unaccompanied.

| # | Step | Gated by |
|---|---|---|
| 1 | Restore the limiter exports + contract test so the repo compiles | — |
| 2 | `RATE_LIMIT_MODE` into schema and `.env.example`; `instrumentation.ts` calls the validator at boot | 1 |
| 3 | Atomic Redis counting, envelope validation, TTL handling, degradation state, local fallback | 1, 2 |
| 4 | **Fix the compose stack** (define or remove `api-gw`, add the Caddyfile, unpublish :3000) | — (independent; blocks 5-7) |
| 5 | Trusted client-IP derivation + all 14 call sites as one reviewed sweep | 4 — the trust boundary must exist before code can rely on it |
| 6 | Split liveness/readiness, exempt both before rate limiting, repoint the healthcheck | 4 |
| 7 | Remove or isolate setup/backup/restore/update/uninstall from the PHI artifact | 4 |
| 8 | Full matrix: typecheck, lint, unit + integration, production build, boot smoke, route probes, under Node 22 / pnpm 9 on a **clean tree at a tagged commit** | 1-7 |
| 9 | Only then: external security assessment, legal, controlled pilot | 8 |

Step 4 moved ahead of 5-7 on evidence, not preference: D-10 makes step 5's premise false and D-9 makes steps 6-8 unobservable. Attempting 5 before 4 produces code that looks correct and is not.

### Phase 1 — Close verified P0/P1 security defects · `ACCEPTED`

1. **D-0** — restore `checkRateLimit` / `rateLimitResponse`, call `WINDOW_SCRIPT`, assign `redisDegradedSince` on the documented failure path. One commit, tree green.
2. **D-1/D-2/D-3** — one contract, atomic Lua, unwrapped envelope, tested against the documented `{result: …}` shape.
3. **D-4** — one shared `getClientIp()` with an explicit trusted-proxy assumption; replace all 14 copies; document what breaks if the app is exposed without a trusted proxy.
4. **D-5** — remove installer/setup/backup/uninstall/update routes from the PHI build, or bind them to a private bootstrap network with a one-time expiring token. Tests for unauthenticated, cross-origin, repeated, and post-completion requests.
5. **D-6** — split liveness from readiness; exempt both from rate limiting.
6. **D-7** — fix the forks-worker flake at the root (pool config or worker startup timeout). Retries are forbidden as a remedy.
7. **Service-role inventory** — enumerate every `createServiceRoleClient` call site and classify each query tenant-scoped / institution-scoped / intentionally global. Integration test for every privileged mutation. This is the only thing that actually establishes tenant isolation, because RLS cannot: service-role bypasses it by design.
8. Verify session revocation after deletion and role change; AAL2 enforcement (note the existing `aal` check skips entirely when the claim is absent or MFA is unenrolled — same weak pattern at `lib/supabase/middleware.ts:206`); audit-log write failure must alert but never block; PHI redaction in logs, errors, Sentry, and AI prompt payloads.

**Exit criteria:** every P0/P1 in the register closed with a test that fails when the fix is reverted.

### Phase 2 — Reproducible deployment evidence · `ACCEPTED`

Artifacts, not assertions. All 163 migrations applied to a fresh disposable database; pgTAP green on that database; typecheck; lint; unit and integration suites; production build; boot smoke test; readiness check; backup taken and **restored to a new database with row counts and PHI integrity verified**. Executed against the exact pilot topology, including the real proxy in front and more than one instance if the topology is `distributed`.

**Exit criteria:** archived artifacts for each, dated, reproducible by a second person from the runbook alone.

### Phase 3 — Workflow acceptance · `ACCEPTED`

Role-based end-to-end scenarios, each asserting success, authorization failure, validation failure, timeout, retry, and audit trail: invite → login/MFA → consent → case create/submit → evaluation request/complete → duty-hour entry and violation → tenant switch → export → retention → deactivation. This is where v1's "workflow audit" belongs, and its output is executable tests, not a document.

### Phase 4 — Legal and operational readiness (parallel) · `ACCEPTED`

PHI data-flow inventory **first**, then counsel determines which vendors are business associates and verifies terms, subprocessors, retention, residency, and incident obligations. A BAA cannot make an insecure integration compliant. Plus: access review (who holds the service-role key, prod DB, Upstash token), key rotation and revocation drill, incident-response runbook, breach-notification decision tree, retention/deletion verification, support escalation. External assessment with fixed scope and a severity SLA.

*v1 said "BAA with Supabase (and Upstash, Sentry, any AI provider touching PHI)." The "touching PHI" qualifier already scoped it by data flow; the correction adopted here is the ordering — inventory before vendor determination — not the scope.*

### Phase 5 — Controlled pilot and go/no-go · `ACCEPTED`

1-3 programs, **de-identified data required** (v1 said "preferred"; that word is withdrawn) until Phase 4 completes. Monitor authentication failures, rate-limit denials, authorization denials, export failures, backup success, latency, audit-log write failures. Quantitative exit criteria and a named rollback owner defined **before** the pilot starts, not after.

### Phase 6 — Market expansion · `OPEN`

Gates nothing above. Only after pilot evidence: select US/ACGME or Saudi/SCFHS, research that market's current official requirements, produce fixture-based exports, and prioritize scheduling, CCC packets, duty-hour alerting, scholarly activity, EHR integration, and benchmarking against validated buyer demand. It is a strategy track, not a gate.

---

## IV. SMALL-LLM EXECUTION PROTOCOL

The operating manual for delegating implementation to smaller models. Design principle: **do not rely on the model being careful — make carelessness mechanically unmergeable.**

### The evidence base

Three defects in this register were introduced by a *large* model applying a *correct* recommendation:

| Defect | What passed | What broke |
|---|---|---|
| D-1 | typecheck, lint, 302 tests, build | every production API request |
| D-0 | nothing — but only because the edit was interrupted | 27 files' imports |
| D-8 | typecheck, lint, tests, build | nothing (dead code, correctly triaged P3) |

Automated gates cannot catch boolean-semantics errors, mid-edit truncation, or wire-format assumptions. Two of the three were produced by the model that wrote these rules — which is the case for enforcing them in CI rather than trusting prose.

### Rule 1 — Every ticket is a closed contract

Eight mandatory fields. A ticket missing any is not ready, and the model must refuse it rather than infer the gap.

```markdown
## TICKET-NNN: <imperative title>
**Files you may edit (exhaustive; editing anything else = automatic rejection):**
**Files you may READ but MUST NOT edit:**
**Invariant enforced (one plain sentence):**
**Exact change:** <literal diff, or a spec with no interpretive room>
**Acceptance test:** <path — the test is the contract; see Rule 10>
**Verification commands + expected behavior (never counts):**
**Blast-radius questions, answered in writing before editing:**
  1. Every call site of every symbol you touch (with grep output)
  2. Production behavior on the failure/default path
  3. Every env var read, and behavior when each is unset
**Rollback:** one `git revert` must fully undo this ticket.
```

### Rule 2 — Budgets, and an explicit waiver path

| Limit | Value |
|---|---|
| Files edited per ticket | ≤ 3 |
| Net lines changed | ≤ 150 |
| New dependencies | 0 (human approval required) |
| DB migrations per ticket | ≤ 1 |
| Concurrent tickets touching one file | 1 |

**Waiver clause (new in v2).** These numbers are heuristics with no evidence behind them, and D-4 already breaks them: one shared `getClientIp()` must replace 14 copy-pasted call sites, and splitting that across five tickets would leave the codebase in a mixed state where some paths trust a spoofable header and some do not — strictly worse than one larger change.

So: a ticket may exceed the file budget **only** for a mechanical, single-pattern, repo-wide replacement, and only when it declares `WAIVER: mechanical-sweep`, lists every file, and ships a test proving the old pattern no longer occurs anywhere:

```ts
expect(filesMatching(/x-forwarded-for/)).toEqual(['lib/client-ip.ts']);
```

The line budget is never waived. A sweep that cannot be expressed as one pattern is not a sweep — it is several tickets.

**Waiver governance (new in v2.2).** The clause above was gameable as written: "mechanical" was self-declared, so any ticket could claim it. Four requirements, all four mandatory:

1. **Machine-generated file list.** The ticket's file list must be the verbatim output of a committed grep command, not typed by hand. A file in the diff and absent from that output is an automatic rejection.
2. **Diff-normalization proof.** Every hunk must reduce to the same normalized substitution. Concretely: strip whitespace and identifiers from each hunk and assert every hunk is byte-identical to the others. A sweep with one hunk that differs is not mechanical, and that one hunk is where the defect will be.
3. **Changed-line ceiling.** ≤ 5 net lines per file and ≤ 10 lines in the shared helper. A sweep whose per-file change exceeds 5 lines is doing something other than substituting.
4. **Named human approver** recorded in the PR. The waiver is never self-granted.

**The label waives the file budget and nothing else.** It does not waive security review, integration tests, Rule 4's environment matrix, or Rule 7's review protocol. TICKET-002 qualifies (one identical substitution × 14 sites). TICKET-007's service-role sweep does **not** — classifying a query as tenant-scoped or intentionally global is judgment, hunks will differ, and Rule 3 forbids a small model from exercising it.

### Rule 3 — The no-invention rule

> If a table, column, function, type, env var, or route is not named in your ticket or visible in the files you were given, **it does not exist**. Do not create it. Do not assume it. Stop and report: `TICKET-NNN blocked: requires <thing>, not in scope.`

`supervision_level`, `ccc_reviews`, `leave_requests`, and `epa_achievements` all sound like they belong in this schema. None exist. This rule converts a hallucinated migration into a blocked ticket.

### Rule 4 — Mandatory environment matrix

Before any change touching `process.env`, auth, rate limiting, or feature flags, fill this in **in the response** and attach it to the PR:

| Env condition | Expected behavior | Verified how |
|---|---|---|
| dev, var set | | |
| dev, var unset | | |
| prod, var set | | |
| prod, var unset | | |

This table alone would have caught D-1 before it was written.

### Rule 5 — State the failure direction, per key class

Every security-control change states in a code comment and the PR body which direction it fails and why that is right for *this* control:

- Authentication / authorization → fail **closed**
- Availability-critical paths (`/api/health`, `/api/ready`, general `/api/*`) → fail **open**, loudly
- Audit logging → never block the operation; alert on write failure

D-1 existed because one predicate covered both a credential surface (`login:`) and all API traffic (`api:`). Those require opposite failure directions. A control spanning both key classes must be split before it is written.

**And do not overstate what the open path buys.** v1 claimed the local per-process budget "bounds brute force at 5 × instances." Given D-4 that bound is vacuous. The correct claim: the local limiter is a *reduced-security fallback with no bound against a distributed or header-rotating attacker*, acceptable only in a deliberately chosen, documented `single-instance` mode.

### Rule 6 — Mechanical gates

Rules 1-5 depend on the model complying. These do not — they run in CI and block the merge regardless of intent.

**Gate A — `scripts/verify-tenant-scope.mjs` · a DETECTOR, not a proof**

Flags any file importing `createServiceRoleClient` that queries a tenant-scoped table without `.eq('tenant_id'` in the same chain.

v1 called this "the load-bearing part." That was wrong, and the correction matters more than the script. **Documented false-negative classes:** queries assembled through variables or helper functions; chains split across lines or built conditionally; RPC calls; joins and aliases; any table added to the schema but not to the script's list. **False-positive class:** intentionally global administrative queries.

Therefore: Gate A is a tripwire that catches the copy-paste case. Tenant isolation is established **only** by Phase 1 item 7 — the service-role inventory plus a route-level integration test per privileged mutation. The two are not substitutes, and this document may not again imply that they are.

Hardening: the tenant-scoped table list is generated from the migrations by a test that fails when the schema and the list diverge. Exemptions require an inline `// tenant-scope-exempt: <reason>`, **plus** code-owner approval, **plus** an expiry date, **plus** a CI-printed census — an inline comment alone normalizes far too easily.

**Gate B — rate-limiter behavior matrix**

Asserts behavior, never counts. Required cells: dev/prod × Redis configured/unset; Redis timeout; Redis HTTP error; **malformed envelope**; Redis `{error: …}` payload; concurrent calls at the threshold; every key prefix actually used in the repo (24 distinct, enumerated by grep — not a hand-written subset); liveness and readiness behavior. Module isolation via `vi.resetModules()` + dynamic import so no cell depends on import-time env state.

Two cells are non-negotiable and would each have caught a P0:

```ts
// D-2: mock the DOCUMENTED Upstash envelope, assert denial actually happens
fetchMock.mockResolvedValue({ ok: true, json: async () => ({ result: 31 }) });
expect((await checkRateLimit('api:1.2.3.4', 30)).allowed).toBe(false);

// D-1: prod + Redis unset must not take the API down
expect((await checkRateLimit('api:1.2.3.4', 30)).allowed).toBe(true);
```

**Gate C — production boot smoke test**

Build with `NODE_ENV=production` and no Upstash, boot, `curl -f /api/health` and `/api/ready`. Non-200 on liveness fails the build. Cheapest possible insurance against a repeat of D-1.

Extended in v2.2, because D-9/D-11 showed a build that compiles is not a stack that runs:
- `docker compose config` must exit 0 — this alone catches D-9's undefined `api-gw` service.
- Boot with `RATE_LIMIT_MODE` unset and `NODE_ENV=production` must **exit non-zero** rather than start and serve 500s (D-11).
- **Route probe:** assert `/api/setup/*`, `/api/backup*`, `/api/uninstall`, `/api/update/execute` return 404 in the PHI artifact — from the running container, not from the source tree (D-5).
- Run on a **clean tree at a tagged commit.** A green Gate C on a dirty tree is not release evidence.

**Gate D — security tests cannot vanish silently**

No `continue-on-error` on any test or security job, and a job that fails when a named critical suite is absent or empty. A deleted test must never look like a passing test. Suites are referenced by path, never by count.

**Gate E — PHI-claim guard**

No marketing surface (`app/page.tsx`, `app/(marketing)/**`, `README.md`) may contain "HIPAA-compliant", "HIPAA compliant", or "SOC 2" until Phase 4 completes. Compliance-documentation pages exempt by path allowlist.

**Gate F — credential keys never silently degrade**

Source + behavioral assertion that in `distributed` mode a credential key is denied rather than served from the local `Map`, and that `redisDegradedSince` is set on that path so readiness reflects it.

**Gate G — single client-IP derivation (new in v2) · NECESSARY, NOT SUFFICIENT**

Exactly one file may read `x-forwarded-for`. Blocks reintroduction of the 14-way copy-paste in D-4, and makes the trusted-proxy assumption reviewable in one place.

**What this gate does not prove, stated so nobody mistakes it for the fix.** A wrapper can read the header from exactly one file, accept attacker-controlled input, and pass. Centralization is a *reviewability* property, not a *trust* property. The gate is satisfied by the same defect it was written to stop, so it carries two additional assertions:

```ts
// the helper must consult a configured trust boundary, not just parse
expect(source).toMatch(/TRUSTED_PROXY_HOPS|trustedProxy/);
// and the spoofing cases must be covered, by name
expect(testNames).toContain('rejects client-supplied X-Forwarded-For when hops = 0');
```

Even with those, the gate cannot see whether the deployed topology matches the configured assumption. That is D-10, it is not testable in unit CI, and it is why the trust boundary is specified in TICKET-002 and verified in Gate C against a running stack.

**Gate H — export compatibility (new in v2.2)**

Enumerate every symbol imported from a first-party module anywhere in the repo; fail when one disappears from the module that exports it. This is the mechanical enforcement Rule 11 was missing: D-0 is exactly a removed export with live importers, and it would have been blocked at the commit that removed it rather than discovered by a reviewer two documents later.

### Rule 7 — Review protocol

In order; stop at the first failure.

1. Diff scope matches the ticket allowlist (`git diff --name-only`)
2. Line budget respected, or a declared `WAIVER: mechanical-sweep`
3. Blast-radius questions answered with grep evidence, not prose
4. Environment matrix filled in for anything reading `process.env`
5. Failure direction stated and correct for the control's purpose
6. **The test is real** — revert the source change, confirm the test goes red, restore. A test passing both before and after tests nothing.
7. All gates green: typecheck, lint, full suite, build, Gates A-H
8. No invention — grep every new identifier
9. **The change is complete** — no declared-but-uncalled symbols, no assigned-but-unread state (Rule 11)

Item 6 is the one small models most often fail: they assert on their own implementation rather than on behavior. Item 9 is new in v2 and exists because D-0 would have passed items 1-8.

### Rule 8 — Escalation triggers

Stop and hand back on any of: RLS policies, `FORCE ROW LEVEL SECURITY`, `GRANT`/`REVOKE`; `lib/supabase/admin.ts`, `lib/supabase/middleware.ts`, `proxy.ts`; deleting or renaming a DB column; a test failing for a reason not understood after **two** attempts; verification output not matching the ticket; needing to edit a file off the allowlist; anything touching keys, tokens, or `.env*`.

*Two attempts is a heuristic, not a safety guarantee.* It is asserted, not measured, and v2.2 labels it that way deliberately rather than leaving it to read as a validated threshold. The failure mode it targets is a model that, by attempt three, starts deleting tests to reach green. The failure mode it may cause is stopping too early against flaky infrastructure like D-7. Until there is data from actual runs, treat it as a default that a human may override in either direction. Recorded as `OPEN`.

**Flake is never a resolution.** A flaky security test fails its gate and opens an investigation item. It may not be closed by a retry, a longer timeout, or `continue-on-error` — those convert a flaky red into a false green, which is the exact outcome every rule in this section exists to prevent. D-7 is the live case and TICKET-005 forbids retries as a remedy by name.

### Rule 9 — Forbidden actions

Never: delete, skip, or `.skip()` a test to make a suite pass; add `continue-on-error`, `|| true`, `--passWithNoTests`, `@ts-ignore`, or `eslint-disable` to silence a failure; widen a type to `any` to clear a typecheck error; modify `ci.yml` (human-only); commit anything matching `.env`, `*.pem`, `*.key`, `supabase-config.json`; run `git push --force`, `git reset --hard`, `git clean -f`, or `supabase db reset` against a non-local database; change a `CHECK` constraint or `NOT NULL` on a PHI column.

Each is a plausible local "fix" and a serious project-level defect. Listed explicitly because implicit understanding cannot be assumed.

### Rule 10 — One source of truth per contract (new in v2)

> A behavioral contract is stated **once**, in an executable acceptance test. Prose references the test by path and never restates the expected behavior in words. Any ticket changing a contract must show the test diff in the same commit.

v1 violated this and it was the most serious flaw in the document: Task 0.1, Gate B, and TICKET-001 each stated the rate-limit contract, and they disagreed. Gate B asserted login is denied when Redis is unset in production; TICKET-001's code denied only when an explicit flag was set. A small model handed both would have received a test it could not satisfy and — under Rule 9, forbidden from deleting it — no legal way out.

Three prose statements of one contract will drift. One test will not.

### Rule 11 — Atomic completeness (new in v2)

> A ticket is either fully applied or fully absent. Never leave a symbol declared but uncalled, state assigned but unread, or an export removed while importers remain.

D-0 is the worked example: `WINDOW_SCRIPT` declared and never invoked, `redisDegradedSince` reset and read but never assigned, `checkRateLimit` and `rateLimitResponse` deleted with 27 importers still live. The tree did not compile.

**Required edit sequence, in this order.** Every checkpoint compiles, so an interruption at any point leaves a working tree:

1. Write the contract test against the *intended* surface. It fails — that is the red.
2. Add the new implementation **alongside** the old one. Nothing removed yet.
3. Switch the exports to the new implementation. Test goes green; all importers still resolve.
4. Delete the old implementation. Separate commit.

v2.1's repair took none of these steps. It rewrote the internals first, which has no safe interruption point: every intermediate state is a broken build.

**Mechanically enforced, since prose will not do it:**

- **Gate H (export compatibility)** — fails when a symbol imported anywhere in the repo disappears from its module. This is the check that would have caught D-0 at the commit that caused it.
- `pnpm typecheck` on the changed package before any commit. Note honestly: this repo has **no git hook infrastructure today** — no `.husky`, no `lefthook`, no `lint-staged`. Claiming a pre-commit hook enforces this would be another unbacked assertion, so either the hook is installed as part of the ticket or the check lives in CI alone and the plan says so.
- `noUnusedLocals` on new modules catches declared-but-uncalled.
- Rule 7 item 9 as an explicit reviewer checkpoint.

An interrupted edit is not a partial success. It is a broken build that must be finished or reverted before anything else proceeds — and it must be **reported as broken**, not described as adopted.

---

## V. TICKET BACKLOG

**Nothing in this section is implemented.** Status `ACCEPTED` throughout. Execution is on hold pending instruction.

### TICKET-001: Restore and correct the rate limiter · closes D-0, D-1, D-2, D-3

Rewritten in v2 to a single contract. v1's version is withdrawn — it contradicted its own acceptance test.

**Files you may edit:** `apps/web/lib/rate-limit-redis.ts` · `apps/web/lib/__tests__/rate-limit-contract.test.ts` (new) · `packages/env/src/index.ts` · `.env.example`
**Read but do not edit:** `apps/web/proxy.ts` (call sites 28, 34, 40)

**Invariant:** The limiter enforces a correct threshold via one atomic Redis operation; the deployment mode is chosen explicitly by the operator and validated **before the process accepts traffic**; a Redis outage degrades readiness and denies credential requests without denying general API traffic.

**The contract — stated once, here, and encoded in `rate-limit-contract.test.ts`:**

| Condition | `api:` key | `login:` key | `/api/health` | Readiness |
|---|---|---|---|---|
| `single-instance`, any env | local Map, full budget | local Map, budget ≤ 5 | never limited | ready |
| `distributed`, Redis healthy | Redis, atomic | Redis, atomic | never limited | ready |
| `distributed`, Redis down/erroring | local Map + error log (**open**) | **denied** (**closed**) | never limited | **degraded** |
| `RATE_LIMIT_MODE` unset, `NODE_ENV=production` | boot hook throws → **process exits non-zero** | same | n/a | never starts |
| `RATE_LIMIT_MODE` unset, dev/test | defaults `single-instance` | defaults `single-instance` | never limited | ready |
| `distributed` without Upstash credentials | boot hook throws → process exits non-zero | same | n/a | never starts |
| `single-instance` **with** Upstash credentials present | local Map (credentials ignored) + one startup warning | local Map, budget ≤ 5 | never limited | ready |

Row 4 and row 6 changed in v2.2. v2.1 said "startup validation throws," which was not true of the code it described — see D-11. The mechanism is now named: an `instrumentation.ts` `register()` hook, and the assertion is on the **process exit status**, not on a thrown error somewhere in the request path.

**The seven questions the adjudication asked, answered as contract:**

1. **`EVAL` wire shape.** `POST` to `${UPSTASH_REDIS_REST_URL}` with body `["EVAL", <lua>, "1", <key>, "60"]`. Response `{"result":[<count>,<ttl>]}`. Both elements are integers; anything else throws. The mocked-response test asserts on this exact literal.
2. **Degradation ordering.** `redisDegradedSince` is set **before** the request result is returned, in the same `catch`. A request may be denied while readiness still reads ready only if the write happens after — so it does not happen after. Gate F asserts the ordering, not just the value.
3. **`retryAfter` when TTL is -1 or -2.** `-2` = key gone (window already expired), `-1` = key exists with no expiry (an `EXPIRE` that did not land). Both are treated as `retryAfter = WINDOW_SECONDS` — the conservative direction — and `-1` additionally logs, because it means the Lua guard failed and the key would otherwise never expire. Never emit a negative or zero `Retry-After`.
4. **Clearing degradation.** Immediately on the next successful Redis call. No health threshold, no flap damping. Rationale: a threshold adds a tunable with no evidence behind it, and readiness is already polled on an interval, which supplies the damping. If flapping is observed in the pilot, that is a measured reason to add a threshold — not a reason to guess one now.
5. **Local fallback keying and bound.** Same key string as the Redis path, so behavior is comparable across modes; per-process `Map`; credential keys capped at `min(maxRequests, 5)`. **Documented as reduced security with no bound** against a distributed or header-rotating attacker — not as a guarantee. See Rule 5's closing paragraph and D-4.
6. **`single-instance` with Upstash credentials set.** Credentials are ignored and one warning is logged at boot. The mode is the authority, not the presence of credentials — inferring mode from credentials is exactly the implicit-policy-selection defect this enum exists to remove. Contract row 7.
7. **Startup vs first-call validation.** Currently first-call, which makes v2.1's claim false. `resolveMode()` stays lazy and memoised for testability, and `instrumentation.ts`'s `register()` calls it once at boot alongside `parseWebFullEnv(process.env)`. Verified by Gate C observing a non-zero container exit, not by inspection.

**Exact changes:**
1. Restore `checkRateLimit` and `rateLimitResponse` with their existing signatures — 27 files import from this module, none of their call sites may change.
2. `redisCommand` uses the POST/JSON-array form and **unwraps `{result}`**; throws on `{error}` and on a missing `result` field.
3. Call `WINDOW_SCRIPT` via `EVAL`; derive `retryAfter` from the returned TTL, per answer 3.
4. Assign `redisDegradedSince` on every Redis failure path before returning; clear it on the next success.
5. `RATE_LIMIT_MODE` enum into the Zod schema and `.env.example`, required when `NODE_ENV=production`.
6. New `apps/web/instrumentation.ts` with `register()` calling `parseWebFullEnv(process.env)` and `resolveMode()`.
7. Delete `REQUIRE_REDIS_IN_PROD` and every reference to it.

**Sequence (Rule 11):** contract test first (red) → new implementation alongside the old → switch exports (green) → delete the old. Each checkpoint compiles.

**Verification:** `pnpm typecheck` exits 0 · `pnpm lint:all` exits 0 · `pnpm test` exits 0 with `rate-limit-contract.test.ts` present and green · Gate C: boots with `NODE_ENV=production` + `RATE_LIMIT_MODE=single-instance` and reaches `/api/health`; **exits non-zero** with `RATE_LIMIT_MODE` unset. **No expected test counts** (Rule 7 item 7 checks presence and status, never totals).

**Red/green proof required, per change and not per ticket.** Six changes passing together does not show any one test detects its own defect. Revert change 2 alone → the D-2 cell goes red. Revert change 5 alone → the unset-in-production cell goes red. Revert change 6 alone → Gate C's non-zero-exit assertion goes red. A suite that passes for the wrong reason is how this codebase arrived here.

**Rollback:** one `git revert`.

### Remaining tickets

| Ticket | Closes | Scope | Waiver |
|---|---|---|---|
| TICKET-002 | D-4, D-10 | New `lib/client-ip.ts` + trust-boundary config; replace 14 call sites; Gate G. **Blocked on TICKET-008** | `WAIVER: mechanical-sweep` (all four governance requirements apply) |
| TICKET-003 | D-6 | `/api/health` → liveness only; new `/api/ready`; exempt both in `proxy.ts`; **repoint the compose healthcheck** | — |
| TICKET-004 | D-5 | Remove installer/setup/backup/uninstall/update routes from the PHI artifact; **prove absence**, don't gate | **human-only** (Rule 8) |
| TICKET-005 | D-7 | Root-cause the forks-worker startup flake in vitest pool config. Retries explicitly forbidden as a remedy | — |
| TICKET-006 | D-8 | Delete `SupabaseConfig` interface and both dead lines in `setup/page.tsx` | — |
| TICKET-007 | Phase 1.7 | Service-role inventory + one integration test per privileged mutation | multiple tickets, one per route group |
| TICKET-008 | D-9 | Fix the compose stack: define or remove `api-gw`, add `config/Caddyfile`, unpublish or localhost-bind :3000 | **human-only** (deployment topology) |

TICKET-004, TICKET-007 and TICKET-008 are explicitly **not** delegable to a small model: TICKET-004 trips two Rule 8 triggers, TICKET-007 requires judgment about which queries are intentionally global — precisely what Rule 3 forbids — and TICKET-008 is a topology decision with security consequences that no ticket can specify away.

**TICKET-002 — trusted-proxy specification.** Gate G is not the fix; this is. The ticket must state, in `lib/client-ip.ts` and in `LAUNCH_SCOPE.md`:

- **Which component overwrites the header.** In the shipped topology that is Caddy — which *appends* to `X-Forwarded-For` by default, so the first value stays client-supplied. Caddy's `trusted_proxies` must be configured, and the app must read the value at a known offset from the end, not `[0]`.
- **How many hops are trusted** (`TRUSTED_PROXY_HOPS`, required in production, default 0 meaning "trust nothing, use the socket address").
- **What happens when the request did not arrive through the proxy** — with `:3000` published (D-10) it can, so the default must be to ignore the header entirely rather than to trust it.
- **Prefer a platform-verified address where one exists.** Self-hosted Docker has none; the socket peer address is the only unforgeable value available, and behind a correctly configured single proxy it is the proxy's address, which is why the hop count is required rather than inferred.

Test matrix, five cases, all required: direct connection with no header · spoofed header with `hops=0` · multiple proxy hops with `hops=1` and `hops=2` · header absent behind a proxy · IPv6 including bracketed forms and IPv4-mapped addresses.

**TICKET-003 — readiness is five things or it is nothing.** A readiness endpoint no orchestrator reads is a JSON document, not a control. All five are co-required and the ticket does not close on a subset:

1. `/api/health` — liveness. No Redis, no database, no I/O. Returns 200 whenever the process is running. The current implementation performs a DB round-trip and returns 503 on failure, which tells the orchestrator to **kill** the container over a transient blip.
2. `/api/ready` — readiness. Consumes `rateLimiterHealth()` and a database ping; 503 when either is degraded.
3. Both paths exempted in `proxy.ts` **before** the limit is applied. Today `/api/*` minus `/api/auth` is limited, so the probe path is itself rate-limited — under a denying limiter that is a crash loop, not an outage, and no test in the suite exercises it.
4. **The deployment configuration that consumes them.** `docker-compose.yml:35-40` currently points its healthcheck at `/api/health`; it must point at `/api/health` for liveness *and* the readiness path must be consumed by whatever gates traffic. Compose alone only marks a container unhealthy; Swarm, Kubernetes, and `autoheal` restart it. Which of those the pilot runs is a Phase 0 decision, and the ticket names it.
5. A test asserting the liveness handler performs **no** I/O — by module-level mock rejection, not by reading the source.

**TICKET-004 — proof of absence, not inaccessibility.** Three independent artifacts, all required, because "the route returns 403" is a claim about code and "the route is not in the artifact" is a claim about the build: (1) build-manifest inspection showing no entry for the route group; (2) runtime probe against the running container asserting 404 (Gate C); (3) a network rule blocking the bootstrap paths at the proxy. Convention is not a control.

**TICKET-008 — the stack has never been started.** Three changes, each independently verifiable, and the ticket closes only when `docker compose config` exits 0 *and* `docker compose up` reaches a healthy app container:

1. `depends_on: api-gw: condition: service_healthy` names a service that does not exist. Either define `api-gw` or delete the dependency. Deleting is the smaller change and is correct if Caddy is the intended gateway.
2. `./config/Caddyfile` is bind-mounted and does not exist anywhere in the repository. Docker will silently create a *directory* at that path, and Caddy will fail to parse it. Write the Caddyfile — including `trusted_proxies`, which TICKET-002 depends on.
3. `ports: - "3000:3000"` publishes the app alongside Caddy's 80/443. Remove the mapping or bind it to `127.0.0.1:3000`. Until then TLS is optional in practice and every proxy-derived security assumption is false.

D-11's `instrumentation.ts` is covered by TICKET-001 change 6 rather than here, because the boot hook is the rate limiter's startup contract and splitting it would leave TICKET-001 unable to prove its own row 4.

---

## VI. OPEN QUESTIONS — nothing below is sourced

Every item is `OPEN`. v1 presented several of these as facts. Seven research subagents died on a rate limit and one web search succeeded; that is not research. No item may become an acceptance criterion until it has a named owner, a retrieval date, a URL, and confirmation from a program or coordinator.

| Question | Needs |
|---|---|
| ACGME case-log minimums for the launch specialty | Specialty + revision date; official source; owner |
| Milestones 2.0 half-level representation | Confirm whether half-levels are required. `milestones.level INTEGER CHECK (level BETWEEN 1 AND 5)` cannot store them — a migration, if so |
| WebADS export format | v1 said "likely XML or CSV." That is not an acceptance criterion. Needs the real spec and a fixture |
| Duty-hour rule set | 80h/4-week average assumed; confirm against current requirements and the launch specialty |
| SCFHS requirements | Entirely unsourced. Needs a Saudi program contact |
| Competitor workflows (MedHub, New Innovations, others) | Do not build a matrix before Phase 0 names the launch market |

**What is *not* open.** These are absence-of-artifact facts about this repository, grep-verified, and they stand independently of any market research: no CCC/semi-annual review workflow; no leave/absence/call-schedule/swap requests; no conference or didactic attendance; no remediation or probation workflow; no wellness/burnout instruments; no license/certification/immunization tracking; no FHIR/EHR integration; no program-evaluation (PEC/APE) workflow; no per-resident EPA entrustment table (`epa_mappings` holds tenant-level definitions only); no first-class `supervision_level` column (only a JSONB template option at `00005_seed_data.sql:60`); no FK from `case_entries` to `procedure_codes`.

Which of those the first market actually *requires* is the open question. Whether they exist is settled: they do not.

---

## VII. WHAT WOULD CHANGE MY ASSESSMENT

Stated so the next reviewer can aim at something falsifiable.

1. **D-2 is the load-bearing new claim.** If the Upstash REST API does not wrap responses in `{result: …}`, D-2 collapses and the severity ordering in §II is wrong. Adjudicate this first; it is one mocked-fetch test away from settled.
2. **If the pilot topology is single-process** (Phase 0's decision), D-3 drops to P3 and D-2's severity drops with it, because the Redis path is never taken. Phase 0 therefore reprices half this register — which is why it is Phase 0.
3. **If a trusted proxy provably overwrites `X-Forwarded-For`** in the pilot topology, D-4 drops to P2 and becomes a documentation task rather than a code sweep.
4. **If installer routes are absent from the production build** rather than merely gated, D-5 closes without further work. Verify against the build manifest, not the source.
5. **D-9 is falsified by one command.** If `docker compose config` exits 0 against `docker-compose.yml` as committed, I am wrong about `api-gw` and the claim must be withdrawn. If it exits non-zero, then no one has ever run the documented deployment, and every deployment-shaped claim in this document — including D-6's and D-10's — is about a stack that has never started.
6. **D-10 is repriced by topology, not by argument.** If Phase 0 chooses a single-host pilot with no external ingress to :3000 — firewall, Docker network isolation, or a bind to `127.0.0.1` — D-10 drops to P3. If the port stays published on a reachable interface, it is P1 and TICKET-002 cannot close, because the trusted-proxy premise is false whenever a client can reach the app directly.
7. **D-11 is settled by an exit code.** Start the container with `NODE_ENV=production` and `RATE_LIMIT_MODE` unset. If the process exits non-zero, I am wrong and boot validation exists. If it serves `/api/health` and then 500s on a limited route, the defect is confirmed: the orchestrator believes a misconfigured instance is healthy.
8. **The three deployment defects reorder the work, and that is the falsifiable part.** I claim D-9 and D-10 must be fixed before TICKET-002 and TICKET-003 — not because they are more severe, but because they make those tickets' evidence unobtainable and their premises false. If a reviewer can show that TICKET-002 closes soundly with :3000 published, the ordering in §III is wrong and should be reverted to ChatGPT's original eight steps.
