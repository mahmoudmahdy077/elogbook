# Mobile evidence ledger (M0) — SUPERSEDED by `ledger.yaml`

The machine-checked source of truth is
[`ledger.yaml`](./ledger.yaml) (statuses `wired|tested|artifact-verified|blocked`,
enforced by `scripts/check-mobile-ledger.mjs` in CI). This markdown file is
retained as historical context for the pre-qualification implementation cycle
and must not be cited as qualification evidence.


**Date:** 2026-09-09
**Commit:** `165f9ae` + local-first implementation (uncommitted working tree 2026-09-09)
**Owner:** mobile platform
**Decision:** NO-GO for production/store until G-M0–G-M9 pass with artifacts.
**Supported path (user decision 2026-09-09):** local-first — write to on-device WatermelonDB/AEAD store first, then sync to Supabase cloud when online. Direct-online Supabase calls from screens are legacy and must be migrated behind this path. Dormant duplicate writers quarantined after migration.

## Implementation evidence 2026-09-09 (this cycle)

| Ticket | Change | Tests |
|---|---|---|
| M1 | `lib/account-context.ts` scoped keys + change listeners; `lib/capability.ts` server snapshot (profiles + tenant policy, no metadata fallback, freshness + step-up); `sync.ts` + `sync-service.ts` set/clear scope on sign-in/out | `account-context.test.ts` (5), `capability.test.ts` (4) |
| M2 | `lib/draft-store.ts` encrypted v1 envelope, scope-bound, no plaintext fallback; `encryption-key.ts` rotate/invalidate; `log-case.tsx` migrated off `case_form_draft` + legacy wipe | `draft-store.test.ts` (5), `key-lifecycle.test.ts` (3) |
| M3 | `lib/durable-queue.ts` per-account outbox, stable opId → `client_operation_id`, mutex, taxonomy (transient retry / quarantine), crash-recovery, switch isolation; migration `20260909000000_durable_queue_idempotency.sql` unique op index on `case_entries` | `durable-queue.test.ts` (6) |
| M4 | `lib/attachments.ts` MIME/size/traversal/token validation + URI redaction | `attachments.test.ts` (4) |
| M5 | `lib/feature-flags.ts` `LOCAL_FIRST_SYNC` (default true); `lib/telemetry.ts` allowlist scrub; `sync.ts initSync` durable flush + telemetry + legacy migration | `telemetry.test.ts` (2), engine/incremental/retry suites (32) |
| M6 | `docs/.../perf-budgets.md` budgets; `lib/a11y.ts` label audit + offline copy | `a11y-labels.test.ts` (2) |
| M7 | `deploy-mobile.yml` frozen + pinned EAS 14.0.0 + explicit `apps/mobile` dir + `--wait` fail-closed + Android & iOS + provenance upload; `cd.yml` same (frozen, fail-closed, iOS added) | CI config (no unit test; verify on next PR run) |
| M8 | `publish_site_page()` RPC (`20260909000001_atomic_publish.sql`) + platform + tenant routes cut to atomic CAS; `jobs.ts tryTakeoverStale` lease fencing | web `pages.test.ts` + `tenant-pages.test.ts` (10), ops `jobs.test.ts` (11) |

Verification 2026-09-09: `tsc --noEmit` mobile/ops/web pass; mobile eslint pass (1 warning fixed); mobile vitest 44 files / 340 passed / 6 skipped (was 36/309/6); ops 52 passed (was 51). Web publish suites 10 passed. Full web aggregate gate still UNRESOLVED (prior worker timeouts) — rerun in CI.


## Supported matrix (M0-3)

- Expo SDK ~56, RN 0.85.3, React 19.2.3, EAS CLI >=14.0.0, Node 22.14.0, pnpm 9.15.0
- Android: `package com.elogbook.app`, `versionCode 30`, min via `expo-build-properties` iOS deploymentTarget 16.4; Android min TBD in ADR-001 (measure on low/mid/high refs before locking)
- Device matrix TBD: low/mid/high Android + iPhone with Dynamic Type / TalkBack / VoiceOver / RTL — record traces in G-M6/G-M7
- Locale/RTL scope: `i18n/`, `locales/` exist; `/pub/[slug]` fixed to `en` (gap — see M8)
- Synthetic fixtures only for privacy tests. Never real PHI, tokens, signing keys, prod URLs with credentials.

## Claim map

| # | Claim | Source lines | Test / artifact | Status 2026-09-09 |
|---|---|---|---|---|
| P1-draft | `case_form_draft` plaintext, global key, unscoped, includes MRN/DOB/fieldValues/mode | `apps/mobile/app/(tabs)/log-case.tsx:85-102` autosave, `:281-298` restore, `:477` clear | `apps/mobile/lib/__tests__/storage-json.test.ts` (no PHI redaction proof); manual read | FAIL — must fix in M2 via encrypted context-scoped envelope, no plaintext fallback |
| P1-bypass | Active UI does direct `supabase.from('case_entries').insert/update`; `lib/data-access.ts` AEAD not imported by screens | `log-case.tsx:19` supabase import, direct calls ~300-500; `lib/data-access.ts:1-48` seal/open exists but unused by screen | grep `from.*data-access` in `app/` = 0 hits | FAIL — M5 wires screens to local-first repo |
| P1-key | One per-install key `elogbook.db.encryption_key.v1`, process-cache, no rotation/wipe/binding; adapter is plain SQLite, not proven SQLCipher | `lib/db/encryption-key.ts:4,28-39`, `lib/db/database.ts:36-43` `new SQLiteAdapter({jsi:true})` | `offline-queue.test.ts` uses key; no rotation/wipe test | FAIL — M2 documents native model + adds rotation/invalidation/reinstall tests |
| P1-queue | Global key `offline_case_queue_v2`, RMW, no namespace, no idempotency key on insert, transient-only retry, drops policy/unknown as permanent, no logout quarantine | `lib/offline-queue.ts:16,53-79,100-140` | `lib/__tests__/offline-queue.test.ts` (happy-path flush) | FAIL — M3 append-only schema + op ID + taxonomy + mutex |
| P1-sync | Watermelon full-sync disabled (`UXM-001`), light queue only; `sync/engine.ts` + `remote.ts` dormant | `lib/sync.ts:124-162` warn stubs, `:164-183` flush-only `initSync` | `lib/sync/__tests__/engine.test.ts`, `lib/__tests__/sync-incremental.test.ts`, `sync.push.test.ts` (6 skipped) | FAIL — M5 selects local-first engine as active path, exercises death/retry/ties/duplicates/deletion/revocation/switch |
| P1-role | `getRoleFromAuth` reads `user_metadata.role`, `app_metadata.tenant/profile`, comment promises profile fallback it does not implement | `lib/auth-guard.ts:12-34` | `lib/__tests__/auth-guard.test.ts` | FAIL — M1 server capability snapshot, display-only metadata |
| P1-build | `app.json` camera/biometric perms, `allowBackup` in generated manifest, signing/R8/backup rules unproven; root `app.json` is `{expo:{}}`, real config under `apps/mobile` | `apps/mobile/app.json:34-38,61-94`, `app.json:1-3`, `apps/mobile/android/` generated | `lib/__tests__/network-security-config.test.ts` passes when XML absent (not release proof) | FAIL — M7 explicit project dir + frozen + wait + Android+iOS + artifact inspection |
| P1-ci | `eas build --no-wait ... \|\| echo` masks failure, Android-only, `--no-frozen-lockfile` | `.github/workflows/deploy-mobile.yml:34,51,69,77`, `.github/workflows/cd.yml:44,118,126` | CI logs (no artifact provenance) | FAIL — M7 fail-closed |
| P2-auth | Root guard checks session presence only; sign-out clears listeners but not DB/draft/queue/cache/screenshots/notifications/Sentry | `lib/sync.ts:227-255` cleanup only listeners, `lib/auth-guard.ts:36-64` | manual | FAIL — M1 account-context + wipe proof |
| P2-tele | Error boundaries + console/Sentry paths lack field-redaction contract | `lib/sentry.ts`, `sentry.config.ts`, `components/*Boundary*` | manual grep for `patientMrn` in logs | FAIL — M5 redacted telemetry contract |

## Verification baseline at this commit

- `pnpm typecheck`: 6 projects pass (per review; re-run in Final verification)
- `pnpm lint:all`: pass incl. mobile ESLint
- `pnpm --filter @elogbook/mobile exec vitest run --maxWorkers=1`: 36 files, 309 passed, 6 skipped (sync.push skipped, network-security-config vacuous-pass)
- Aggregate gate: ops 51 pass; web 426 pass/1 skip but 3 worker-start timeouts; one-worker web rerun unfinished — treat as FAIL/UNRESOLVED until CI repro
- Fresh + upgrade DB replay: `v_pid` guard + reconciler present at `165f9ae`, but final RLS/secret/RPC proof across tenant-admin / platform-admin / suspended / cross-tenant / both modes still required (M8)

## Gate ledger (G-M0–G-M9)

See plan § Release gates. No gate may be marked qualified without stored artifact + owner sign-off. Current: all NO-GO.

- G-M0 scope: this ledger + ADR-001 + removal/marking of contradictory readiness language (T00, LAUNCH_SCOPE.md, PRODUCTION_CHECKLIST.md, T27/T28) — CODE LANDED, docs reconcile still pending
- G-M1 build: reproducible Android+iOS, frozen, pinned, SBOM, commit+config hash — CONFIG LANDED, needs CI run artifact + SBOM/provenance + signed artifact inspection
- G-M2 identity: device tests sign-in/expiry/refresh/suspension/MFA/switch/sign-out/reinstall/skew — CODE LANDED (snapshot + scope + wipe), device tests NOT MET
- G-M3 privacy: synthetic identifiable fixture inspection of draft/queue/DB/logs/screenshots/notifications/backups/exports/crashes — CODE LANDED (envelope + redaction), artifact inspection NOT MET
- G-M4 policy: both modes via tenant-admin capped by super-admin/install, enforced insert/update/export/sync/edge + REST/RPC/RLS tests — server tests still required
- G-M5 sync: idempotency, namespace, durable queue, taxonomy, conflict/deletion, death/revocation tests — CODE LANDED, Watermelon repo adapter + process-death/revocation device tests NOT MET
- G-M6 clinical UX: actual-device journeys + a11y matrix — contract + budgets LANDED, device journeys NOT MET
- G-M7 performance: cold/warm/interactive/list/form/battery/memory budgets + traces — budgets LANDED, traces NOT MET
- G-M8 operations: installer/updater/backup/restore/rollback/signing/revocation/outage on disposable VPS + upgrade DB — publish atomicity + lease fencing LANDED, VPS rehearsal + durable transport NOT MET
- G-M9 release: staged rollout, thresholds, redacted telemetry, kill-switch, rollback, human approval — NOT MET

**Release decision stays NO-GO.** Code closes the P1 data-path gaps; qualification still needs device artifacts, VPS rehearsal, full RLS reconcile, and CI green.

## Dormant paths (quarantine log)

- `lib/sync.ts` Watermelon stubs (`UXM-001`) — superseded by local-first engine wiring in M5; keep file as facade, remove stub warnings after cutover
- `lib/offline-queue.ts` v2 global queue — superseded by M3 namespaced durable queue; keep read-migration for 1 release, then delete
- `app/(tabs)/log-case.tsx` direct Supabase writes — superseded by `data-access.ts` local-first writes + engine push; remove after M5 screen migration
- `lib/sync/in-memory-repo.ts` — test-only, keep
- Duplicate writers must not coexist past M5; feature flag `LOCAL_FIRST_SYNC` gates cutover

## Next (M1–M8 order)

M1 capability + account-context → M2 draft envelope + keys → M3 durable queue → M5 engine cutover (local-first) → M4 journeys/attachments → M6 perf/a11y → M7 native/CI → M8 enterprise carry-forward. Small tickets, one verified gap each, ledger row updated per ticket.
