# Debate: eLogbook Production Upgrade Plan

**Review date:** 2026-09-02  
**Subject:** `PRODUCTION_UPGRADE_PLAN.md`  
**Verdict:** The plan is valuable as a risk register and execution discipline, but it is not internally consistent and it overstates what the current evidence proves. It should be treated as a gated pre-production program, not as a 30-day promise of PHI readiness.

## Executive judgment

Claude is right about the seriousness of the original cross-tenant authorization bug, the need to test service-role code separately from RLS, the danger of weak CI gates, and the need for independent security review before handling PHI. Claude is also right that a Redis-backed limiter is required for a horizontally scaled deployment.

The most important part is wrong, however: the proposed rate-limit contract contradicts itself. Task 0.1 says production without Redis should use a local fallback and allow login; Gate B and TICKET-001 say production without Redis must deny login. The implementation currently denies only when `REQUIRE_REDIS_IN_PROD=true`, so its behavior is neither the plan's first claim nor its test contract. This must be resolved before anyone asks a smaller model to implement it.

The plan also treats "tests/build pass" as stronger evidence than they are. They prove a reproducible snapshot compiles and passes its current tests; they do not prove tenant isolation across all routes, safe deployment configuration, correct regulatory exports, PHI handling, or production observability.

## What Claude got right

| Claim | Assessment | Why |
|---|---|---|
| Service-role queries can bypass RLS and need application-level tenant predicates | Correct | `createServiceRoleClient` is privileged. RLS tests alone cannot establish isolation for those paths. |
| The original cross-tenant user-management defect is a P0 | Correct | A tenant-scoped lookup must constrain the target tenant before mutation. Defense-in-depth checks are appropriate. |
| CI `continue-on-error` and pipefail mistakes can hide security failures | Correct | A green job is meaningless if the command producing the security result is allowed to fail. |
| Redis is needed for rate limiting across instances | Correct | An in-memory `Map` is per process and can be bypassed by distributing requests across instances. |
| External penetration testing, access review, incident response, backup restore, and contractual review are launch gates for PHI | Correct in principle | These are operational and legal controls, not substitutes for one another. |
| Marketing must not claim HIPAA compliance without evidence | Correct | HIPAA is a set of obligations and agreements, not a product badge that can be inferred from encryption or RLS. |
| Small model work needs narrow tickets and mandatory red/green tests | Correct and useful | Scope limits, explicit invariants, and tests that fail when the fix is reverted reduce accidental regressions. |

## Where the plan is wrong or too confident

### 1. Rate-limit semantics are contradictory

The plan contains three incompatible contracts:

1. Task 0.1 says `REQUIRE_REDIS_IN_PROD` is opt-in and, when unset, production may fall back locally.
2. Gate B expects `login:` to be denied when Redis is unset in production.
3. TICKET-001 says credential paths fail closed only with the explicit opt-in, but its supplied "after" behavior says login is denied.

The current code confirms the contradiction: `shouldFailClosed()` requires `isProd && REQUIRE_REDIS_IN_PROD && isCredentialKey(key)`. With production, Redis unset, and the flag unset, login falls back to the local map and is allowed on the first requests.

**Recommended decision:** use a three-state deployment contract, documented once and tested once:

- `REDIS_REQUIRED=true`: startup/readiness fails if Redis is absent; credential and API limits are unavailable rather than silently degraded.
- `REDIS_REQUIRED=false` in a deliberately single-instance self-hosted deployment: local limiter is allowed, with a warning and an explicit reduced-security mode.
- unset in production: configuration validation fails. Do not silently choose a security policy.

If a non-blocking pilot is genuinely required, make that a separate, explicit `SINGLE_INSTANCE_MODE=true` deployment profile. Do not make a security-sensitive default depend on an undocumented env var. Also add the variable to the Zod schema and `.env.example`; it is currently absent from both.

### 2. "Fail closed" for login is not automatically the right availability policy

Denying every login when Redis is down protects against distributed brute force but creates a complete authentication outage. That may be acceptable for a high-assurance hosted profile, but it is a product and incident decision, not a universal security rule. A better design is to fail closed at readiness for a multi-instance production deployment, while allowing a separately audited single-instance mode with a strict local budget, alerting, and a documented limitation.

### 3. The Redis algorithm has a race condition

The implementation uses `GET`, then possibly `SET`, then another `GET`, then `INCR`. Concurrent requests can both observe an expired/missing window and reset the counter, or both pass the threshold before incrementing. This is not a reliable distributed limiter. Use one atomic Lua script, a fixed-window `INCR` with `EXPIRE` set only on the first increment, or a vetted Upstash limiter implementation. Test concurrent calls, Redis timeouts, malformed responses, and clock/window boundaries.

### 4. The middleware comment and behavior do not match

`proxy.ts` labels the `api:` branch "unauthenticated API routes," but it applies to every `/api/*` route except `/api/auth`, including authenticated routes and `/api/health`. This makes the blast radius larger than the prose suggests. Either move unauthenticated limiting to explicit public routes or rename/document the branch and give health/readiness its own policy.

### 5. The setup secret issue is not "isolated" yet

The deploy response no longer includes infrastructure secrets, which is a good fix. But `/api/setup/deploy-supabase` is authorized only by `SETUP_MODE=true` and absence of `/app/data/.setup-complete`; there is no visible authentication, CSRF protection, rate limiting, origin check, or network restriction in the route. The client still sends `postgresPassword` over the browser request and expects `data.config`, although the server now returns only `apiUrl` and `version`.

Before production, setup/installer routes should be removed from the production build or bound to a private bootstrap network with a one-time, expiring enrollment token. Add tests proving unauthenticated, cross-origin, repeated, and post-completion requests are rejected. Do not call this mitigated until those controls exist.

### 6. The static tenant-scope gate is a useful tripwire, not proof

The proposed Gate A can miss queries assembled through variables, helper functions, RPCs, aliases, joins, or multiline chains, and can produce false positives where a cross-tenant administrative query is intentional. Its hard-coded table list can also drift from the 163 migrations. Keep it as a lint-like detector, but require route-level integration tests and a generated inventory of privileged queries. The exemption mechanism needs code-owner approval and a count/expiry policy; an inline comment alone is too easy to normalize.

### 7. Scope and evidence numbers are not stable enough for acceptance criteria

"47 API routes," "51 tables," "31 files / 302 passed," and exact expected test-file counts are snapshot facts, not durable contracts. The repository already contains 163 migrations and privileged service-role use in server pages and route handlers. Replace exact counts with generated reports, minimum assertions, and named critical suites. "Build succeeds" also does not demonstrate that Docker paths, backups, cron jobs, SSO, or external integrations work in the target environment.

### 8. Regulatory and market claims need source ownership and verification

The ACGME, SCFHS, WebADS, UK, and competitor sections are good research questions, but several statements are presented as facts before a source, specialty, jurisdiction, or contract is selected. Requirements vary by specialty and revision date. "Likely XML or CSV" is not an acceptance criterion. Assign a named source owner, record retrieval dates and URLs, obtain program/coordinator confirmation, and convert each requirement into a testable export fixture. Do not build a 50-row competitor matrix before choosing the first launch market.

### 9. BAA/DPA language is too broad

The plan says a BAA is required with "Supabase, Upstash, Sentry, any AI provider." That is directionally cautious but legally incomplete: whether a vendor is a business associate depends on the service, data flow, configuration, and contract. Inventory every PHI flow first, then have counsel verify vendor eligibility, BAA terms, subprocessors, retention, residency, and incident obligations. A BAA cannot make an insecure integration compliant.

### 10. The 30-day schedule mixes launch blockers with strategy work

Security remediation, clean migrations, backup restore, legal contracting, competitor research, SCFHS discovery, and product gaps cannot all be treated as one serial 30-day path. Separate a "controlled pilot readiness" gate from "market expansion" work. Mobile offline, EHR integrations, scheduling, CCC packets, benchmarking, and ERAS adjacency should not block a narrowly defined pilot unless they are explicit acceptance criteria.

## Revised plan Claude should adopt

### Phase 0: Establish the launch contract (1-2 days)

Write `LAUNCH_SCOPE.md` defining the first jurisdiction, specialties, deployment topology, whether PHI is allowed, supported roles, and excluded features. Choose the Redis policy above and add it to `packages/env` with fail-fast startup validation. Define `/api/health` (liveness) separately from `/api/ready` (database, Redis, migrations, key dependencies).

### Phase 1: Close verified P0/P1 security risks (3-5 days)

1. Resolve and test the rate-limit contract, including atomic Redis behavior and concurrent requests.
2. Inventory every service-role query and classify it as tenant-scoped, institution-scoped, or intentionally global; add integration tests for each privileged mutation.
3. Lock down or remove setup, backup, restore, update, and uninstall routes from the PHI deployment.
4. Add CSRF/origin protections where cookie-authenticated state changes are possible.
5. Verify session revocation after account deletion/role changes, MFA/AAL2 enforcement, audit-log non-blocking behavior, and PHI redaction in logs/errors/telemetry.

### Phase 2: Reproducible deployment evidence (3-5 days)

Run all migrations on a fresh disposable database, pgTAP, typecheck, lint, unit/integration tests, production build, boot smoke tests, readiness checks, and backup/restore verification. Capture artifacts rather than relying on line counts. Exercise the exact hosting topology used for the pilot, including proxy headers and multiple instances if applicable.

### Phase 3: Workflow acceptance (1-2 weeks)

Use role-based, end-to-end scenarios: invite, login/MFA, consent, case creation/submission, evaluation request/completion, duty-hour entry and violation, tenant switching, exports, retention, and account deactivation. Each scenario needs success, authorization failure, validation failure, timeout, retry, and audit assertions. This is where the current "workflow audit" belongs; it should produce executable tests for blockers.

### Phase 4: Legal and operational readiness (parallel, before PHI)

Complete the data-flow inventory, vendor/subprocessor review, BAA/DPA/legal review, access review, key rotation/revocation drill, incident runbook, breach-notification decision tree, retention/deletion verification, and support escalation. Obtain an external assessment with a fixed scope and severity SLA.

### Phase 5: Controlled pilot and go/no-go (30-90 days)

Pilot with one to three programs using de-identified data until the legal/security gate is complete. Monitor authentication failures, rate-limit errors, authorization denials, export failures, backup success, latency, and audit-log write failures. Define quantitative exit criteria and rollback ownership before adding PHI or more tenants.

### Phase 6: Market-specific expansion

Only after pilot evidence, select US/ACGME or Saudi/SCFHS as the next market. Then research the current official requirements and competitor workflows for that market, produce fixture-based exports, and prioritize scheduling, CCC packets, duty-hour alerts, scholarly activity, EHR integration, and benchmarking according to validated buyer demand.

## Replacement acceptance criteria for TICKET-001

The ticket is ready only after the owner chooses one policy and updates all prose/tests to match it. The acceptance suite must cover:

- development and production with Redis configured;
- development and production without Redis;
- Redis timeout, HTTP error, malformed response, and partial command failure;
- concurrent calls at the threshold;
- `api:`, `login:`, `auth-cb:`, and every other prefix actually used in the repository;
- health/readiness behavior;
- module isolation so tests do not depend on import-time environment state.

The expected result should be expressed as behavioral assertions (allowed/denied, status code, log/metric, readiness state), not an exact total number of test files.

## Final position

Approve the plan as a disciplined draft after correcting the contradictions and reducing its launch claim. Do not approve it as evidence that eLogbook is production-ready for PHI today. The immediate next action is not "ship in 30 days"; it is to choose the deployment/security contract, lock down setup and privileged routes, and turn the highest-risk claims into executable integration tests and documented operational evidence.

