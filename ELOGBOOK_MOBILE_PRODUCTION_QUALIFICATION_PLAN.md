# E-Logbook mobile production qualification plan

**Review date:** 2026-09-09  
**Repository basis:** current working tree after the mobile-first implementation work; base reference `165f9ae`.  
**Audience:** small coding models, Claude debate, human security/clinical/release owners.

This is an implementation and qualification plan. It is not a certification and cannot promise zero defects before the required evidence exists. “Complete” means the feature is wired into the supported user path, tested at its real boundary, built into a signed artifact, and accepted by its owner. A passing unit test alone never closes a ticket.

## Current verdict

**NO-GO for production or app-store release.** The new work is useful but still contains integration and parity gaps.

Evidence observed:

- `pnpm typecheck` passed across the workspace.
- `pnpm lint:all` passed, but the mobile postinstall script is designed to emit warnings when a renderer is absent. A clean build must prove that no warning is emitted or classify the expected message explicitly.
- Mobile Vitest passed: **44 files, 340 tests passed, 1 file skipped; 6 tests skipped**. The skipped tests include legacy sync coverage, and the suite uses native mocks; it does not prove Android/iOS behavior.
- The full workspace test gate is not green: the prior run reached web with 426 passing tests but three Vitest worker-start timeouts. Reproduce and fix this in CI before a release claim.
- No final signed Android/iOS artifact, device matrix run, store metadata validation, or crash-free staged rollout evidence was available during this audit.

## Findings that block qualification

### P1 — the new queue is not the active submit path

`apps/mobile/app/(tabs)/log-case.tsx` still imports `enqueueCase` from `lib/offline-queue.ts` and calls it after a direct Supabase insert fails with a network error. The new `durable-queue.ts` is account-scoped and idempotent, but the visible case screen does not enqueue through it. `sync.ts` also retains legacy queue fallback and many `Sync disabled in v1 (UXM-001)` methods. This creates two queue formats, two error policies, and an unproven migration boundary.

**Acceptance:** choose one supported queue; route insert, edit, and delete operations through it; remove or isolate the legacy path; add a test that exercises the real screen submit adapter and proves the operation ID reaches the server. A failure must never be reported as saved until durable local state exists.

### P1 — capability and account context are only partially integrated

`lib/capability.ts` can fetch a server profile/policy snapshot, but the root guard and most screens still use session presence and direct queries. `setAccountContext` is populated with an empty `profileId`; context clearing does not itself wipe drafts, queue items, database rows, caches, push tokens, notification previews, or telemetry identity. Client role values remain display hints, but the capability contract is not the common gate for sensitive actions.

**Acceptance:** one boot/session state machine resolves current user, profile, tenant, status, data mode, policy version, expiry, and step-up state before protected routes render. Sensitive actions require a fresh capability and server response. Account switch/sign-out tests prove old context cannot read, flush, display, notify, or export data.

### P1 — encryption claims exceed native evidence

Drafts and the new queue use the AEAD helper and SecureStore key, but the Watermelon adapter is a normal SQLiteAdapter and SQLCipher is not proven in a produced binary. The same device key is shared across contexts and no complete rotation, invalidation, recovery, or secure wipe protocol is demonstrated. The active direct Supabase path may receive plaintext by design, so the storage claim must be stated precisely: encrypted local-at-rest envelope versus transport/server controls.

**Acceptance:** publish a key/data-flow ADR; inspect Android and iOS artifacts; test SecureStore unavailable/corrupt, key loss, rotation, reinstall, backup restore, logout, and device transfer. Never fall back to plaintext or silently discard identifiable work. Obtain security-owner approval for the residual device-loss risk.

### P1 — server policy must be proven at every boundary

Tenant data-mode fields and new idempotency/publication migrations exist, but mobile capability data is not authorization. Test fresh replay and upgrade replay for tenant admin, platform admin, suspended user, stale JWT metadata, cross-tenant IDs, identifiable/deidentified inserts and updates, exports, attachments, AI input, secret views, and RPCs. Legacy broad `admin` grants in migration history require a final live-schema proof rather than grep-based conclusions.

**Acceptance:** direct REST/RPC/RLS tests return deny-by-default results for every forbidden case, with audit rows and no sensitive error leakage. Both tenant-admin choices remain capped by super-admin/install policy.

### P1 — native build and CI do not yet prove a release

The EAS workflows still need a single explicit project directory, frozen lockfile, pinned tool versions, completed-build wait, artifact download, signature/provenance checks, and Android plus iOS coverage. Any `--no-wait ... || echo` pattern that allows a failed build to continue must be removed. Generated native settings, backup policy, cleartext/ATS policy, permissions, release signing, minification, source maps, and runtime version must be inspected from the actual artifact.

**Acceptance:** a clean checkout produces reproducible signed artifacts linked to a commit, dependency lockfile, SBOM, config hash, certificate fingerprint, and test report. A failed, cancelled, unsigned, or incomplete build fails the workflow.

### P1 — clinical feature completeness is unproven

The app contains routes for cases, approvals, evaluations, duty hours, milestones, analytics, AI insights, profile, notifications, and attachments, but there is no evidence matrix proving every role, mode, loading/error/empty/offline state, permission denial, retry, destructive action, and server failure on a real device. Edit/duplicate/repeat flows still use direct Supabase reads and need the same policy and encryption contract as create.

**Acceptance:** actual-device scripted and manual journeys pass for resident, supervisor, director, institution admin, and platform-admin-supported surfaces. Unsupported admin capabilities are clearly unavailable and server-denied.

### P2 — web/mobile design and accessibility are not equivalent

The web contract uses shared Apple Health-inspired tokens, light/dark support, Inter, no shadows/glow, focus/reduced-motion behavior, and RTL direction handling. Mobile duplicates divergent spacing/type/color tokens, hardcodes English in screens, uses `userInterfaceStyle: light`, hardcodes a dark status bar, lacks runtime RTL/theme integration, and retains shadows and non-contract colors in tabs, menus, widgets, date fields, and biometric surfaces.

**Acceptance:** generate native tokens from the shared source; implement system/light/dark theme and status-bar behavior; replace hardcoded colors/shadows; add Arabic/RTL and Dynamic Type; run contrast, TalkBack, VoiceOver, reduced-motion, focus, touch-target, and screenshot comparisons against the web contract.

### P2 — warnings and telemetry are not zero-warning qualified

There are intentional `console.warn` calls for disabled sync methods, renderer patch skips, and decryption failures, plus direct `console.error` calls in screens/services. Some are expected operational events; none should leak PHI or be emitted as unclassified production warnings.

**Acceptance:** define an allowlisted redacted logger with severity and event IDs; convert expected states to structured UI/status events; fail CI on unapproved warnings/errors during tests and startup. Prove that MRN, DOB, patient fields, tokens, URLs, ciphertext, and attachment paths never reach logs, Sentry, analytics, notification previews, or crash breadcrumbs.

## Architecture decision and dependency graph

**Recommended first qualified mobile release:** online-first direct API plus one durable encrypted retry queue. Full offline identifiable records remain a separate qualification cycle until revocation, device-loss, key recovery, conflict, and retention requirements are accepted by a clinical/security owner. This recommendation is provisional until the product owner records the customer connectivity requirement.

```text
M0 scope/threat model/ledger
  ├── M1 authoritative capability + account lifecycle
  │     ├── M2 draft/key/storage boundary
  │     │     └── M3 single durable queue + server idempotency
  │     │           └── M4 real clinical workflows
  │     │                 └── M5 reliability/observability
  │     │                       └── M6 measured performance/accessibility
  │     └── M7 design/token/theme/i18n parity (can start after shared contract)
  ├── M8 native build/signing/provenance (parallel after M0)
  └── M9 backend/ops/setup/update/editorial enterprise stream (parallel; separate release gate)
```

## Implementation tickets

### M0 — scope, threat model, ledger

1. Add `docs/upgrade/evidence/mobile/ledger.yaml` plus a schema checker. Fields: claim, requirement, source, implementation, test, artifact, owner, status, reviewedAt, expiryPolicy, blocker.
2. Add attacker/risk records for stolen device, malicious resident, insider administrator, compromised account, network attacker, malicious update, and backend operator. Record blast radius, controls, residual risk, and incident owner.
3. Record the online-first decision, identifiable-mode customer requirement, unsupported offline promises, supported OS/device matrix, locale/accessibility scope, and release rollback authority.
4. Add CI validation for schema, missing artifacts, forbidden “production-ready” claims, and unapproved warning/error output. Do not impose an arbitrary universal 30-day expiry.

### M1 — one authoritative session boundary

1. Wire `fetchCapabilitySnapshot` into boot, foreground, 401/403, tenant switch, sensitive actions, and sign-out. Do not use metadata roles for authorization.
2. Populate the complete account context, including profile ID and policy version, before draft/queue/cache/sync initialization.
3. Implement context disposal: stop timers/listeners, cancel requests, clear in-memory state, wipe or quarantine scoped drafts/queue/database/cache, clear notification/Sentry identity, and unregister or rotate push context according to the ADR.
4. Add screen-level authorization adapters for all create/edit/approve/export/AI/attachment/admin actions. Server denial remains authoritative.

### M2 — one storage and key contract

1. Route every draft and PHI field through one adapter. Remove the old `case_form_draft` and legacy queue after a versioned migration deletes plaintext remnants and proves upgrade safety.
2. Decide field-level AEAD versus verified SQLCipher. Bind envelopes to account, tenant, record, field purpose, schema version, and mode; reject wrong scope/tamper without plaintext fallback.
3. Define device/account/tenant key hierarchy, rotation triggers, old-generation compatibility, key loss, secure deletion, and backup behavior. Obtain owner approval for unrecoverable-device data loss.
4. Test persistence and artifact behavior on Android and iOS, including OS backups, screenshots, recent-apps previews, temporary files, and notification content.

### M3 — durable queue and API contract

1. Make the active case screen enqueue insert/update/delete operations into `durable-queue.ts`; edits cannot silently become online-only.
2. Make `client_operation_id` mandatory for new writes and idempotent in one server RPC/upsert contract. Return canonical IDs and audit operation outcomes.
3. Serialize queue state with a crash-safe storage transaction or native database; test enqueue during flush, crash at every async boundary, duplicate delivery, quota/full storage, corrupt item, auth expiry, policy revocation, conflict, and unknown errors.
4. Show pending, retrying, quarantined, conflict, and permanently rejected states with safe recovery. Never claim “submitted” before server confirmation.

### M4 — complete clinical workflows

1. Build a role/mode/route matrix covering all supported mobile features and server-denied unsupported features.
2. Test create/edit/duplicate/repeat, templates/favorites, approvals, evaluations, duty hours, milestones, analytics, AI disclosure/quota, profile, notifications, exports, and attachments.
3. Add loading, empty, error, offline, expired-session, suspended-tenant, policy-change, retry, and destructive-action states. Verify every direct query has tenant and user scope.
4. Validate touch targets, keyboard behavior, safe areas, Dynamic Type, screen reader labels, focus order, haptics, reduced motion, and Arabic/RTL with actual users.

### M5 — sync and observability

1. Remove disabled duplicate sync APIs or isolate them behind a clearly non-production build boundary. Document whether the qualified release has push-only retry or full pull sync.
2. If pull sync is required, specify server cursor plus deterministic tie-breaker, tombstones, schema compatibility, immutable clinical audit events, and manual conflict resolution where LWW is unsafe.
3. Implement redacted structured telemetry with an allowlist and CI fixtures containing MRN/DOB/SSN/token patterns. Add queue latency/depth, retry class, conflict, policy version, app version, and crash context without payloads.
4. Add process-death, background-limit, intermittent-network, clock-skew, token-expiry, server-upgrade, and partial-batch tests against a disposable Supabase project.

### M6 — web parity, performance, accessibility

1. Generate native design tokens from `packages/shared`; remove duplicate spacing/type/color definitions and shadow/glow drift.
2. Implement shared theme provider, system preference, status-bar contrast, dark mode, RTL direction, localization, and locale-aware dates/numbers.
3. Capture baseline traces on representative low/mid/high devices before setting budgets. Measure cold/warm start, time-to-interactive, 100/10,000-case lists, large forms, memory, battery, sync bytes, and crash-free sessions.
4. Optimize one measured bottleneck per PR. Store screenshots, accessibility reports, traces, and regression comparisons.

### M7 — native release integrity

1. Run Expo/EAS from `apps/mobile` explicitly with frozen dependencies and pinned versions. Make build completion and artifact download mandatory.
2. Inspect signed Android AAB and iOS IPA for bundle ID, certificate, permissions, backup/ATS/cleartext rules, debug flags, minification, source maps, runtime version, embedded URLs, and exported components.
3. Generate SBOM, dependency/license/security scan, provenance attestation, and release notes. Test upgrade compatibility from at least two prior app versions.
4. Use internal alpha, beta, and staged production rollout with monitored crash/error/queue/policy metrics, kill switch, rollback, and incident contacts. Thresholds are set after baseline measurement and owner approval.

### M8 — enterprise carry-forward

1. Finish durable ops execution, VPS/Docker/Supabase setup, backup/restore, update/rollback, signing/catalog/revocation, outage recovery, and human approval gates.
2. Test atomic theme/editorial publication under concurrency, integrate the real landing page renderer, locale, preview, cache invalidation, and audit.
3. Reconcile all RLS, secret views, RPCs, tenant suspension, platform-admin grants, and data-mode ceilings in fresh and upgrade databases.
4. Refresh T00–T28 evidence and keep NO-GO while any gate is blocked or any production claim lacks an artifact.

## Required test layers

Every ticket uses the smallest applicable set, then escalates:

1. Pure unit tests for validation and state transitions.
2. Integration tests with mocked storage/network and real account context.
3. Supabase/RLS/RPC tests against fresh and upgraded disposable databases.
4. Android and iOS native artifact inspection.
5. Actual-device manual and automated journeys, accessibility, performance, and process-death tests.
6. Staged rollout telemetry and rollback rehearsal.

Do not mark a test passed when it is skipped because native dependencies are unavailable. Report environment limitations separately and keep the gate unresolved.

## Small-model rules

- Read the ledger row, call graph, and existing tests before editing.
- Make one bounded change per PR and preserve a failing reproduction.
- Do not delete migrations or quarantine code without import, upgrade, and rollback evidence.
- Do not use UI flags, JWT metadata, or client role strings for authorization.
- Do not claim encryption, SQLCipher, HIPAA, offline sync, accessibility, performance, enterprise readiness, or production certification without the exact artifact.
- Never use real patient data, production secrets, signing keys, or credential-bearing URLs in tests, logs, screenshots, or prompts.
- Never loosen a failing gate or hide warnings to make CI green.
- Keep the Apple Health-inspired clinical identity and shared web tokens; change visual behavior only with measured accessibility, usability, or performance evidence.

## Human decisions required before implementation closes M0

- Product/clinical owner: online-first MVP versus a customer-required full offline mode.
- Security owner: acceptable device-loss/key-recovery residual risk and key hierarchy.
- Privacy/legal owner: identifiable-mode retention, export, backup, and regulatory mapping.
- Release owner: supported devices, performance budgets, rollout thresholds, and rollback authority.
- Platform owner: exact admin boundary between tenant administrators and super-admins.

**Release decision at review time: NO-GO.**

## Audit delta from the implementation reviewed after the plan

The working tree contains new uncommitted M1–M5 files and migrations. Their presence improves the design, but the following integration evidence changes the priority order:

- `lib/capability.ts`, `fetchCapabilitySnapshot`, and `requiresStepUp` have no production callers found outside tests. `log-case.tsx` and `evaluations.tsx` still perform direct writes without a capability/mode gate. Treat the capability layer as dormant until the boot and sensitive-action paths call it.
- `_layout.tsx` and the tabs layout both call `useSyncInit`; `lib/sync-service.ts` also defines a separate `OnlineSyncService`. `lib/sync.ts` flushes the new durable queue and then always calls the legacy global `flushQueue()`. This can reintroduce unscoped, non-idempotent submissions and duplicate auth listeners. The next implementation must have one sync owner and one queue format, with a migration test before legacy code is removed.
- Account context is populated asynchronously and with an empty `profileId`. Draft autosave can run before context initialization and write `global:case_form_draft.v1`. Sign-out clears the pointer but does not prove deletion/quarantine of old scoped AsyncStorage, database, audit, telemetry, notification, or crash-recovery state. Add a boot barrier and a disposal test.
- Older telemetry/storage/audit paths still write arbitrary or unscoped values to AsyncStorage. The new scrubber is not evidence until all producers route through it. Add a producer inventory and a test that inspects every relevant storage key and logger sink.
- `database.ts` still configures a normal Watermelon SQLiteAdapter without a native key/SQLCipher option. Keep the encryption claim limited to the fields and stores actually sealed until a final artifact proves database encryption.
- Web parity must be measured against the real web implementation too: the web layout currently has a hardcoded `dir='ltr'`, so RTL is an unfinished shared requirement rather than a mobile-only gap.
- The setup control plane is a separate P1. The setup API routes (`apps/web/app/api/setup/*`) return 404 in `NODE_ENV=production`, but their non-production/setup-mode branch was observed without an authentication/CSRF/origin guard, rate limit, one-time bootstrap token, or concurrency lock. In that branch they can potentially deploy Supabase/Docker, run migrations, create an admin/tenant, write domain configuration, and mark setup complete when the marker condition allows it. Before exposing a wizard, require a localhost/bootstrapping boundary, one-time capability, origin/CSRF validation, strict input validation, locked durable job, least-privilege executor, audit, and rollback. Prove every route with anonymous, replayed-token, concurrent, malformed, and post-completion requests on a disposable host.
- `publish_site_page()` now uses a row lock and CAS, but its audit insert is explicitly best-effort and the function itself does not enforce tenant authorization. Keep authorization in the database function or a trusted service boundary and make the audit contract transactional or explicitly append to a durable failure queue.
- Local native verification is limited: Java/Android tooling was unavailable in this environment, so no signed binary, manifest, backup rule, or iOS artifact has been qualified.

These findings supersede any older statement that the new capability, queue, telemetry, or setup code is “implemented” merely because its source file or unit tests exist. Update the ledger status to `wired`, `tested`, `artifact-verified`, or `blocked` with a source and owner.

## Minimum qualification loop for each release candidate

1. Record the candidate commit, clean-tree status, dependency lockfile hash, environment/tool versions, and ledger snapshot.
2. Run typecheck, lint, mobile tests, web tests with a bounded worker configuration, database fresh replay, database upgrade replay, and security/dependency scans. Preserve warnings and failures as artifacts.
3. Start the app from a clean install and exercise the supported role/mode matrix on Android and iOS devices or emulators. Capture startup, navigation, submit, retry, sign-out, account-switch, policy-change, and error evidence.
4. Inspect the produced artifacts and logs for permissions, signing, debug flags, embedded secrets/URLs, plaintext fixtures, PHI/token leakage, and warning/error output.
5. Run setup/update/rollback only on a disposable VPS or isolated project with explicit human approval. Verify anonymous access is denied before enabling any setup route.
6. Re-run the failed scenario after every fix, then update the ledger and gate owner. A warning, skipped native test, unavailable environment, or unverified artifact leaves the relevant gate unresolved.
