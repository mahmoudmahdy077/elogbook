# E-Logbook next iteration: enterprise release qualification

**Review date:** 2026-09-09  
**Repository state:** current working tree after the previous mobile qualification plan. The implementation changes are currently uncommitted; source presence and unit tests are not deployment evidence.  
**Release decision:** **NO-GO** until the gates below pass.

This plan is the next bounded iteration after `ELOGBOOK_MOBILE_PRODUCTION_QUALIFICATION_PLAN.md`. It follows the same Karpathy rules: inspect the active call graph first, make one reversible change, preserve a failing reproduction, and close a claim only with a real boundary test and an artifact. “100% working” means every supported workflow has a defined result for success, offline, denial, timeout, restart, and server failure. It never means a model can promise zero future defects.

## What changed since the previous review

The tree now includes an account-scoped encrypted draft store, durable queue, capability/session modules, authorization adapters, theme/design-token modules, telemetry scrubbers, a clinical matrix, setup guards, queue idempotency migration, atomic publication migrations, and a machine-readable mobile ledger. The mobile suite reports **53 files, 388 tests passed, 0 skipped**, and `check-mobile-ledger.mjs` reports OK. Typecheck and lint passed in the previous run.

Those results are valuable regression evidence, but most entries are still `wired` or `tested` with no device, fresh-database, upgrade-database, disposable-host, signed-artifact, or owner-approval evidence. The repository is not yet a production release.

## Fresh findings and release blockers

### N0/N1 — possible cross-tenant write bypass in the latest RPC

The latest `sync_push_batch` `SECURITY DEFINER` migration was observed building dynamic updates that predicate on `id` only, without a tenant predicate or complete role/column allowlist. The new `client_operation_id` column is not consumed by that RPC. If confirmed on final replay, an authenticated caller who knows a row ID could update another tenant's row and bypass role/business rules.

**Required result:** inspect the final live function body, grants, search path, and callers after fresh and upgrade replay. Replace it with a fixed-schema, tenant-scoped operation RPC that verifies current account status, role, mode, ownership, allowed columns, immutable audit fields, and operation ID. Add direct REST/RPC cross-tenant negative tests; index existence is insufficient.

### N1 — data-mode relabeling must be immutable or explicitly audited

The data-mode trigger migration was observed returning early when `NEW.is_deidentified` is true. That may allow an existing identifiable record to be relabeled as de-identified if other checks pass, contradicting mode history and silent-PHI-relabeling requirements.

**Required result:** define whether mode is immutable after creation. If a controlled transition is required, use an audited transaction with explicit authorization and irreversible-history rules. Add insert/update tests for both directions, tenant ceilings, exports, and old-client payloads.

### N1 — CI currently hides the requested warnings

`.github/workflows/ci.yml` sets `NODE_NO_WARNINGS=1` and `VITE_CONFIG_NATIVE_IGNORE_WARNING=1`. This can make CI appear clean while Node/Vitest configuration warnings still occur locally.

**Required result:** remove global suppression, fix the ESM/CommonJS Vitest configuration and renderer postinstall behavior, then fail the release gate on unapproved warning/error output. Store raw logs as artifacts.

### N1 — setup/update execution still needs a production boundary

Setup locks/rate limits are process-local, the bootstrap token is reusable/static, forwarded IP can be spoofed without a trusted-proxy contract, and audit is best-effort. Setup completion writes its marker before proving all steps. The legacy updater can execute unsandboxed `git pull`/Docker operations without signed catalog, writer fencing, migration health, rollback, or multi-instance coordination.

**Required result:** durable one-time token and job state, trusted proxy configuration, durable lock/lease, transactional completion criteria, least-privilege executor, signed artifact/catalog verification, maintenance/fencing, health checks, backup/rollback, and disposable VPS rehearsal.

### N1 — stale capability fallback and mode mismatch remain possible

The case screen catches a failed `requireFreshCapability` call and falls back to `getSession().capability`. `canPerform` does not itself require freshness or compare the requested `isDeidentified` value with the server capability's `dataMode`. A client can therefore attempt identifiable capture under a deidentified policy and rely on a later server rejection; a missing account context can also make queueing fail after the user has typed a case.

**Required result:** sensitive submit must fail closed when a fresh capability cannot be obtained, and the adapter must reject a mode mismatch before local persistence. Add explicit offline policy behavior and a safe recovery message.

### N1 — update and delete identity contracts need a server proof

The mobile update adapter filters an update by row ID and the durable queue currently uses one `upsert` call for every action. The legacy-queue migration generates new operation IDs, so replay safety is not proven for items that were already submitted before migration. These are correctness and tenant-isolation boundaries even when RLS is expected to help.

**Required result:** use a server operation RPC with tenant/user predicates and immutable operation identity; make delete a real tombstone/soft-delete operation; preserve legacy operation IDs where available or record a migration deduplication proof. Test known cross-tenant IDs, duplicate replay, update-after-submit, and delete-after-approval.

### N2 — declared dark mode and route parity are not runtime parity

The theme provider resolves a mode, but screens and containers still use fixed light backgrounds/tab bars and dark-era text classes. `setMode` has no persisted settings UI, and `I18nManager.forceRTL` requires restart/layout verification. Role metadata still controls some tab affordances, deep links lack one centralized capability guard, and mobile has fewer administrative/audit/compliance/report routes than web.

**Required result:** make the supported mobile route matrix explicit, centralize capability guards, either implement or clearly deny missing admin features, and test rendered screens (not just token objects) in light/dark/RTL/localized states on devices.

### N2 — data access and performance are unbounded

Several screens issue direct `.select('*')` or fetch all case statuses without pagination/field allowlists. This makes PHI exposure, memory use, and slow-device behavior hard to bound.

**Required result:** define typed field projections, tenant/user scoped query adapters, pagination/virtualization thresholds, and large-dataset tests. Record traces before changing caching or memoization.

### N1 — legacy queue migration can reattribute work

`lib/legacy-migration.ts:migrateLegacyQueueOnce()` reads the old unscoped queue and re-enqueues decrypted payloads under the current account/tenant. Because the old format has no authenticated owner binding, a queue left by one account can be submitted by the next account after a device switch. It also creates fresh operation IDs, weakening duplicate replay protection. Queue read/storage errors are converted to an empty queue, and no queue size/count bound is enforced.

**Required result:** quarantine or delete unscoped legacy items unless authenticated ownership proves their origin; never reattribute them. Preserve a trustworthy operation ID, fail visibly on corruption/storage failure, enforce bounded size/count, and test migration after account switch, crash, quota exhaustion, and duplicate replay.

### N1 — final server operation/RPC must be security-reviewed

The latest `sync_push_batch` `SECURITY DEFINER` migration was observed using dynamic updates keyed by row ID, with no demonstrated tenant predicate or complete role/column allowlist. The mobile queue's `client_operation_id` is not necessarily consumed by that RPC. This can bypass the intended mobile operation contract even if the client adapter is correct.

**Required result:** inspect the final function body, grants, search path, and every caller after fresh and upgrade replay. Replace it with fixed-schema, tenant-scoped insert/update/delete operations that verify current account status, role, mode, ownership, allowed columns, immutable audit fields, and operation identity. Add direct REST/RPC cross-tenant negative tests.

### N1 — EAS provenance check can validate the wrong build

The mobile workflow now waits for Android/iOS builds, but a generic `eas build:list --status finished --limit 1` can select an older successful build unrelated to the current commit or configuration. Builds on fork pull requests may also lack credentials. A completed EAS job is not proof that this candidate's artifact is signed or tested.

**Required result:** capture build IDs from the exact invocation, download those artifacts, match commit/config/lockfile hashes, inspect certificates and manifest/IPA settings, and make credential-dependent jobs run only in protected contexts with an explicit fork-safe validation path. Run dependency/license/security scans against the candidate and artifact before release approval.

### N1 — route and role matrix is incomplete

The mobile role menu has fewer routes than the web and `canPerform` currently permits several case/evaluation/duty/AI/attachment actions for any active role. Deep links can bypass menu affordances. This is a product-scope and authorization gap, not merely a navigation difference.

**Required result:** generate a role/action/route matrix from the web contract and server policy; decide which routes are supported, deep-linked to web, or explicitly denied on mobile. Centralize route guards and test every role, action, mode, stale capability, suspended tenant, and unauthorized deep link.


## Critical-path graph

```text
N0 evidence ledger + risk/ownership
 ├── N1 session/capability/account disposal
 │    ├── N2 operation adapters + data-mode policy
 │    │    └── N3 one durable queue + server operation RPC
 │    │         └── N4 complete clinical route matrix
 │    │              └── N5 device reliability + performance + a11y
 │    └── N6 telemetry/redaction/warnings
 ├── N7 shared design/theme/i18n parity (after token contract; parallel with N1)
 ├── N8 signed native artifacts (parallel after N0)
 └── N9 backend/setup/update/publication qualification (parallel; separate gate)
```

## Bounded implementation tickets

### N0 — evidence and ownership

1. Snapshot the clean/dirty state, commit, lockfile hash, tool versions, and environment limits. Do not call uncommitted source a release.
2. Update `docs/upgrade/evidence/mobile/ledger.yaml` statuses to `wired`, `tested`, `artifact-verified`, or `blocked` based on actual evidence. A passing unit test with no device/artifact remains `tested` at most.
3. Add threat/risk entries for stolen device, malicious resident, insider admin, compromised account, network attacker, malicious update, privileged setup operator, and telemetry leak. Include blast radius, controls, residual risk, owner, and review trigger.
4. Add a supported role/mode/route matrix. Explicitly list mobile-admin features that are unavailable and server-denied instead of silently implying web parity.

### N1 — authoritative session and account boundary

1. Make `bootSession` the only protected-route gate. Resolve profile ID, tenant, status, mode, policy version, expiry, and step-up state before rendering protected content.
2. Remove authorization fallbacks on role metadata and stale snapshots. A failed capability refresh locks sensitive operations and explains the safe next action.
3. Centralize context disposal for draft, durable queue, legacy migration, database/cache, rate limits, audit/metrics, telemetry, Sentry, notification previews, push tokens, screenshots, and in-flight requests.
4. Add actual route tests for every sensitive action and device tests for boot, refresh, suspension, tenant switch, sign-out, background timeout, biometric fallback, and process termination.

### N2 — operation and policy adapters

1. Define typed adapters for case, evaluation, duty hour, milestone, rotation, approval, attachment, AI, export, profile, and admin operations.
2. Make each adapter accept a current capability and return a typed outcome: confirmed, queued locally, denied, conflict, transient failure, or terminal failure. Avoid raw error strings in UI.
3. Enforce data mode through server policy for insert/update/export/sync/attachment/AI paths. The tenant administrator can select deidentified or identifiable mode only within super-admin/install ceilings. Record policy-version and actor audit data.
4. Add a static inventory check that fails when a new sensitive screen imports a raw Supabase write without an approved adapter. Review exceptions explicitly.

### N3 — one durable queue and server contract

1. Keep one queue format and one sync owner. Complete legacy migration before any flush; remove old global queue submission from production code.
2. Define operation semantics for insert/update/delete, stable operation ID, canonical server result, allowed columns, tenant/user checks, payload version, retry class, quarantine, and conflict behavior.
3. Implement delete as a server-authorized soft-delete/tombstone operation, not an upsert disguised as delete. Ensure approved or signed clinical records cannot be silently overwritten.
4. Test concurrent enqueue/flush, crash before and after server response, duplicate replay, storage quota, malformed/corrupt payload, token expiry, policy revocation, conflict, account switch, and app upgrade.

### N4 — complete clinical feature verification

1. For each supported role and both policy modes, exercise dashboard, case capture/edit/duplicate/repeat, templates/favorites, approvals, evaluations, duty hours, milestones, rotations, analytics, AI insight quota/disclosure, profile, notifications, exports, and attachments.
2. Verify success, loading, empty, offline, queued, retry, denied, suspended, expired, policy-changed, malformed, conflict, and destructive-confirmation states.
3. Use synthetic identifiable fixtures and inspect every local store, request, response, log, notification, screenshot, and telemetry event for leakage.
4. Record human clinical acceptance for wording, workflow order, and data-mode explanations.

### N5 — reliability, performance, and accessibility

1. Run Android and iOS device/emulator journeys with process death, background limits, intermittent network, clock changes, low storage, low battery, and OS upgrade.
2. Measure cold/warm start, time-to-interactive, 100/10,000-case list, large-form typing, memory, battery, sync bytes/latency, crash-free sessions, and queue drain. Set budgets after baseline; do not invent universal numbers.
3. Test VoiceOver/TalkBack, Dynamic Type, reduced motion, keyboard/switch access, focus order, labels, contrast, touch targets, Arabic/RTL, date/number formatting, and localization fallback.
4. Store traces, screen recordings/screenshots, accessibility reports, and regression comparisons in the ledger artifact directory.

### N6 — telemetry, redaction, and warning-free operation

1. Route all telemetry through one allowlist schema and context-scoped encrypted/bounded store, or document why the approved local store does not require encryption. Define retention and upload failure behavior.
2. Scrub errors and properties recursively; block PHI/token/URL/ciphertext/path patterns in CI fixtures and runtime tests. Never capture raw component error messages in user-visible copy or telemetry.
3. Replace direct `console.warn/error` with the approved logger. Classify expected unavailable/offline states separately from faults.
4. Fix the Vitest ESM warning and renderer postinstall behavior. CI must fail on unapproved warning/error lines during test, startup, prebuild, and artifact inspection.

### N7 — design system and web parity

1. Generate native tokens from `packages/shared` and remove duplicate spacing, typography, color, and radius constants.
2. Add a persisted theme setting with system fallback, dark/light contrast, status-bar behavior, and safe first render. Make direction changes restart-safe and locale-aware.
3. Replace hardcoded colors, shadows, black-on-low-contrast text, and web-only classes. Preserve the Apple Health-inspired clinical identity.
4. Fix/qualify RTL on both web and mobile. Add translation keys for all screen copy; no user-facing screen string remains hardcoded English without an explicit exception.
5. Add screenshot and accessibility comparison artifacts for web/mobile equivalent workflows.

### N8 — native build/release integrity

1. Run Expo/EAS from `apps/mobile` with frozen lockfile and pinned CLI/SDK. Require `--wait`, artifact download, provenance, and fail-closed exit handling.
2. Inspect signed AAB/IPA for certificate, IDs, permissions, backup/ATS/cleartext, exported components, debug flags, minification, source maps, runtime version, and embedded endpoints.
3. Verify SecureStore/keychain/keystore behavior, backup exclusion, screenshot/recent-app protection, notification redaction, and reinstall/upgrade behavior on real devices.
4. Produce SBOM, dependency/license/security reports, release notes, migration compatibility, staged rollout, kill switch, rollback, and incident contacts.

### N9 — backend and enterprise qualification

1. Run fresh and upgrade Supabase replay in a disposable project. Execute maintained pgTAP plus direct REST/RPC tests; capture schema, policy, grants, function search paths, and `SECURITY DEFINER` audits.
2. Make queue operations, publication, theme revision, audit, cache invalidation, and tenant authorization transactional or durably recoverable. Test concurrent publishers and failed audit paths.
3. Keep setup routes absent from normal production images. Rehearse guarded setup on disposable VPS with bootstrap-token replay, origin/proxy cases, rate-limit exhaustion, concurrency, crash, partial deployment, rollback, and marker recovery.
4. Implement and qualify the actual update executor, signed catalog, compatibility checks, backup/restore, rollback, and human approval. A button that returns “unavailable” is an honest state, not a completed updater.
5. Refresh T00–T28 evidence and do not change NO-GO while any gate is blocked or only source/test evidence exists.

## Gate table

| Gate | Pass evidence | Current state |
|---|---|---|
| N-G0 scope/ledger | reviewed ledger, threat model, owners, clean candidate | blocked: working tree and owners unresolved |
| N-G1 session/policy | device matrix + direct server denial tests | blocked: incomplete call-site/device proof |
| N-G2 storage/queue | operation RPC, replay/crash tests, key/device evidence | blocked: delete semantics/native proof |
| N-G3 features | role/mode route matrix on devices | blocked |
| N-G4 design/a11y | token parity, RTL/i18n, screen evidence | blocked |
| N-G5 performance | measured traces and owner budgets | blocked |
| N-G6 logs/warnings | clean CI/build logs and redaction scan | blocked: Vitest warning remains |
| N-G7 native release | signed AAB + IPA inspection/provenance | blocked |
| N-G8 backend/setup | fresh/upgrade DB and disposable VPS artifacts | blocked |
| N-G9 release approval | staged rollout, rollback, security/clinical/release sign-off | blocked |

## Rules for the implementing model

- Read this plan, the ledger row, the call graph, and existing tests before editing.
- Make one ticket-sized change and preserve the failing test or reproduction.
- Do not close `wired` claims with comments, file existence, mocks, or source grep.
- Do not use metadata role strings, UI mode toggles, or client flags for authorization.
- Do not delete migrations, legacy stores, or sync paths without upgrade and rollback evidence.
- Do not log real patient data, secrets, tokens, signing keys, or credential-bearing URLs.
- Never turn a warning into a pass by suppressing it. Classify or fix it and store the output.
- Use synthetic fixtures and disposable Supabase/VPS infrastructure.
- Keep the Apple Health-inspired identity and shared web tokens; change UI behavior only with measured usability, accessibility, clinical, or performance evidence.
- Stop and ask the named human owner when the product, privacy, clinical, security, platform-boundary, or release decision is missing.

**Final decision for this iteration:** NO-GO pending N-G0 through N-G9 evidence.
