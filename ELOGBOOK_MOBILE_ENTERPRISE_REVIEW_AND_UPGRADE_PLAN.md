# E-Logbook mobile and enterprise readiness review

**Review basis:** repository at `165f9ae` (`fix(ci): fresh-replay v_pid guard, policy reconciler, standalone runtime, vacuous fail-fast`), reviewed 2026-09-09.

**Purpose:** give a small coding model a bounded, testable sequence for the next upgrade cycle. This document is also an adversarial review brief for Claude. It preserves the previous plan's evidence vocabulary and Karpathy-style rules: inspect before editing, make the smallest change that closes one verified gap, keep security decisions server-authoritative, and never close a ticket because a helper, comment, or mocked test exists.

## Decision status

The implementation is **partial and not production-qualified**. The recent work materially improves database policy migrations, setup/update state models, tenant branding, editorial APIs, and CI evidence. It does not yet deliver a working VPS installer/updater, a qualified mobile release, or an enterprise security boundary.

The mobile app is currently a hybrid: the visible case screen submits directly to Supabase and stores an autosave draft in unencrypted AsyncStorage; a separate encrypted offline queue is live for network failures; the WatermelonDB full-sync path is explicitly disabled (`apps/mobile/lib/sync.ts`, `UXM-001`); and the more complete local repository/SyncEngine path is not wired into the root layout or screens. Plan all three paths separately and delete or quarantine dormant paths when the supported path is chosen.

For data governance, retain the product decision that each tenant administrator chooses de-identified or identifiable records, subject to a platform/super-admin ceiling and an installation readiness ceiling. The app may display that choice, but the API/database remains the authority. Offline identifiable records require an explicit, reviewable policy and key-lifecycle decision; do not silently imply that an offline client can enforce server revocation.

## Evidence observed at this commit

### Verification that passed

- `pnpm typecheck`: all six workspace projects passed.
- `pnpm lint:all`: passed, including mobile ESLint.
- Mobile-only `pnpm --filter @elogbook/mobile exec vitest run --maxWorkers=1`: 36 files, 309 passed, 6 skipped.
- The mobile test suite is primarily JS/unit and native mocks. Six old `sync.push` tests are skipped. The network-security-config test can return success when its XML is absent, so it is not evidence of a native release property.
- The repository test command passed ops (51 tests) and reached web (49 files, 426 passed, 1 skipped) but had three Vitest worker-start timeouts. A one-worker web rerun did not finish within the review window. Treat the required aggregate test gate as failing/unresolved until reproduced in CI or fixed.

### Mobile findings

1. **P1 — global plaintext draft.** `apps/mobile/app/(tabs)/log-case.tsx:85-95,281-298,477` writes the entire case draft, including `patientMrn`, `patientDob`, `fieldValues`, and the mode flag, to the constant AsyncStorage key `case_form_draft`. It is not encrypted, scoped by user/tenant, versioned, or cleared on account change. A shared device or account switch can expose the previous draft.
2. **P1 — active UI bypasses the intended local data layer.** The screen performs direct `supabase.from('case_entries').insert/update` calls. `apps/mobile/lib/data-access.ts` does seal case fields with AEAD, but no visible screen import was found for that layer. Do not call field encryption an end-to-end property until the actual submit, edit, restore, display, sync, export, and delete paths are traced and tested.
3. **P1 — local key lifecycle is incomplete.** `apps/mobile/lib/db/encryption-key.ts` stores one per-install key (`elogbook.db.encryption_key.v1`) and caches it for the process lifetime. There is no account/tenant binding, rotation protocol, secure wipe on logout/device transfer, recovery policy, or evidence that the native SQLite adapter is SQLCipher. The database adapter in `apps/mobile/lib/db/database.ts` is a normal Watermelon SQLiteAdapter; its comments must not be treated as proof of SQLCipher.
4. **P1 — offline queue can lose or misroute work.** `apps/mobile/lib/offline-queue.ts` uses one global key, read-modify-write AsyncStorage operations, and no user/tenant namespace. Queue items have a generated local ID but the encrypted case payload is inserted without using that ID as an idempotency key. A concurrent enqueue can be overwritten by a flush; a duplicate retry can create duplicate server rows; non-network Supabase errors are dropped as permanent failures; and logout does not dispose or quarantine another account's queue.
5. **P1 — sync truth is inconsistent.** `apps/mobile/lib/sync.ts` explicitly disables Watermelon full sync and only flushes the light queue. The separate `lib/sync/engine.ts` and `lib/sync/remote.ts` have cursor, tenant, error, and conflict concerns but are not the active path. Never expand offline features until one path is selected and its invariants are exercised with process death, retry, clock ties, duplicate delivery, deletion, revocation, and account switching.
6. **P1 — client role metadata is presentation input.** `apps/mobile/lib/auth-guard.ts:getRoleFromAuth` reads role from `user.user_metadata` and tenant/profile IDs from app metadata, while its comment promises a profile fallback that the function does not implement. Use this only for display hints. Every capability and data query must be enforced by current server claims/RLS and must handle suspension, token expiry, MFA step-up, and tenant changes.
7. **P1 — no native release proof.** `apps/mobile/app.json` has Android camera/biometric and broad storage-related permissions in generated/native configuration, `allowBackup` is enabled in the generated manifest, and release signing/R8/backup rules are not proven from a final artifact. The source app config and generated Android tree must be reconciled, then an actual signed Android and iOS artifact must be inspected.
8. **P1 — CI can report a successful mobile build after failure.** `.github/workflows/deploy-mobile.yml` and `.github/workflows/cd.yml` run `eas build --no-wait ... || echo ...`, do not wait for a completed artifact, do not verify its provenance, and cover Android only. The workflow installs with `--no-frozen-lockfile`. The root `app.json` is only `{ "expo": {} }`, while the real config is under `apps/mobile`; make the EAS project directory explicit and fail closed.
9. **P2 — auth/session lifecycle is thin.** The root guard checks session presence, but role/profile/status/MFA policy is not refreshed as a capability contract. Sign-out clears the sync service listeners but does not demonstrate local database, draft, queue, cache, screenshots, notifications, and Sentry context disposal.
10. **P2 — privacy-safe error and telemetry review is incomplete.** Error boundaries capture component stacks and several paths log errors. Establish a field-redaction contract and prove that patient values, access tokens, URLs with query secrets, and encrypted/plaintext drafts never reach logs, Sentry, analytics, crash breadcrumbs, or notification previews.

### Enterprise/backend findings carried forward

- `apps/ops/src/jobs.ts` is a memory journal/state machine and explicitly has no transport, process execution, Docker executor, durable lease, or crash recovery. This is an honest bounded core, not the VPS installer/updater.
- `apps/web/app/api/update/execute/route.ts` intentionally returns unavailable/production-disabled. The update button cannot be advertised as an executable updater.
- Platform/editorial publication performs read-then-independent writes. `apps/web/app/api/platform/pages/[id]/publish/route.ts:46-81` can allow concurrent publishers and can leave pointer/status/revision disagreement. The tenant branding route updates live configuration before its revision insert. Both require one transactional RPC or conditional CAS with mandatory version, audit, and failure tests.
- The homepage remains hardcoded (`apps/web/app/page.tsx`); `/pub/[slug]` is a separate renderer and is fixed to `en`. Whole-system landing-page control, preview, locale, accessibility, and tenant routing remain unfinished.
- Prior-plan evidence still records blocked gates. T00 documents, `LAUNCH_SCOPE.md`, `apps/mobile/PRODUCTION_CHECKLIST.md`, and T27/T28 evidence contain contradictory readiness language. Reconcile the requirement ledger before changing labels.
- The migration history contains many legacy `get_user_role() = 'admin'` broad grants, while the new platform-admin model is narrower. The final replay must prove every surviving table, view, RPC, secret view, and tenant-setting path against a tenant admin, platform admin, suspended user, and cross-tenant identifier. A grep hit in an old migration is not proof of a live vulnerability, and a reconciler migration is not proof until a fresh database and upgrade database are tested.
- Prior-plan gaps remain: operation-specific AAL2/step-up, public-config same-digest convergence, one authoritative migration history, encrypted off-host backups and restore drills, signed release catalog/revocation, real provisioning/execution, atomic publication, and complete qualification G0/G3/G4/G5/G7/G8.

## Release gates

No production or store release may be marked qualified until all applicable gates pass with stored artifacts and owner sign-off:

| Gate | Required evidence | Fail condition |
|---|---|---|
| G-M0 scope | requirement → implementation → test → artifact ledger; contradictory docs removed or marked historical | any “production/enterprise ready” claim lacks an artifact |
| G-M1 build | reproducible Android and iOS builds from clean checkout, frozen lockfile, pinned Expo/EAS tooling, SBOM, source commit, config hash | a build can be reported successful without a completed artifact |
| G-M2 identity | device tests for sign-in, expiry, refresh, suspension, MFA step-up, tenant switch, sign-out, reinstall, clock skew | client metadata grants access or old tenant data survives switch |
| G-M3 privacy | draft, queue, DB, logs, screenshots, notifications, backups, exports and crash reports inspected with synthetic identifiable fixtures | plaintext PHI or tokens remain outside an approved boundary |
| G-M4 policy | both modes selected by tenant admin, capped by super-admin/install policy, enforced by insert/update/export/sync/edge paths and tested through REST/RPC/RLS | UI toggle changes mode without server refusal/audit |
| G-M5 sync | deterministic idempotency, per-account namespace, durable queue, retry taxonomy, conflict/deletion semantics, process-death and revocation tests | duplicate/lost/misrouted submissions or silent error drops |
| G-M6 clinical UX | actual-device resident capture, edit, submit, approval, evaluation, attachment and accessibility flows on supported OS/device matrix | only mocked screens or happy-path browser tests |
| G-M7 performance | cold start, warm start, first interactive, case-list query, large form, sync battery/network and memory budgets with traces | a performance claim has no measured baseline and threshold |
| G-M8 operations | installer, updater, backup/restore, rollback, signing/revocation, outage and incident runbooks exercised on disposable VPS and upgrade DB | button only changes local state or runs unreviewed shell/Docker |
| G-M9 release | staged rollout, crash/error thresholds, privacy-redacted telemetry, kill switch, rollback and human approval | automated CI is the only release authority |

## Mobile-first implementation sequence

Each ticket below is intentionally small. A ticket closes only with code review, focused tests, an artifact link, and an updated ledger entry. If a prerequisite fails, stop and record the failure rather than widening scope.

### M0 — evidence and supported-path decision

1. Create `docs/upgrade/evidence/mobile/ledger.md` mapping every mobile claim to source lines, test name, artifact, date, and owner.
2. Choose either (a) direct-online + encrypted case queue as the first supported mobile release, or (b) full Watermelon sync. Keep dormant alternatives behind an explicit feature flag and remove duplicate writers after migration.
3. Define supported Expo/RN versions, Android/iOS minimum versions, device matrix, locale/RTL scope, accessibility target, and synthetic fixture policy. Record unresolved decisions as ADRs.

### M1 — identity, tenant and data-mode boundary

1. Replace role metadata as an authorization input with a server capability snapshot containing user, tenant, account status, current policy version, MFA/step-up state, and expiry. Refresh on foreground, 401/403, tenant switch, and sensitive action.
2. Add a single account-context object used by draft, queue, database, cache, telemetry, notifications, and sync. On sign-out or context change, stop workers, clear memory, wipe/quarantine old context data, and prove no old rows/drafts are queryable.
3. Add server tests for tenant admin and platform admin ceilings for both data modes, including direct REST and RPC calls, suspended tenants, stale JWT metadata, exports, attachments, AI inputs, and audit records.

### M2 — protect drafts and keys

1. Replace `case_form_draft` with an encrypted, authenticated, versioned envelope in a context-scoped store. Bind associated data to account, tenant, record, field purpose, and schema version. Never fall back to plaintext on decrypt failure.
2. Decide and document one native storage model: verified SQLCipher with a native key, or field/envelope encryption with an approved database boundary. Prove the decision in an Android/iOS artifact, including backup/restore behavior.
3. Add key generation, storage, rotation, invalidation, reinstall/device-transfer behavior, recovery, and secure deletion tests. Avoid promising recovery of an unrecoverable device key.
4. Route all PHI display/export through one decrypting adapter; audit every call site. Encrypted values must never be searchable or accidentally rendered as envelopes.

### M3 — durable offline queue

1. Define an append-only queue schema with stable client operation ID, account/tenant ID, table/action, schema version, ciphertext, integrity metadata, created/updated times, attempt count, and terminal state.
2. Make server insert/upsert idempotent on the client operation ID and return the canonical server ID. Separate transient network/5xx, auth/policy, validation, conflict, and tamper errors; never drop policy or unknown errors silently.
3. Serialize queue mutations or use a transactional native store; test enqueue during flush, crash between server response and local delete, duplicate delivery, clock ties, full storage, corrupt item, and logout during flush.
4. Add user-visible pending/failed/conflict states with safe recovery. Do not retry a revoked or disallowed identifiable record indefinitely.

### M4 — clinical workflows and mobile UX

1. Build actual-device journeys for resident case capture, autosave/restore, edit, submit, supervisor approval/rejection, evaluations, duty hours, milestones, analytics, and AI insight disclosure.
2. Preserve the Apple Health-inspired identity while simplifying hierarchy and touch targets: one primary action per screen, clear offline/policy status, reduced modal stacking, accessible labels, Dynamic Type, VoiceOver/TalkBack, contrast, RTL and localization.
3. Add safe attachment handling: MIME/size/content validation, encrypted temporary files, upload resumability, retention/deletion, and no URI/token leakage.
4. Keep clinical copy and mode explanations understandable to a resident and tenant administrator; do not expose implementation jargon in product flows.

### M5 — sync, reliability and observability

1. Implement one sync protocol with server cursor/version semantics, tombstones, pagination tie-breakers, tenant/account filtering, bounded retries, and explicit conflict policy. Use server time/version rather than timestamp-only cursors.
2. Test airplane mode, intermittent connectivity, process kill, OS background limits, low battery, time changes, token expiry, policy revocation, partial batch failure, and server upgrade.
3. Add redacted structured telemetry for queue depth, latency, retry class, conflict count, data mode, app version, and policy version. Add no patient values, tokens, raw URLs, or form payloads.

### M6 — performance and accessibility budget

1. Measure cold/warm start, time to interactive, first case list, large-form typing, memory, battery, and sync bytes on low/mid/high reference devices. Set budgets before optimization.
2. Fix one measured bottleneck per change: avoid broad memoization or speculative caching. Use virtualized lists, bounded queries, deferred noncritical work, and image/file limits only where traces show need.
3. Run accessibility automation plus manual TalkBack/VoiceOver and keyboard/switch checks. Store screenshots/video and screen-reader notes as evidence.

### M7 — native build and release integrity

1. Make the mobile project directory explicit for Expo/EAS; use frozen installs, pinned CLI versions, and a completed-build wait. Remove `|| echo` success masking. Build Android and iOS in CI on pull requests and protected release branches as appropriate.
2. Inject signing credentials through the CI secret store; verify signing certificate, bundle/application ID, runtime version, permissions, backup rules, network security, ATS, debug flags, source maps, and R8/minification from the produced artifact.
3. Generate SBOM/provenance and scan dependencies. Define update compatibility and staged rollout/rollback. Never test a store-signed build with real patient data.

### M8 — close enterprise carry-forward

1. Implement durable ops journal/executor with leases, authorization, idempotency, cancellation, crash recovery, audit, and isolated Docker/VPS transport. Rehearse fresh install, upgrade, rollback, backup restore, and outage on disposable infrastructure.
2. Make update and setup UI call those guarded operations, display honest unavailable/blocked states, and require explicit human approval for irreversible steps.
3. Replace non-atomic theme/editorial publication with transactional version/CAS operations and integrate tenant-controlled landing pages, preview, locale and accessibility.
4. Reconcile all RLS/secret views/RPCs in fresh and upgrade databases. Prove platform admin, tenant admin, suspended user, stale claims, cross-tenant IDs, and both data modes.
5. Refresh T20–T28 evidence and keep NO-GO until every gate has reproducible evidence. Do not convert `PRODUCTION_CHECKLIST.md` check marks into certification without artifacts.

## Small-model operating rules

- Start every task by reading the relevant ledger row and call graph. Ask for clarification only when a product decision is genuinely missing; otherwise make the smallest reversible change.
- Do not edit migrations by deleting history. Add a deterministic convergence migration and test both fresh replay and upgrade replay.
- Do not use `get_user_metadata`, local role strings, hidden flags, or UI-only mode checks for authorization.
- Do not claim SQLCipher, encryption at rest, offline sync, native build success, WCAG, HIPAA, enterprise readiness, or production certification without the corresponding artifact.
- Never log or paste real patient data, secrets, tokens, signing keys, or production URLs with credentials. Use synthetic fixtures and disposable projects.
- For every failure, preserve the failing command/output and add a regression test before retrying. Do not loosen a gate to make CI green.
- Run focused tests first, then the affected package gate, then the full required gate. Record environmental failures separately from product failures.
- Keep the existing visual identity and design tokens unless a measured accessibility or clinical workflow issue requires a change. Validate mobile and web theme parity after each UI change.

## Questions for Claude's debate

1. Is the first mobile release safer as online-only with a small encrypted retry queue, or does the product require full offline identifiable records? What key recovery and revocation contract makes that choice honest?
2. Should the dormant WatermelonDB path be completed or removed in favor of the direct-online/queue path? Which measurable requirement justifies the added complexity?
3. Are the proposed G-M0–G-M9 artifacts sufficient to call a release qualified, and which independent reviewer/owner signs each security and clinical gate?
4. Which legacy admin grants survive the final migration replay, and what direct REST/RPC test proves that tenant admins cannot cross the new platform-admin boundary?
5. What is the minimum transactional contract for theme and editorial publication that guarantees pointer, revision, audit and cache invalidation converge under concurrent publishers?
6. Which mobile performance budgets reflect real resident devices and network conditions, and what evidence should block a release when those budgets regress?

## Reference material to verify during implementation

- Expo SecureStore and platform backup/keychain behavior: https://docs.expo.dev/versions/latest/sdk/securestore/
- Expo monorepo/EAS build configuration: https://docs.expo.dev/build-reference/build-with-monorepos/
- OWASP MASVS storage, authentication and network controls: https://mas.owasp.org/MASVS/
- Supabase Row Level Security guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
- Existing project evidence: `ELOGBOOK_MASTER_UPGRADE_PLAN.md`, `docs/upgrade/evidence/T27/gate-matrix.md`, `docs/upgrade/evidence/T28/rollout.md`, and `LAUNCH_SCOPE.md`.

**Current release decision:** NO-GO. This is a review and implementation plan, not a production certification.
