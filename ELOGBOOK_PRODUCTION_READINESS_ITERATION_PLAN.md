# E-Logbook production-readiness iteration plan

**Review date:** 2026-09-09  
**Scope:** web, mobile, Supabase, setup/update control plane, CI/CD, and release evidence.  
**Current decision:** **NO-GO**. The working tree contains uncommitted implementation changes; source files and unit tests are not a release artifact.

This is the next iteration after `ELOGBOOK_NEXT_ITERATION_ENTERPRISE_RELEASE_PLAN.md`. It keeps the same evidence and Karpathy rules: inspect the active path, make one bounded change, preserve a reproduction, and close a requirement only with a boundary test and an artifact. “100% working” means every declared supported feature has defined success, loading, empty, failure, timeout, denial, restart, and recovery behavior. It does not mean a model may promise zero future defects.

## Current evidence

- `check-mobile-ledger.mjs`: passed.
- `check-mobile-adapters.mjs`: passed.
- Mobile Vitest reached **57 files and 421 passing tests** in the latest run. These tests use mocks for native storage, network, and many UI boundaries; no native artifact or real-device result was available.
- Mobile configuration warning work has moved `vitest.config.ts` to `.mts`, but a clean run still needs to prove zero warnings without global suppression.
- Typecheck/lint were previously passing; rerun against the current tree and retain raw logs.
- The tree remains uncommitted and includes new migrations, setup guards, mobile adapters, and evidence files. Update the ledger only after the candidate is frozen.

## Release-blocking findings

### R1 — Supabase operation RPC needs final security proof

The latest `sync_push_batch` history contains a `SECURITY DEFINER` dynamic update path keyed by row ID, while the newer mobile queue expects a tenant-scoped operation contract and `client_operation_id`. A migration/test file does not prove the final live function is safe. The operation path must be checked after both fresh replay and upgrade replay for grants, `search_path`, tenant predicate, account status, role, mode, ownership, allowed columns, idempotency, and delete/tombstone semantics.

### R1 — legacy queue migration must never reattribute data

The old queue format is unscoped. Migration must quarantine/delete it unless authenticated ownership can be proven. A next account must never inherit another user's queued identifiable record. Corruption/storage errors must be visible and queue size must be bounded.

### R1 — mode immutability requires database enforcement

Identifiable/de-identified mode is a governance decision controlled by tenant admin within super-admin/install ceilings. An existing identifiable record must not be silently relabeled. Verify the latest trigger/RPC with insert and update tests in both directions, including old-client payloads and exports.

### R1 — mobile adapters are incomplete until every caller is covered

Case create/edit now uses the submit adapter, but direct Supabase/Edge/Storage calls remain in evaluation, analytics, dashboard, AI, milestones, rotations, approvals, case detail, attachments, and profile flows. A capability module and static adapter checker do not prove runtime use. Inventory every call and provide a typed read/write adapter or a reviewed exception.

### R1 — setup/update are guarded but not operationally qualified

Setup routes are absent in production mode and have token/origin/rate-limit/lock code. The lock/rate-limit state, bootstrap token lifecycle, audit, completion marker, proxy trust, multi-instance behavior, partial failure, and rollback still require disposable-VPS evidence. The update executor remains unavailable by default; any legacy escape hatch must not be treated as production readiness.

### R1 — artifact provenance and native security are unproven

EAS now waits for Android/iOS jobs, but release verification must bind the exact build ID to the candidate commit, lockfile, config hash, and artifact. Inspect signed AAB/IPA for certificate, IDs, permissions, backup/ATS/cleartext, exported components, debug flags, minification, source maps, runtime version, embedded endpoints, and SecureStore/keychain behavior. No Android/iOS device run has been recorded.

### R1 — warnings are still not a release gate

Do not set `NODE_NO_WARNINGS=1` or `VITE_CONFIG_NATIVE_IGNORE_WARNING=1` to make CI green. Fix configuration and postinstall warnings, route expected events through the allowlisted logger, and fail on unapproved warnings/errors in tests, startup, prebuild, setup, and release commands.

### R2 — web/mobile design and scope parity remains a product contract

Mobile has shared-token/theme files, but runtime parity needs rendered evidence. Web and mobile still need an explicit role/action/route matrix, including features available only on web. Dark mode, RTL, localization, Dynamic Type, contrast, shadows, touch targets, and error copy require actual-device/screenshot/accessibility checks. Web's direction handling must be qualified too.

### R2 — data access and performance need bounded projections

Direct `.select('*')`, unbounded lists, global metrics, and raw error strings make exposure and low-end behavior hard to bound. Define typed projections, tenant/user scoping, pagination/virtualization, retention, and redacted telemetry before optimizing.

### R1 — credentialed release builds must not run on untrusted pull requests

The mobile workflow can run production EAS Android/iOS builds on same-repository pull requests while passing Expo and Supabase secrets. A PR-controlled build can exfiltrate those values or burn signed production build capacity. The CD workflow also builds independently without one canonical artifact/provenance chain. Runtime Sentry reads `EXPO_PUBLIC_SENTRY_DSN`, while workflows have used `SENTRY_DSN`, so telemetry can silently diverge between source-map and runtime configuration.

**Required result:** run secret-bearing production builds only on protected main/manual environments; PRs use static checks or secret-free preview builds. Establish one canonical release workflow with explicit production profile, exact build IDs, artifact download/hash, SBOM, signature/provenance, and candidate commit/config/lockfile matching. Set and verify runtime/source-map Sentry variables consistently, with redaction tests.

## Critical-path graph

```text
R0 candidate freeze + evidence/risk ledger
 ├── R1 server operation/mode/RLS proof ──┐
 ├── R2 mobile session + adapter inventory ├── R5 end-to-end feature matrix
 │    └── R3 queue/key/disposal proof ─────┘          └── R6 device UX/a11y/perf
 ├── R4 shared web/mobile UI/i18n parity (parallel after token contract)
 ├── R7 native signed artifact/provenance (parallel after R0)
 └── R8 setup/update/backup/rollback operations (parallel; separate enterprise gate)
```

## Implementation tickets

### R0 — freeze the candidate and ledger

1. Create a release branch/commit with clean-tree status, lockfile hash, Node/pnpm/Expo/EAS versions, environment limits, and the exact test commands.
2. Update `docs/upgrade/evidence/mobile/ledger.yaml` so statuses reflect evidence: `wired`, `tested`, `artifact-verified`, or `blocked`. Do not leave `wired` for a source-only claim that has a known blocker.
3. Maintain threat/risk entries for stolen device, malicious resident, insider admin, compromised account, network attacker, malicious update, setup operator, and telemetry leak.
4. Record owners for product mode, platform-admin boundary, key/device-loss risk, clinical acceptance, accessibility, release, and incident response.

### R1 — final server operation and governance boundary

1. On fresh and upgraded databases, inspect every relevant `SECURITY DEFINER` function, grant, owner, `search_path`, dynamic SQL, and RLS policy. Retire or lock down `sync_push_batch` if it cannot meet the new contract.
2. Implement one fixed-schema operation RPC for insert/update/delete with stable operation ID, canonical result, tenant/user/status/role/mode checks, allowed columns, and immutable audit fields.
3. Implement delete as an authorized tombstone/soft delete. Never represent delete as an upsert. Prevent edits to approved/signed clinical history except through an explicit audited workflow.
4. Make mode creation immutable or provide an explicit audited transition workflow. Test tenant-admin selection against super-admin/install ceilings and every PHI egress.
5. Add direct REST/RPC negative tests for cross-tenant IDs, stale JWT metadata, suspended users, wrong roles, mode mismatch, duplicate operations, old clients, and malformed payloads.

### R2 — session and operation adapter completion

1. Make the capability-backed session the sole protected-route gate. A failed/stale refresh locks sensitive actions; never fall back to cached capability for writes.
2. Populate and verify account context before draft/queue/cache/sync initialization. Centralize disposal for every local store, database/cache, metrics, rate limits, notifications, Sentry, push context, and in-flight request.
3. Inventory every mobile Supabase/Edge/Storage call and route all writes through typed adapters. Reads must use allowlisted projections and explicit tenant/user scope.
4. Add static CI checks for raw sensitive writes and runtime tests for capability denial, mode mismatch, expiry, suspension, tenant switch, unauthorized deep link, and account disposal.

### R3 — queue, key, migration, and storage proof

1. Keep one queue and one owner. Quarantine/delete unscoped legacy records unless ownership binding is authenticated; preserve trustworthy operation IDs and expose corruption/quota errors.
2. Prove concurrent enqueue/flush, crash before/after server response, duplicate replay, token expiry, policy revocation, conflict, low storage, app upgrade, account switch, and device transfer.
3. Decide field-level AEAD versus verified SQLCipher and document the exact claim. Bind envelopes to account, tenant, record, field, schema, and mode. Define device/account/tenant key rotation, loss, backup, and recovery without promising impossible recovery.
4. Inspect all local stores—including telemetry, audit, rate limits, notification state, caches, drafts, and metrics—for plaintext PHI/token/URL leakage and bounded retention.

### R4 — web/mobile UI and accessibility parity

1. Generate native tokens from the shared web source; remove duplicate scales, colors, typography, shadows, and hardcoded dark-era classes.
2. Implement persisted theme setting with system fallback, correct status-bar contrast, dark/light rendered screens, RTL restart behavior, locale-aware dates/numbers, and translated copy on both platforms.
3. Generate a role/action/route matrix from the web navigation and server policy. Implement mobile routes, safe web deep links, or explicit deny states; never rely on menu hiding for authorization.
4. Capture equivalent web/mobile screenshots and run contrast, reduced-motion, focus, keyboard/switch, VoiceOver/TalkBack, Dynamic Type, touch-target, and Arabic/RTL checks.

### R5 — complete feature matrix

1. Exercise resident, supervisor, director, institution-admin, and platform-admin-supported surfaces for dashboard, cases, templates/favorites, approvals, evaluations, duty hours, milestones, rotations, analytics, AI quota/disclosure, profile, notifications, exports, attachments, settings, audit/compliance, billing, and landing/editorial controls.
2. For each feature test success, loading, empty, offline/queued, retry, denied, expired, suspended, policy-changed, malformed, conflict, and destructive-confirmation states.
3. Use synthetic identifiable and de-identified fixtures. Inspect request/response, local storage, logs, crash reports, telemetry, notifications, screenshots, and exports.
4. Obtain clinical owner acceptance for workflow order, wording, mode explanations, and safe recovery messages.

### R6 — reliability, performance, and observability

1. Run Android/iOS device or emulator tests for process death, background limits, intermittent network, clock changes, low storage/battery, OS update, and reinstall.
2. Measure cold/warm start, time-to-interactive, 100/10,000-case lists, large forms, memory, battery, sync bytes/latency, queue drain, crash-free sessions, and web/mobile API latency. Set budgets from observed baselines.
3. Use one redacted structured logger and telemetry schema. Store only allowlisted metrics with context-scoped bounded retention; do not persist raw errors or identifiers without approval.
4. Remove global warning suppression. Fix Vitest ESM/config warnings and renderer postinstall noise; test startup/build/setup logs with an allowlist and fail on unknown lines.

### R7 — native release and provenance

1. Build from `apps/mobile` with frozen install and pinned Expo/EAS versions. Capture exact build IDs; download only those artifacts and verify commit/config/lockfile hashes.
2. Inspect signed AAB/IPA and store certificate fingerprints, manifest/Info.plist, permissions, backup/ATS/cleartext, debug/minification, source maps, runtime version, and endpoint reports.
3. Generate SBOM, dependency/license/security results, provenance attestation, migration compatibility, release notes, staged rollout, kill switch, rollback, and incident contacts.
4. Run the supported feature matrix on representative Android/iOS devices. A skipped or unavailable native test keeps the gate blocked.

### R8 — enterprise operations

1. Keep setup absent from normal production builds. Qualify one-time bootstrap token, trusted proxy/origin, durable lock/lease, rate limits, audit durability, input validation, least-privilege execution, marker recovery, and multi-instance behavior.
2. Rehearse fresh VPS install, Supabase deployment, migration failure, backup/restore, upgrade, rollback, outage, and partial completion. Do not use production data.
3. Implement update catalog/signature/compatibility, writer fencing, maintenance mode, health checks, rollback, and human approval. An unavailable executor is an honest state, not a complete updater.
4. Make publication/theme/landing changes transactional with authorization, audit, cache invalidation, locale, preview, and concurrency tests.

## Exit gates

| Gate | Required artifact | Current state |
|---|---|---|
| R-G0 candidate | clean commit, ledger, threat/risk owners | blocked: working tree/unresolved owners |
| R-G1 server security | fresh/upgrade DB replay + REST/RPC negative tests | blocked |
| R-G2 mobile data | adapter inventory, queue/key/disposal/device evidence | blocked |
| R-G3 feature matrix | real device journeys for supported roles/modes | blocked |
| R-G4 parity/a11y | screenshots, contrast, RTL/i18n, VoiceOver/TalkBack reports | blocked |
| R-G5 performance | measured traces and approved budgets | blocked |
| R-G6 warnings | raw clean CI/startup/build logs without suppression | blocked |
| R-G7 native release | signed AAB/IPA, provenance, SBOM, artifact inspection | blocked |
| R-G8 enterprise ops | disposable VPS setup/update/backup/rollback rehearsal | blocked |
| R-G9 approval | security, clinical, privacy, platform, release sign-off | blocked |

## Small-model rules

- Start from the ledger row and active call graph; do not trust comments or stale checklists.
- Make one ticket-sized change and keep a failing reproduction until the boundary is verified.
- Do not use UI flags, JWT metadata, or client roles for authorization.
- Do not delete migrations, legacy stores, sync paths, or routes without upgrade/rollback evidence.
- Do not claim encryption, SQLCipher, HIPAA, native success, accessibility, performance, enterprise readiness, or production certification without the exact artifact.
- Never use real patient data, secrets, signing keys, or credential-bearing URLs.
- Never suppress warnings or weaken a gate to make CI green.
- Keep the Apple Health-inspired identity and shared web tokens; make visual changes only from measured usability, accessibility, clinical, or performance evidence.
- Stop for named human approval when product mode, admin boundary, key-loss risk, clinical acceptance, privacy/legal mapping, or release thresholds are undecided.

**Final decision:** NO-GO until R-G0 through R-G9 have reproducible evidence.
