# Adjudication: Claude Response and Production Plan v2

**Date:** 2026-09-02

## Verdict

Claude's latest response is the strongest version so far. It correctly accepts the P0 build break, preserves the distinction between `ACCEPTED`, `IMPLEMENTED`, and `VERIFIED`, replaces the contradictory boolean policy with a single `RATE_LIMIT_MODE` enum, and separates pilot readiness from market research.

The new plan should be approved as a design decision record and review checklist. It should not yet be approved for implementation or production claims. The repository remains broken until TICKET-001 is actually implemented and verified.

## Findings

### P0: the working tree is still non-functional

The response accurately reports that `apps/web/lib/rate-limit-redis.ts` is missing `checkRateLimit` and `rateLimitResponse`, while existing importers remain. This is the highest-priority item. No other ticket, refactor, or feature work should proceed until the public module surface is restored and typecheck passes under the declared toolchain.

The plan's Rule 11 is appropriate, but the rule is not enforcement by itself. Add a pre-commit or CI check that runs typecheck on the changed package and rejects a commit when exported symbols used by the repository disappear. The required sequence should be contract test, implementation, export compatibility, then cleanup, with a green compile at each meaningful checkpoint.

### P0/P1: the rate-limit contract is now coherent, but still incomplete

The enum design is better than two booleans and removes ambiguous states. The contract table is also materially clearer. TICKET-001 still needs precise answers for:

- the exact Redis `EVAL` request and response shape;
- whether a Redis outage sets degraded readiness before returning the request result;
- how `retryAfter` is calculated when TTL is `-1` or `-2`;
- whether successful Redis calls clear degradation immediately or after a health threshold;
- how the local fallback is keyed and bounded;
- what happens when `RATE_LIMIT_MODE=single-instance` is set with Redis credentials present;
- whether production startup validation truly runs at startup rather than only on the first limiter call.

The current implementation's `resolveMode()` is lazy. That is acceptable only if the application explicitly calls it during boot/readiness. Otherwise the plan's claim of startup validation is not true.

### P1: the IP identity problem is correctly elevated, but Gate G is not sufficient

Centralizing `x-forwarded-for` parsing is a good mechanical improvement. “Exactly one file reads the header” does not prove the value is trustworthy. A wrapper can read the header, accept attacker-controlled input, and still satisfy the gate.

The implementation ticket must specify the trusted deployment boundary: which proxy overwrites the header, how many hops are trusted, and what happens when the request does not come through that proxy. Add tests for direct access, spoofed headers, multiple proxy hops, missing headers, and IPv6. Prefer a platform-provided verified client address where available.

The local limiter must continue to be described as reduced security only. Even with trustworthy IPs, per-process limits are bypassable across instances and can be bypassed by distributed attackers.

### P1: readiness design needs an actual consumer

Claude correctly identifies that `/api/health` currently performs a database probe and is rate-limited by middleware. TICKET-003 must implement all of the following together:

1. a cheap liveness endpoint with no database or Redis dependency;
2. a readiness endpoint that checks database, migrations, required configuration, and rate-limiter state;
3. explicit HTTP/status semantics for degraded Redis;
4. proxy exemptions applied before any rate-limit branch;
5. deployment configuration that actually uses readiness to stop routing traffic.

A `rateLimiterHealth()` function without an endpoint and orchestrator configuration is observability code, not readiness behavior.

### P1: setup and installer routes remain launch blockers

The downgrade from “mitigated” to unauthenticated privileged endpoint is correct. The plan should additionally require proof that these routes are absent from the PHI artifact, not merely inaccessible by convention. Build-manifest inspection, runtime route probing, and a deployment firewall rule should all be part of TICKET-004. The setup browser's stale `data.config` state is correctly classified as P3 dead code and should not distract from the endpoint exposure.

### Process concern: the waiver and budgets need governance

`WAIVER: mechanical-sweep` is a reasonable escape hatch for identical substitutions, but it is gameable. Require a machine-generated file list, a diff-normalization check proving the replacement is identical, a maximum changed-line threshold, and explicit human approval. A “mechanical” label must never waive security review or integration tests.

The two-attempt escalation rule is rightly marked open. Until measured, treat it as a default heuristic rather than a safety guarantee. Flaky security tests should fail the gate and create an investigation item; retries must not be the only resolution.

### Evidence and regulatory scope

The v2 status legend and `OPEN` labels fix the earlier overclaiming. The next improvement is to attach evidence artifacts to every `VERIFIED` entry: command, environment versions, commit/tree identifier, and output location. A claim verified on a dirty tree should not be confused with a verified release.

The ACGME/SCFHS/competitor work is appropriately deferred until launch market and specialty are selected. Keep external requirements out of executable acceptance criteria until official sources and dated fixtures exist.

## Required implementation order

1. Restore the limiter exports and add the contract test so the repository compiles.
2. Add `RATE_LIMIT_MODE` to the environment schema and example; invoke validation during application boot/readiness.
3. Implement and test atomic Redis counting, envelope validation, TTL handling, degradation state, and local fallback.
4. Implement trusted client-IP derivation and replace all call sites as one reviewed sweep.
5. Split liveness/readiness and exempt both before rate limiting.
6. Remove or isolate setup, backup, restore, update, and uninstall routes from the PHI artifact.
7. Run typecheck, lint, unit/integration tests, production build, boot smoke tests, and route probes under Node 22/pnpm 9.
8. Only then begin the external security, legal, and controlled-pilot gates.

## Final assessment

Claude's response should be accepted as a successful correction of the plan's reasoning. The v2 plan is substantially more reliable than v1, but its status is still “accepted design, implementation pending.” The next reviewer should focus on whether the tickets produce working code and deployable evidence, not on adding more prose to the protocol.

