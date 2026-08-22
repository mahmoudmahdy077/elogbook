# E-Logbook Production Launch Upgrade Plan (v3)

> **Audience:** AI coding agents (large and small LLMs) and human engineers.
> **Goal:** Harden the existing E-Logbook system to a safe, correct production launch for individual medical residents + supervisors, then add the chosen launch features (light offline queue, push notifications, AI clinical reflection GA). Institutions/enterprise (SSO/SCIM/webhooks billing) are explicitly **deferred** — do not build them.
> **Predecessors:** `docs/ANALYSIS_AND_UPGRADE_PLAN.md` (v1, done), `docs/ULTIMATE_UPGRADE_PLAN.md` (v2, mostly done), `analysis/UPGRADE_PLAN.md` (enterprise phases 0–7, done). This document supersedes them for launch scope.

**This document contains two parts:**

1. **Part 1 — Code-by-code audit** (security, database, performance, web, mobile). Every finding has an ID and points to the task that fixes it. If a task changes a finding's code, the finding ID is referenced in that task.
2. **Part 2 — Implementation plan.** Numbered phases and tasks. Each task is self-contained: exact file paths, exact code, exact commands, expected output, and a commit message. Tasks must be executed **in order** — later tasks depend on earlier ones. There are no placeholders.

---

## 1. System Overview

| Layer | Technology |
|---|---|
| Web | Next.js 16 (App Router, RSC), React 19, Tailwind CSS v4, TypeScript strict, pnpm monorepo (Turborepo) |
| Mobile | Expo SDK 56 (RN 0.85), expo-router, NativeWind, Supabase JS, Vitest |
| Backend | Supabase: Postgres 17, 89+ SQL migrations, RLS everywhere, Edge Functions (Deno 2) |
| Shared | `packages/shared` (`@elogbook/shared`): types, Zod schemas, design tokens, dual-platform components |
| Auth | Supabase Auth (email/password + magic link), JWT `app_metadata` carries `tenant_id` + `user_role`; MFA (TOTP) required for director/institution_admin/admin |
| Data model | Multi-tenant: every tenant-scoped table has `tenant_id` + FORCE RLS. Roles: `admin → institution_admin → director → supervisor → resident` |
| Billing | Stripe via edge functions `create-checkout`, `payment-webhook`, `create-portal-session`, `list-invoices` |
| Monitoring | Sentry (PHI-scrubbed), PostHog (consent-gated), structured logger with PHI-key redaction |
| CI/CD | GitHub Actions: typecheck, lint, Vitest, pgTAP (`supabase db test`), Deno tests, build, Trivy, CodeQL, Semgrep, ZAP DAST, daily backups |

**Key existing flows:**
- Case lifecycle: draft → pending → approved/rejected (DB RPCs `approve_case`/`reject_case` with `FOR UPDATE` row locks).
- Tenant identity: `get_tenant_id()` / `get_user_role()` read JWT `app_metadata` (fixed in migration `00100_fix_jwt_claim_paths.sql`).
- Secrets at rest: `api_key_enc` / `secret_key_enc` / `webhook_secret_enc` columns encrypted with `pgp_sym_encrypt` + `decrypt_with_version()`; decrypted only through the `secret_*` views.
- Audit: append-only `audit_logs` (REVOKE UPDATE/DELETE + reject triggers), PHI-redacted case audit, secret-redacted config audit.

---

## 2. Rules for Implementers (READ FIRST)

1. **Order matters.** Phases and tasks are sequential. Never skip ahead; each task's "Verify" block must pass before the next task starts.
2. **TDD.** Every fix gets a failing test first, then the code. The "Verify" block states the exact command and expected result.
3. **Migrations are forward-only.** Create new files; never edit an existing migration (see `docs/operations/migration-policy.md`). Migration files in this plan use 14-digit timestamp prefixes, which `scripts/lint-migrations.mjs` accepts.
4. **Exact code.** Code blocks contain complete final code. Copy them verbatim. If a code block says "confirm the current text first", run the given grep command and only proceed once output matches.
5. **No contradictions.** All names used in this plan are defined in the Name Registry (§8). If two tasks reference the same function/column/table, they reference the same definition. Do not rename anything that another task references.
6. **Verification commands (run from repo root `G:\elogbook`):**
   - `pnpm typecheck` — all packages typecheck (expect: no errors)
   - `pnpm lint:all` — ESLint web + mobile (expect: no errors)
   - `pnpm test` — Vitest web + mobile (expect: all pass)
   - `supabase db reset` — apply migrations + seed locally (expect: no errors)
   - `pnpm test:db` — pgTAP tests (expect: all plans pass)
   - `pnpm build:web` — production web build (expect: success)
   - `pnpm --filter @elogbook/mobile expo prebuild --clean` — native config validation (expect: success)
   - `deno test` inside a function dir — edge function tests
7. **Commit style** (match repo history): `fix(db): ...`, `fix(web): ...`, `feat(mobile): ...`, `test(db): ...`. One commit per task.
8. **Do not touch** (out of scope for launch): SSO/SCIM implementation, full WatermelonDB offline sync engine, `ai-quality` / `ai-gap-analysis` GA, benchmarking UI, institutions-first billing (institution_billing table), white-labeling, `scripts/patch-renderer-version.js` hack (note-only), root-level stub `app.json`/`eas.json`.

---

## 3. Audit Part A — Security Findings

### S1 (CRITICAL) — Secret views leak decrypted API keys to any tenant member
`supabase/migrations/00053_encrypt_secrets.sql:130-157`, `00062_key_rotation.sql:233-253`, `00074_tenant_webhooks_encrypt.sql:142-156`.

`secret_ai_config`, `secret_payment_gateway_config`, `secret_tenant_webhooks` are `security_barrier` views owned by postgres (definer semantics — base-table RLS is bypassed). Their only filter is `tenant_id = get_tenant_id() OR get_user_role() = 'admin'`. **Any authenticated user (including residents) can SELECT their tenant's decrypted OpenAI/Stripe API keys and webhook signing secrets.** The 00053 comment claiming RLS blocks this is incorrect; `security_barrier` only prevents function-based leaks.
→ Fixed by **Task 1.1**.

### S2 (CRITICAL) — Tenant-scoped RPCs accept caller-supplied tenant/role with no verification
- `get_dashboard_data(p_tenant_id, p_resident_id, p_role)` (`00094_dashboard_rpc.sql:20-93`): any authenticated user can pass any tenant UUID and get that tenant's stats/recent cases; `p_role` is caller-supplied, so a resident can pass `p_role='director'` to see tenant-wide data.
- `get_template_usage_counts(p_tenant_id, p_resident_id)` (`20260721220003_template_usage_rpc.sql`): no auth check at all; cross-tenant enumeration.
- `check_case_quota(p_tenant_id)` (`20260721210000_case_quota_rpc.sql`): no auth check; **also has no REVOKE from PUBLIC — default PUBLIC EXECUTE grants it to anon**.
→ Fixed by **Task 1.2**.

### S3 (CRITICAL) — Caller-agnostic RLS on duty_periods and faculty_evaluations
`00069_duty_tracking.sql:20-22` + `00071_fix_duty_periods_rls.sql:13-25`: USING clause is `tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id)` — it never references the caller. Any authenticated user can read all duty rows of all tenants. The 00071 WITH CHECK compares `profiles.id = auth.uid()` — profiles.id is a profile PK, `auth.uid()` is an auth user id; they are different UUIDs, so every INSERT from the app is blocked (or, in a UUID collision, cross-tenant writes). Same pattern in `faculty_evaluations` (`00070`+`00072`).
→ Fixed by **Task 1.3**.

### S4 (HIGH) — Broken audit triggers
- `trg_audit_institutions` (`00056_audit_triggers_and_cron.sql:67`): `audit_table_change()` inserts `COALESCE(NEW.tenant_id, OLD.tenant_id)` — `institutions` has no `tenant_id` column → NULL violates `audit_logs.tenant_id NOT NULL` → every institutions INSERT/UPDATE/DELETE fails.
- `audit_program_goals()` (`00067_audit_favorites.sql:4-23`): writes `NEW.director_id` (a `profiles.id`) into `audit_logs.user_id` (FK → `auth.users.id`) → FK violation on every program_goals mutation; the DELETE branch reads `NEW` which is unassigned in AFTER DELETE → NULL tenant_id violation.
→ Fixed by **Task 1.4**.

### S5 (HIGH) — `notifications_insert_tenant` policy allows spoofing notifications
`00083_onboarding_steps.sql:59-61`: any authenticated user can INSERT a notifications row for **any** `user_id` in their own tenant (impersonation/spam vector for the in-app bell).
→ Fixed by **Task 1.4** (second policy fix in same migration).

### S6 (HIGH) — Payment webhook tenant resolution is broken
`supabase/functions/payment-webhook/index.ts:12-127`:
- `readTenantSlug()` queries `tenants.stripe_account_id` — **that column does not exist** in any migration. With a `Stripe-Account` header, resolution always fails → 401.
- The `metadata.tenant_slug` fallback never matches: `create-checkout` sets `metadata: { tenant_id, plan_id }` (`create-checkout/index.ts:142`), not `tenant_slug`.
→ Fixed by **Task 2.1**.

### S7 (HIGH) — `list-invoices` has no customer ownership check
`supabase/functions/list-invoices/index.ts:18-68`: any authenticated user can pass any Stripe `customer_id` and list that customer's invoices (cross-tenant data exposure).
→ Fixed by **Task 2.2**.

### S8 (HIGH) — AI quota is check-only, never consumed
`supabase/functions/ai-insights/index.ts:241-267`: quota check is a read-only SELECT; `consume_ai_quota()` (atomic, `00054_ai_quota_atomic_increment.sql:31-86`) is never called anywhere. Quota is raceable and never increments.
→ Fixed by **Task 7.1**.

### S9 (HIGH) — Edge-function audit writes silently fail (audit gap)
`generate-pdf/index.ts:195-207` and `webads-export/index.ts:203-217` INSERT into `audit_logs` using the **user-token** client. The audit_logs INSERT policy for authenticated is `WITH CHECK (false)` (`00012_rls_security_fixes.sql:10-15`). The inserts fail silently → PDF/WebADS exports leave **no audit trail** (a compliance finding in itself).
→ Fixed by **Task 2.4**.

### S10 (MEDIUM) — CSV injection + unescaped HTML in exports
- `apps/web/app/api/[tenant]/audit/export/route.ts:205-232` (`generateAuditHtml`): interpolates audit values into HTML **without escaping** (contrast `compliance/export/route.ts:291-303` which escapes). XSS if any audit value contains markup.
- The 4 CSV report routes (`apps/web/app/api/[tenant]/reports/*.csv/route.ts`) and the audit page route interpolate values without handling `= + - @` formula prefixes (CSV injection).
→ Fixed by **Task 3.1** (shared `lib/csv.ts`) and **Task 3.2** (HTML escaping).

### S11 (MEDIUM) — `/api/contact` is a no-op stub that returns fake success
`apps/web/app/api/contact/route.ts:1-8`: returns `{success: true}` and stores nothing. The public contact page's messages are silently dropped. Also unauthenticated + un-rate-limited.
→ Fixed by **Task 3.3**.

### S12 (MEDIUM) — `enforce_data_retention()` v3 is broken; nightly cron errors every run
`00065_compliance_audit_gaps.sql:58-105`: v3 iterates `data_retention_policies` — a table that **does not exist** — and inserts an audit row with `resource_id = NULL` (violates NOT NULL). The cron job `enforce-data-retention` (`00056:74-101`) runs it daily at 03:00 UTC and will fail every run.
→ Fixed by **Task 1.5** (v4 rewrite).

### S13 (LOW) — `ai-gap-analysis` wildcard CORS
`supabase/functions/ai-gap-analysis/index.ts:16-19`: local `corsHeaders` with `Access-Control-Allow-Origin: *`. (Bearer auth mitigates cookie-based attacks, but tighten to the shared allow-list.)
→ Fixed by **Task 2.5**.

### S14 (LOW) — Mobile de-identified case shows raw MRN labeled "Hash"
`apps/mobile/app/(tabs)/my-cases.tsx:64`: `Hash: ${item.patient_mrn?.slice(0, 12)}` renders the first 12 characters of the **raw MRN** (PHI leak in the UI, mislabeled). The query never selects `patient_hash`.
→ Fixed by **Task 5.2**.

### S15 (LOW) — `eas.json` hardcodes Supabase URL/anon key in git
`apps/mobile/eas.json`: all 3 profiles hardcode `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The anon key is publishable (client-safe), but hardcoding prevents per-environment rotation. Deferred to CI-secret management — **documented, not fixed in this plan** (see §12 Open Items).

---

## 4. Audit Part B — Database Correctness Findings

### D1 — `payments` status value violates CHECK
`payment-webhook/index.ts:333-339` inserts `status: 'succeeded'`; the CHECK (`00029`) allows only `pending/completed/failed/refunded/cancelled`. Every `invoice.paid` event errors.
→ Fixed by **Task 2.1**.

### D2 — `subscriptions` upsert targets a dropped UNIQUE constraint
`payment-webhook/index.ts:225-234` upserts `ON CONFLICT (tenant_id)`. `00055` dropped `UNIQUE(tenant_id)` (only a partial unique index on active statuses remains). Upsert errors on every `checkout.session.completed`.
→ Fixed by **Task 2.1**.

### D3 — `ai_config` admin read selects a dropped column
`apps/web/app/(authenticated)/[tenant]/admin/page.tsx:46-50` selects `encrypted_api_key` — dropped by `00053` (replaced by `api_key_enc`). The admin AI panel query fails.
→ Fixed by **Task 3.4**.

### D4 — `get_dashboard_data` signature uses caller-supplied `p_role` (see S2)

### D5 — `check_case_quota` / `enforce_case_quota` / `get_template_usage_counts` have no EXECUTE grants
Default PUBLIC EXECUTE. `check_case_quota` and `get_template_usage_counts` are SECURITY DEFINER with `search_path = public` (deviates from the `pg_catalog, public` convention of `00052`).
→ Fixed by **Task 1.2**.

### D6 — Seed drift
`seed.sql` template fields use `"name"` while `00005` uses `"key"`; feature sets differ. Not a launch blocker (templates render from `fields` JSONB), **documented only**.

### D7 — `tenant_storage_usage_mb` view exposes every tenant's slug + usage + quota
`00061_storage_quotas.sql:33-51` granted to all authenticated with no tenant filter. Low sensitivity (no PHI) but leaks competitor tenant counts. **Documented only** (fixing it requires reworking the storage quota UI; deferred).

### D8 — Demo credentials in git history
`00006_demo_accounts.sql` hardcodes a bcrypt hash; `00095_delete_demo_accounts_in_prod.sql` deletes them in prod. The shared password (`password123!`) must be treated as public. **Action:** rotate nothing (these are demo-only); never reuse this password elsewhere. Documented only.

### D9 — `config.toml` has no auth hardening
`supabase/config.toml` is 11 lines; JWT/session defaults apply. Session lifetime and password policy are platform defaults.
→ Fixed by **Task 8.4** (conservative auth settings with verification).

### D10 — Missing pgTAP coverage
Only 2 active test files (`p1_1b`, `p1_3`). No tests for secret-view gating, RPC tenant checks, duty/faculty RLS, audit triggers, retention, quota.
→ Every Task in Phase 1 adds its own pgTAP test file.

---

## 5. Audit Part C — Performance Findings

### P1 — Dashboard fetches all tenant cases to count per-resident (O(rows))
`apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx:167-172`: `.select('resident_id, status').limit(10000)` then JS aggregation. At scale this is the single biggest page cost.
→ Fixed by **Task 4.1** (move aggregation into `get_dashboard_data` SQL GROUP BY).

### P2 — Analytics fetches 12 months of full case rows + 10,000 approvals and aggregates in JS
`apps/web/app/(authenticated)/[tenant]/analytics/page.tsx:49-153`.
→ Fixed by **Task 4.2** (new `get_analytics_data` RPC, page becomes a thin wrapper).

### P3 — Reports page fetches up to 1,000 case rows and counts in JS
`apps/web/app/(authenticated)/[tenant]/reports/page.tsx:54-80`.
→ Fixed by **Task 4.3** (new `get_report_counts` RPC).

### P4 — Compliance PHI-inventory counts include soft-deleted rows
`apps/web/app/(authenticated)/[tenant]/compliance/page.tsx:129-144`: counts query `case_entries` without `deleted_at IS NULL` — overstated PHI inventory.
→ Fixed by **Task 4.4**.

### P5 — Dead modules inflate bundle / confuse maintenance
- `apps/web/lib/supabase/pagination.ts` (cursor pagination, unused; cases list uses offset pagination which is acceptable at launch scale).
- `apps/web/lib/performance.ts` (beacons to nonexistent `/api/metrics`).
- `apps/web/lib/notifications.ts` (unused; referenced a `push_tokens` table that does not exist — replaced in Phase 6).
- `apps/web/lib/sso.ts` (SSO login disabled).
- `apps/mobile/lib/analytics.ts`, `lib/performance.ts`, most of `lib/animations.tsx`, `components/AppleCard.tsx`, `theme/design-tokens.ts`, i18n module (unused).
→ **Cleanup in Task 8.6** (explicit list; only items listed there may be deleted).

### P6 — Sequential dependent queries on some pages
Case detail (entry → approvals) and new-case (subscription → quota) run sequentially. Minor at launch scale; **documented only**.

### P7 — `next.config.mjs` references uninstalled `@heroui/react`
`apps/web/next.config.mjs:26` — dead `optimizePackageImports` entry (build-time no-op, maintenance trap).
→ Fixed by **Task 3.5**.

---

## 6. Audit Part D — Web Bugs & Dead References

### W1 — Broken "View" link on evaluations page
`apps/web/app/(authenticated)/[tenant]/evaluations/page.tsx:276-281` links to `/${tenantSlug}/evaluations/${form.id}` — **no such route exists** (404).
→ Fixed by **Task 3.6**.

### W2 — `evaluate/resident/[id]` orphan page
`apps/web/app/(authenticated)/[tenant]/evaluate/resident/[id]/page.tsx` has no inbound links. Documented only (kept; linked by W1's replacement? No — W1 removes the dead link. Documented only).

### W3 — Sign-out / invite fall back to hardcoded `http://localhost:3000`
`auth/signout/route.ts` and admin invite route use `'http://localhost:3000'` when `NEXT_PUBLIC_SITE_URL` is unset. In prod Vercel this env is set; **documented only**.

### W4 — `dangerouslySetInnerHTML` usages
Only 2: nonce-protected theme script and static JSON-LD in `app/layout.tsx`. Acceptable; **documented only**.

### W5 — API error responses leak raw DB messages in some routes
E.g. `cases/[id]/submit/route.ts` and CSV routes return `error.message`. Low risk (authenticated caller, own tenant); to-user mapping exists (`lib/error-messages.ts`) but is not uniformly applied. **Documented only.**

### W6 — Design tokens duplicated (`globals.css` `@theme` vs `tailwind.config.ts` import from shared)
Drift risk. **Documented only** (fixing token unification is a design task outside launch scope).

### W7 — `tsconfig.tsbuildinfo` committed
`apps/web/tsconfig.tsbuildinfo` should be gitignored. → Fixed by **Task 8.6** (gitignore + rm).

### W8 — PWA `sw.js` cache name `elogbook-shell-v2` hardcoded
Documented only.

### W9 — Demo-credentials banner gated by `NEXT_PUBLIC_SHOW_DEMO_BANNER`
Works as intended. Documented only.

### W10 — `api/sso/check` always 503, `login/sso` says unavailable
Intended (SSO deferred). Documented only.

---

## 7. Audit Part E — Mobile Bugs & Dead Code

### M1 — `duty-hours.tsx` inserts `resident_id: undefined`
`apps/mobile/app/(tabs)/duty-hours.tsx:38-57`: profile query selects only `tenant_id`, then reads `(profile as unknown as {id: string}).id`. After Task 1.3's policy fix, this insert is also blocked by RLS. Must be fixed together.
→ Fixed by **Task 5.1**.

### M2 — `case-detail.tsx` calls `approve_case`/`reject_case` without `p_supervisor_id`
`apps/mobile/app/(tabs)/case-detail.tsx:135-141`: the RPC signature is `(p_entry_id UUID, p_supervisor_id UUID, p_comment TEXT DEFAULT NULL)` and `00048` requires `p_supervisor_id = auth.uid()`. Calling with only `p_entry_id`+`p_comment` fails to resolve the function → **mobile approve/reject is broken**.
→ Fixed by **Task 5.3** (also verify `approvals.tsx` in the same task).

### M3 — Login wipes biometric opt-in on every login
`apps/mobile/app/login.tsx:30-38` and `68-84`: `setBiometricPreference(false)` on session restore and fresh login — user preference is destroyed every time.
→ Fixed by **Task 5.4**.

### M4 — "Saved Offline" is fake
`apps/mobile/app/(tabs)/log-case.tsx:464-468` + `571-589`: on insert failure the app shows "Saved Offline — Will sync when online" but **persists nothing**. Misleading UX; data is lost.
→ Fixed by **Task 5.7** (real encrypted offline queue).

### M5 — `patient_hash` never computed on mobile
`generatePatientHash` imported (`log-case.tsx:23`) but never called; `caseData` contains no `patient_hash` (`log-case.tsx:414-425`). De-identified rows submit `patient_hash: ''` (line 368, validation-only path).
→ Fixed by **Task 5.6**.

### M6 — `profile.tsx` uses auth user id as profile id
`apps/mobile/app/(tabs)/profile.tsx:57`: `const profileId = user.id` — the auth id, not the `profiles.id` row id (contrast `index.tsx` which reads `app_metadata.profile_id`). Edit/duplicate flows that use this id break.
→ Fixed by **Task 5.5**.

### M7 — Root layout intentionally throws at startup
`apps/mobile/app/_layout.tsx:155`: `initDatabase().catch(console.error)` throws `OfflineStorageDisabledError` on **every** launch (expected-but-noisy error in Sentry/dev logs).
→ Fixed by **Task 5.8** (remove the call; keep `lib/db/*` files for future v2).

### M8 — `today-stats.ts` offline branch is a dead stub with misleading docstring
`apps/mobile/lib/today-stats.ts:15-16`: claims WatermelonDB fallback; returns empty stats. Documented only (offline queue covers new-case logging, not dashboard stats).

### M9 — Two duplicate notification-navigation implementations
`hooks/useNotificationNavigation.ts` and `lib/notification-handler.ts` implement the same mapping; both are wired in `_layout.tsx` (double navigation risk when push lands).
→ Fixed by **Task 6.3** (single canonical path).

### M10 — Placeholder Sentry DSN in `app.json`
`apps/mobile/app.json` `extra.sentryDsn: "https://example@sentry.io/0"`; `sentry.config.ts` initializes with it at build. Runtime path uses `EXPO_PUBLIC_SENTRY_DSN`.
→ Fixed by **Task 8.5**.

### M11 — `scripts/patch-renderer-version.js` postinstall mutates node_modules RN internals
Fragile. Documented only (removing it requires RN upgrade verification out of scope).

### M12 — `secure-store.ts` silently swallows write failures
`lib/secure-store.ts:58-71`. Acceptable for preferences; **not** acceptable for the offline queue (Task 5.7's queue uses explicit error handling).

### M13 — `sync.ts` no-op stubs remain
`lib/sync.ts:121-163`: WatermelonDB sync deferred (UXM-001). The queue flush hooks into `initSync` in Task 5.7; WatermelonDB itself remains deferred.

### M14 — Web `lib/notifications.ts` targets a nonexistent `push_tokens` table
→ Fixed by **Task 6.1** (create the table) + **Task 6.4** (wire the senders).

### M15 — `my-cases.tsx` "Conflicts" filter is permanently empty (sync stubbed)
Documented only (WatermelonDB deferred).

### M16 — Mobile has no screen-level render tests
No `@testing-library/react-native`. Out of scope for launch; pure-function tests only (matches existing pattern).

---

## 8. Name Registry

Every name below is used consistently across this document. Do not rename any of these.

### New tables (Phase 1/6/3)
| Table | Columns | Notes |
|---|---|---|
| `push_tokens` | `id uuid PK default gen_random_uuid()`, `tenant_id uuid FK→tenants ON DELETE CASCADE NOT NULL`, `user_id uuid FK→auth.users ON DELETE CASCADE NOT NULL`, `token text NOT NULL UNIQUE`, `platform text NOT NULL CHECK (platform IN ('ios','android'))`, `active boolean NOT NULL default true`, `created_at timestamptz NOT NULL default now()`, `last_seen_at timestamptz NOT NULL default now()` | RLS: owner (`user_id = auth.uid()`) SELECT/INSERT/UPDATE/DELETE own rows; service_role full access; FORCE RLS |
| `contact_submissions` | `id uuid PK default gen_random_uuid()`, `name text NOT NULL`, `email text NOT NULL`, `message text NOT NULL`, `created_at timestamptz NOT NULL default now()`, `responded_at timestamptz` | RLS: **no policies for anon/authenticated** (service_role only, like `webhook_retry_queue`); FORCE RLS |

### New/modified functions (all SECURITY DEFINER, `SET search_path = pg_catalog, public` unless noted)
| Function | Signature | Access |
|---|---|---|
| `get_dashboard_data` (modified) | `(p_tenant_id UUID, p_resident_id UUID, p_role TEXT) RETURNS JSONB` | authenticated; validates caller tenant; ignores `p_role` (uses `get_user_role()`); adds `resident_counts` key |
| `check_case_quota` (modified) | `(p_tenant_id UUID) RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)` | authenticated + service_role; REVOKE PUBLIC/anon |
| `enforce_case_quota` (unmodified trigger fn) | trigger on case_entries | — |
| `get_template_usage_counts` (modified) | `(p_tenant_id UUID, p_resident_id UUID) RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)` | authenticated + service_role; tenant validation; REVOKE PUBLIC/anon |
| `enforce_data_retention` (rewritten v4) | `() RETURNS void` | service_role only |
| `release_ai_quota` (new) | `(p_resident_id UUID, p_count INT DEFAULT 1) RETURNS JSONB` | authenticated; owner or same-tenant supervisor+ |
| `get_analytics_data` (new) | `(p_tenant_id UUID) RETURNS JSONB` | authenticated; tenant validation; keys: `monthly_volume`, `specialty_breakdown`, `monthly_approval_rate`, `supervisor_workload` |
| `get_report_counts` (new) | `(p_tenant_id UUID, p_date_from TEXT DEFAULT NULL, p_date_to TEXT DEFAULT NULL) RETURNS JSONB` | authenticated; tenant validation; keys: `status_counts`, `specialty_counts`, `eval_averages`, `eval_count` |
| `consume_ai_quota` (existing, used) | `(p_resident_id UUID, p_count INT DEFAULT 1) RETURNS JSONB` | authenticated |
| `hash_patient_mrn` (existing, used by mobile) | see Task 5.6 — confirm signature before use | authenticated |

### New/modified views
`secret_ai_config`, `secret_payment_gateway_config`, `secret_tenant_webhooks` — role-gated WHERE clauses (Task 1.1). Column names unchanged.

### New/modified policies
| Policy | Table | Result |
|---|---|---|
| `duty_periods_tenant_isolation` | duty_periods | `USING (tenant_id = get_tenant_id())`; `WITH CHECK` as Task 1.3 |
| `faculty_evals_tenant_isolation` | faculty_evaluations | `USING (tenant_id = get_tenant_id())`; `WITH CHECK` as Task 1.3 |
| `notifications_insert_tenant` | notifications | `WITH CHECK (tenant_id = get_tenant_id() AND (user_id = auth.uid() OR get_user_role() IN ('supervisor','director','institution_admin','admin')))` |

### New web modules
| Module | Purpose |
|---|---|
| `apps/web/lib/csv.ts` | `escapeCsvCell(v: unknown): string` — quotes commas/quotes/newlines AND neutralizes `= + - @` formula prefixes with a leading `'`. Single source of truth for all CSV exports. |
| `apps/web/lib/notifications.ts` (modified) | Works against the new `push_tokens` table; functions `sendPushNotification`, `notifyCaseApproval`, `notifyPendingApproval` unchanged in signature |

### New mobile modules
| Module | Purpose |
|---|---|
| `apps/mobile/lib/offline-queue.ts` | `OfflineQueue` class: `enqueue(payload)`, `flush()`, `getPendingCount()`, `clear()`. Payloads AES-256-CBC encrypted (key: `getOrCreateDbEncryptionKey()`, IV: `expo-crypto` random 16 bytes per item) and stored in AsyncStorage under key `offline_case_queue_v1`. |
| `apps/mobile/lib/push.ts` | `registerPushToken()`, `maybeRemovePushToken()`, `configureForegroundNotifications()`. Uses `expo-notifications`. |

### Mobile storage keys
| Key | Store | Contents |
|---|---|---|
| `offline_case_queue_v1` | AsyncStorage | JSON array of `{ id, iv, ciphertext, createdAt }` |
| `case_form_draft` | AsyncStorage (existing autosave) | draft form state (unchanged) |
| `elogbook.db.encryption_key.v1` | SecureStore (existing) | 64-hex-char AES key |

### Env vars (no new ones required)
Existing only: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PLATFORM_OPENAI_KEY`, `STRIPE_SECRET_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_URL`. Edge functions also need `SUPABASE_URL`, `SUPABASE_ANON_KEY` (already required by `_shared/auth.ts`).

---

## 9. Global Conventions

- **Migration naming:** `supabase/migrations/20260812HHMMSS_<slug>.sql` (14-digit timestamp). The plan uses: `20260812100000_fix_secret_views.sql`, `20260812110000_harden_tenant_rpcs.sql`, `20260812120000_fix_duty_faculty_rls.sql`, `20260812130000_fix_audit_and_notifications.sql`, `20260812140000_retention_v4.sql`, `20260812150000_release_ai_quota.sql`, `20260812160000_push_tokens.sql`, `20260812170000_contact_submissions.sql`, `20260812180000_analytics_rpcs.sql`.
- **pgTAP test naming:** `supabase/tests/p2_<nn>_<slug>.sql`, using the `p1_1b` style (`BEGIN; SELECT plan(n); ... ROLLBACK;`). Tests run via `pnpm test:db` (which runs `supabase db test`); the CI job `db-tests` runs the same files. Every new test file must be listed in the CI run — verify `.github/workflows/ci.yml` `db-tests` job uses `supabase db test` (whole dir). If it lists files explicitly, add the new file there.
- **JWT simulation in tests:** `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims TO '{"sub":"<auth-user-id>","app_metadata":{"tenant_id":"<tenant-id>","user_role":"<role>"}}';` then run the query via `SELECT lives_ok(...)` / `throws_ok(...)`. Roles in claims: `resident`, `supervisor`, `director`, `institution_admin`, `admin`.
- **Never** commit `SUPABASE_SERVICE_ROLE_KEY`, Stripe keys, or any `sk_*` value. `.semgrep.yml` hardcoded-secret rule is an ERROR in CI.
- **PHI:** never log `patient_mrn`, `patient_dob`, `patient_hash`, `field_values`. Web logger redacts them automatically; mobile Sentry scrubs them.

---

# Part 2 — Implementation Plan

---

## Phase 0: Baseline Verification

**Purpose:** Prove the tree is green before any change, so every later regression is attributable.

### Task 0.1: Record the baseline

- [ ] **Step 1: Install + verify toolchain**

Run (repo root `G:\elogbook`, PowerShell):

```powershell
node --version   # expect v22.x
pnpm --version   # expect 9.15.x
pnpm install --frozen-lockfile
```

Expected: install completes with no errors (the `.pnpmfile.cjs` pins are applied).

- [ ] **Step 2: Typecheck + lint + unit tests**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
```

Expected: all pass. If any fail **before you change anything**, fix nothing — record the failure in the task output and continue; the failing area gets covered by its task.

- [ ] **Step 3: Local Supabase**

```powershell
supabase start
supabase db reset
pnpm test:db
```

Expected: `supabase db reset` applies all migrations + seed with no errors; `test:db` reports the 2 existing pgTAP files pass (plans 2/2 and 2/2).

- [ ] **Step 4: Web build**

```powershell
pnpm build:web
```

Expected: build succeeds.

- [ ] **Step 5: Commit the baseline note**

No code changes in this task. Do not commit anything unless the working tree is already clean. If dirty, `git status` first and note it.

---

## Phase 1: Database Critical Security

**Goal:** Close S1–S5, D4, D5, S12 with forward-only migrations + pgTAP tests. Every task: test file + migration + run `pnpm test:db`.

### Task 1.1: Role-gate the secret views (S1)

**Files:**
- Create: `supabase/migrations/20260812100000_fix_secret_views.sql`
- Create: `supabase/tests/p2_01_secret_views_role_gate.sql`
- Modify (Phase 2, not now): edge functions `ai-insights`, `ai-quality`, `create-checkout`, `payment-webhook` — see Tasks 2.1/2.6/7.1. Do **not** touch them in this task.

**Design:** Keep definer views (decryption requires owner rights) but add the same role gate as the base-table RLS policies:
- `secret_ai_config`: only `admin` (any tenant) or `institution_admin` of the caller's tenant.
- `secret_payment_gateway_config`: `admin` (any tenant) or `director`/`institution_admin` of the caller's tenant (create-checkout runs as director+).
- `secret_tenant_webhooks`: `admin` (any tenant) or `institution_admin` of the caller's tenant.

**Step 1: Write the migration.**

```sql
-- 20260812100000_fix_secret_views.sql
-- S1: any authenticated user could read their tenant's decrypted API keys /
-- webhook secrets through the definer secret_* views. Add the same role gate
-- as the base-table RLS policies to each view's WHERE clause.

CREATE OR REPLACE VIEW public.secret_ai_config AS
SELECT
  id, tenant_id, provider, model, endpoint_url, is_active,
  public.decrypt_with_version(api_key_enc, key_version) AS api_key,
  key_version, created_at, updated_at
FROM public.ai_config
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin');

ALTER VIEW public.secret_ai_config SET (security_barrier = true);

CREATE OR REPLACE VIEW public.secret_payment_gateway_config AS
SELECT
  id, tenant_id, provider, publishable_key, is_active, mode, endpoint_url,
  public.decrypt_with_version(secret_key_enc,    key_version) AS secret_key,
  public.decrypt_with_version(webhook_secret_enc, key_version) AS webhook_secret,
  key_version, created_at, updated_at
FROM public.payment_gateway_config
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() IN ('director', 'institution_admin'));

ALTER VIEW public.secret_payment_gateway_config SET (security_barrier = true);

CREATE OR REPLACE VIEW public.secret_tenant_webhooks AS
SELECT
  id, tenant_id, url, events, description, is_active, created_at, updated_at,
  CASE
    WHEN current_setting('app.encryption_key', true) IS NOT NULL
         AND current_setting('app.encryption_key', true) != ''
    THEN extensions.pgp_sym_decrypt(secret_enc, current_setting('app.encryption_key'))
    ELSE secret
  END AS secret
FROM public.tenant_webhooks
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin');

ALTER VIEW public.secret_tenant_webhooks SET (security_barrier = true);
```

**Step 2: Write the pgTAP test.**

`supabase/tests/p2_01_secret_views_role_gate.sql`:

```sql
BEGIN;
SELECT plan(4);

-- Setup: tenant + auth users + profiles for a resident and an institution_admin.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000011', 'Secret Test Tenant', 'secret-test-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'secret-resident@example.com'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'secret-admin@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'resident', 'Secret Resident'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', 'institution_admin', 'Secret Admin');

-- Seed a key encrypted with a known GUC value so the decrypt path is exercised.
SELECT set_config('app.encryption_key', 'test-encryption-key', false);

INSERT INTO ai_config (tenant_id, provider, model, endpoint_url, is_active, api_key_enc, key_version)
VALUES ('00000000-0000-0000-0000-000000000011', 'openai', 'gpt-test', NULL, true,
        extensions.pgp_sym_encrypt('super-secret-key', 'test-encryption-key'), 1)
ON CONFLICT (tenant_id) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc, key_version = EXCLUDED.key_version;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000011","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.secret_ai_config),
  0::bigint,
  'resident cannot read secret_ai_config rows'
);
SELECT is(
  (SELECT count(*) FROM public.secret_payment_gateway_config),
  0::bigint,
  'resident cannot read secret_payment_gateway_config rows'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000012","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000011","user_role":"institution_admin"}}';

SELECT is(
  (SELECT api_key FROM public.secret_ai_config WHERE tenant_id = '00000000-0000-0000-0000-000000000011' LIMIT 1),
  'super-secret-key',
  'institution_admin of the tenant can read the decrypted api key'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.secret_ai_config),
  0::bigint,
  'resident of another tenant cannot read secret_ai_config rows'
);

ROLLBACK;
```

**Step 3: Run tests.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_01_secret_views_role_gate` plan 4/4 passes; existing tests still pass.

**Step 4: Commit.**

```powershell
git add supabase/migrations/20260812100000_fix_secret_views.sql supabase/tests/p2_01_secret_views_role_gate.sql
git commit -m "fix(db): role-gate secret views so residents cannot read tenant API keys"
```

**Step 5 (deployment note, run at deploy time, not now):** after `supabase db push`, the checkout path is unaffected by the view change — `create-checkout` moves to service-role config reads in Task 2.1 Step 7. Still verify the **product** gate: which roles may invoke `create-checkout`?

```powershell
rg -n "AUTHORIZED_ROLES|user_role|role" supabase/functions/create-checkout/index.ts
```

If `resident` is not an allowed role and individual-tenant users hold role `resident` (check `supabase/migrations/00004_auth_triggers.sql` `handle_new_user` for what role it assigns), individual tenants cannot reach checkout — record this in the launch checklist (§15) as a billing blocker. Do **not** change role gates in this task.

### Task 1.2: Harden tenant-scoped RPCs (S2, D4, D5)

**Files:**
- Create: `supabase/migrations/20260812110000_harden_tenant_rpcs.sql`
- Create: `supabase/tests/p2_02_rpc_tenant_checks.sql`

**Design:**
1. `get_dashboard_data` — reject when caller's tenant ≠ `p_tenant_id` (service_role exempt); derive the effective role from `get_user_role()` and ignore the caller-supplied `p_role`. Add a `resident_counts` key (JSON array of `{resident_id, total, approved}`) computed in SQL — consumed by Task 4.1.
2. `get_template_usage_counts` — convert to plpgsql with the same tenant validation; REVOKE PUBLIC/anon EXECUTE.
3. `check_case_quota` — same validation (service_role exempt, because `enforce_case_quota`'s trigger path and `cases/new` page both call it); REVOKE PUBLIC/anon; GRANT authenticated + service_role. Keep `search_path = public` hardened to `pg_catalog, public`.

**Step 1: Write the migration.**

```sql
-- 20260812110000_harden_tenant_rpcs.sql
-- S2/D4/D5: tenant-scoped RPCs must validate the caller against the target
-- tenant instead of trusting parameters. EXECUTE privileges: default PUBLIC
-- grants are revoked; only authenticated and service_role may call.

-- ── get_dashboard_data ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id    UUID,
  p_resident_id  UUID,
  p_role         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role            TEXT := get_user_role();
  v_stats           JSONB;
  v_recent_cases    JSONB;
  v_resident_counts JSONB;
  v_pending_approvals BIGINT;
  v_total_residents BIGINT;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant dashboard access denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'draft',    COALESCE(count(*) FILTER (WHERE status = 'draft'),    0),
    'pending',  COALESCE(count(*) FILTER (WHERE status = 'pending'),  0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_stats
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (v_role != 'resident' OR (v_role = 'resident' AND resident_id = p_resident_id));

  SELECT jsonb_agg(sub ORDER BY sub.created_at DESC)
  INTO v_recent_cases
  FROM (
    SELECT
      ce.id,
      ce.case_date,
      ce.status,
      ct.name      AS template_name,
      ct.specialty AS template_specialty
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id
      AND ce.deleted_at IS NULL
      AND (v_role != 'resident' OR (v_role = 'resident' AND ce.resident_id = p_resident_id))
    ORDER BY ce.created_at DESC
    LIMIT 5
  ) sub;

  IF v_recent_cases IS NULL THEN
    v_recent_cases := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.resident_id), '[]'::jsonb)
  INTO v_resident_counts
  FROM (
    SELECT resident_id,
           count(*)                       AS total,
           count(*) FILTER (WHERE status = 'approved') AS approved
    FROM public.case_entries
    WHERE tenant_id = p_tenant_id
      AND deleted_at IS NULL
    GROUP BY resident_id
  ) t;

  SELECT COUNT(*) INTO v_pending_approvals
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND status = 'pending'
    AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_total_residents
  FROM public.profiles
  WHERE tenant_id = p_tenant_id
    AND role = 'resident';

  RETURN jsonb_build_object(
    'stats',              v_stats,
    'recent_cases',       v_recent_cases,
    'resident_counts',    v_resident_counts,
    'pending_approvals',  v_pending_approvals,
    'total_residents',    v_total_residents
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  TO authenticated, service_role;

-- ── get_template_usage_counts ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_template_usage_counts(UUID, UUID);

CREATE FUNCTION public.get_template_usage_counts(p_tenant_id UUID, p_resident_id UUID)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant template usage access denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT ct.id, COUNT(ce) FILTER (WHERE ce.resident_id = p_resident_id), COUNT(ce)
  FROM public.case_templates ct
  LEFT JOIN public.case_entries ce ON ce.template_id = ct.id AND ce.deleted_at IS NULL
  WHERE ct.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY ct.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID)
  TO authenticated, service_role;

-- ── check_case_quota ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_plan_id UUID; v_features JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant quota access denied'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT plan_id INTO v_plan_id FROM subscriptions WHERE tenant_id = p_tenant_id AND status = 'active' LIMIT 1;
  SELECT features INTO v_features FROM subscription_plans WHERE id = v_plan_id;
  v_features := COALESCE(v_features, '{"max_cases": 20}'::JSONB);
  RETURN QUERY
  SELECT
    CASE WHEN (v_features->>'max_cases')::INT = 0 THEN TRUE
         ELSE (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL) < (v_features->>'max_cases')::INT
    END,
    (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND deleted_at IS NULL),
    (v_features->>'max_cases')::INT,
    (SELECT slug FROM subscription_plans WHERE id = v_plan_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.check_case_quota(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_case_quota(UUID) TO authenticated, service_role;
```

Note: `enforce_case_quota` (trigger) stays as-is — it runs as SECURITY DEFINER, and `check_case_quota` now accepts the service_role path AND the postgres/owner path (`auth.role() IS NULL`, used by migrations, seed scripts and manual SQL), so the trigger keeps working for all inserts; for authenticated inserts the trigger's call runs inside the user's transaction, where `get_tenant_id()` resolves to the inserting user's tenant and matches `NEW.tenant_id` (RLS already enforces `tenant_id = get_tenant_id()` on `case_entries` inserts).

**Step 2: Write the pgTAP test.**

`supabase/tests/p2_02_rpc_tenant_checks.sql`:

```sql
BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000021', 'RPC Tenant', 'rpc-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000000', 'rpc-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000021';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000021', 'resident', 'RPC Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000021","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';

SELECT throws_ok(
  $$SELECT * FROM public.get_dashboard_data('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000093', 'resident')$$,
  '42501', NULL,
  'get_dashboard_data rejects cross-tenant p_tenant_id'
);
SELECT throws_ok(
  $$SELECT * FROM public.check_case_quota('00000000-0000-0000-0000-000000000022')$$,
  '42501', NULL,
  'check_case_quota rejects cross-tenant p_tenant_id'
);
SELECT throws_ok(
  $$SELECT * FROM public.get_template_usage_counts('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000093')$$,
  '42501', NULL,
  'get_template_usage_counts rejects cross-tenant p_tenant_id'
);
SELECT lives_ok(
  $$SELECT * FROM public.get_dashboard_data('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000093', 'resident')$$,
  'get_dashboard_data works for own tenant'
);
ROLLBACK;
```

**Step 3: Run tests.**

```powershell
supabase db reset
pnpm test:db
```

Expected: all plans pass (including `p2_02` 4/4).

**Step 4: Commit.**

```powershell
git add supabase/migrations/20260812110000_harden_tenant_rpcs.sql supabase/tests/p2_02_rpc_tenant_checks.sql
git commit -m "fix(db): enforce caller-tenant checks on dashboard, template-usage and quota RPCs"
```

### Task 1.3: Fix caller-agnostic RLS on duty_periods + faculty_evaluations (S3)

**Files:**
- Create: `supabase/migrations/20260812120000_fix_duty_faculty_rls.sql`
- Create: `supabase/tests/p2_03_duty_faculty_rls.sql`
- **Integration note:** Task 5.1 (mobile duty-hours fix) must land in the same release; with this policy the current mobile insert (resident_id undefined) fails closed, which is correct behavior.

**Step 1: Write the migration.**

```sql
-- 20260812120000_fix_duty_faculty_rls.sql
-- S3: policies never referenced the caller. Bind every read/write to the
-- caller's own tenant and require a legitimate actor for writes.

DROP POLICY IF EXISTS duty_periods_tenant_isolation ON public.duty_periods;

CREATE POLICY duty_periods_tenant_isolation ON public.duty_periods
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public.faculty_evaluations;

CREATE POLICY faculty_evals_tenant_isolation ON public.faculty_evaluations
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );
```

**Step 2: Write the pgTAP test.**

`supabase/tests/p2_03_duty_faculty_rls.sql`:

```sql
BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000031', 'Duty Tenant', 'duty-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000000', 'duty-resident@example.com'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000000', 'duty-other@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031', 'resident', 'Duty Resident'),
  ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032', 'resident', 'Other Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000031","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000031","user_role":"resident"}}';

SELECT throws_ok(
  $$INSERT INTO public.duty_periods (tenant_id, resident_id, shift_date, hours_worked, shift_type)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000095', '2026-08-12', 8, 'regular')$$,
  NULL,
  'resident cannot log duty hours for another resident'
);
SELECT lives_ok(
  $$INSERT INTO public.duty_periods (tenant_id, resident_id, shift_date, hours_worked, shift_type)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000094', '2026-08-12', 8, 'regular')$$,
  'resident can log their own duty hours'
);
SELECT throws_ok(
  $$INSERT INTO public.faculty_evaluations (tenant_id, resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000094', '2026-08-12', 4, 4, 4)$$,
  NULL,
  'resident cannot insert faculty evaluations'
);
SELECT is(
  (SELECT count(*) FROM public.duty_periods WHERE tenant_id = '00000000-0000-0000-0000-000000000031'),
  1::bigint,
  'caller sees only their own tenant rows (1 row inserted above)'
);
ROLLBACK;
```

**Step 3: Run tests.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_03` plan 4/4 passes.

**Step 4: Commit.**

```powershell
git add supabase/migrations/20260812120000_fix_duty_faculty_rls.sql supabase/tests/p2_03_duty_faculty_rls.sql
git commit -m "fix(db): bind duty_periods and faculty_evaluations policies to the caller tenant"
```

### Task 1.4: Fix audit triggers + notifications INSERT policy (S4, S5)

**Files:**
- Create: `supabase/migrations/20260812130000_fix_audit_and_notifications.sql`
- Create: `supabase/tests/p2_04_audit_and_notifications.sql`

**Step 1: Write the migration.**

```sql
-- 20260812130000_fix_audit_and_notifications.sql
-- S4: trg_audit_institutions fails every mutation (institutions has no
-- tenant_id, audit_logs.tenant_id is NOT NULL); audit_program_goals writes a
-- profiles.id into audit_logs.user_id (FK auth.users) and reads NEW on DELETE.
-- S5: notifications_insert_tenant allowed spoofing notifications for any user
-- in the caller's tenant.

-- institutions is platform-level data mutated by service_role/migrations only;
-- the generic audit trigger cannot represent it (no tenant_id). Drop it.
DROP TRIGGER IF EXISTS trg_audit_institutions ON public.institutions;

-- program_goals audit: map director profile to auth user id; use OLD on DELETE.
CREATE OR REPLACE FUNCTION audit_program_goals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      OLD.tenant_id,
      (SELECT user_id FROM public.profiles WHERE id = OLD.director_id LIMIT 1),
      'delete',
      'program_goal',
      OLD.id,
      '{}'::jsonb
    );
    RETURN OLD;
  END IF;

  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.tenant_id,
    (SELECT user_id FROM public.profiles WHERE id = NEW.director_id LIMIT 1),
    TG_OP,
    'program_goal',
    NEW.id,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_program_goals ON public.program_goals;
CREATE TRIGGER trg_audit_program_goals
  AFTER INSERT OR UPDATE OR DELETE ON public.program_goals
  FOR EACH ROW EXECUTE FUNCTION audit_program_goals();

-- notifications: only the target user or a supervisor+ of the same tenant
-- may create notification rows.
DROP POLICY IF EXISTS notifications_insert_tenant ON public.notifications;

CREATE POLICY notifications_insert_tenant ON public.notifications
  FOR INSERT
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      user_id = auth.uid()
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );
```

**Step 2: Write the pgTAP test.**

`supabase/tests/p2_04_audit_and_notifications.sql`:

```sql
BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000041', 'Audit Tenant', 'audit-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000000', 'audit-director@example.com'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000000', 'audit-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'director', 'Audit Director'),
  ('00000000-0000-0000-0000-000000000097', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', 'resident', 'Audit Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"director"}}';

-- program_goals insert must succeed and produce a valid audit row whose
-- user_id maps to the director's auth user id.
SELECT lives_ok(
  $$INSERT INTO public.program_goals (tenant_id, director_id, resident_id, title, target_count, deadline)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-000000000097', 'Test Goal', 10, '2026-12-31')$$,
  'program_goals insert succeeds (audit trigger no longer FK-violates)'
);

-- notifications: resident spoofing another user fails
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000042","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"resident"}}';

SELECT throws_ok(
  $$INSERT INTO public.notifications (tenant_id, user_id, type, title, body)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'approval', 'x', 'x')$$,
  NULL,
  'resident cannot insert a notification addressed to another user'
);
SELECT lives_ok(
  $$INSERT INTO public.notifications (tenant_id, user_id, type, title, body)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', 'approval', 'x', 'x')$$,
  'user can insert a notification addressed to themselves'
);

-- institutions audit trigger dropped: inserting an institution succeeds
SET LOCAL ROLE postgres;
SELECT lives_ok(
  $$INSERT INTO public.institutions (id, name, slug, tier) VALUES (gen_random_uuid(), 'Audit Institution', 'audit-institution', 'free')$$,
  'institutions insert succeeds after dropping the broken audit trigger'
);
ROLLBACK;
```

Note: `SET LOCAL ROLE postgres` is valid inside a transaction for the test session. If `pgTAP` rejects changing roles mid-test, split the institutions check into its own statement block with `DO $$ ... $$` before the ROLLBACK. The test runner must report plan 4/4.

**Step 3: Run tests.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_04` plan 4/4 passes.

**Step 4: Commit.**

```powershell
git add supabase/migrations/20260812130000_fix_audit_and_notifications.sql supabase/tests/p2_04_audit_and_notifications.sql
git commit -m "fix(db): repair institutions/program_goals audit triggers and notifications spoofing"
```

### Task 1.5: Rewrite enforce_data_retention (S12)

**Files:**
- Create: `supabase/migrations/20260812140000_retention_v4.sql`
- Create: `supabase/tests/p2_05_retention_v4.sql`

**Step 1: Write the migration.**

```sql
-- 20260812140000_retention_v4.sql
-- S12: v3 iterated a non-existent data_retention_policies table and wrote
-- audit rows with resource_id NULL. v4 works on the real schema:
-- per-tenant retention (tenants.data_retention_days, default 2555),
-- soft-delete case_entries, hard-delete dependent rows, and audit each purge.
-- Executable by service_role only (unchanged privilege from 00055).

CREATE OR REPLACE FUNCTION public.enforce_data_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant RECORD;
  v_cutoff TIMESTAMPTZ;
  v_case_count BIGINT;
  v_query_count BIGINT;
  v_consent_count BIGINT;
  v_attach_count BIGINT;
BEGIN
  FOR v_tenant IN
    SELECT id, COALESCE(data_retention_days, 2555) AS retention_days
    FROM public.tenants
    WHERE deleted_at IS NULL
  LOOP
    v_cutoff := now() - make_interval(days => v_tenant.retention_days);

    UPDATE public.case_entries
       SET deleted_at = now()
     WHERE tenant_id = v_tenant.id
       AND deleted_at IS NULL
       AND created_at < v_cutoff;
    GET DIAGNOSTICS v_case_count = ROW_COUNT;

    DELETE FROM public.ai_query_logs
     WHERE tenant_id = v_tenant.id
       AND created_at < v_cutoff;
    GET DIAGNOSTICS v_query_count = ROW_COUNT;

    DELETE FROM public.consent_records
     WHERE tenant_id = v_tenant.id
       AND granted_at < v_cutoff;
    GET DIAGNOSTICS v_consent_count = ROW_COUNT;

    DELETE FROM public.case_attachments
     WHERE tenant_id = v_tenant.id
       AND entry_id IN (
         SELECT id FROM public.case_entries
          WHERE tenant_id = v_tenant.id
            AND deleted_at IS NOT NULL
            AND deleted_at < v_cutoff
       );
    GET DIAGNOSTICS v_attach_count = ROW_COUNT;

    DELETE FROM public.ai_response_cache
     WHERE tenant_id = v_tenant.id
       AND expires_at < now();

    IF v_case_count > 0 OR v_query_count > 0 OR v_consent_count > 0 OR v_attach_count > 0 THEN
      INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
      VALUES (
        v_tenant.id,
        NULL,
        'data_retention_purge',
        'retention_purge',
        v_tenant.id,
        jsonb_build_object(
          'cutoff', v_cutoff,
          'cases_soft_deleted', v_case_count,
          'ai_query_logs_deleted', v_query_count,
          'consent_records_deleted', v_consent_count,
          'attachments_deleted', v_attach_count
        )
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_data_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_data_retention() TO service_role;
```

Note: `audit_logs.user_id` is nullable (FK SET NULL) — `NULL` here is intentional for a cron-driven purge. `resource_id` = tenant UUID satisfies NOT NULL while keeping one audit row per tenant per run.

**Step 2: Write the pgTAP test.**

`supabase/tests/p2_05_retention_v4.sql`:

```sql
BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt, data_retention_days)
VALUES ('00000000-0000-0000-0000-000000000051', 'Retention Tenant', 'retention-tenant', 'institution', encode(gen_random_bytes(32), 'hex'), 2555)
ON CONFLICT (id) DO UPDATE SET data_retention_days = 2555;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'retention@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000051';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000051', 'resident', 'Retention Resident');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000051', 'surgery', 'Retention Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Insert one old case (10 years ago) and one fresh case.
INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000098', 'approved', now() - interval '10 years', now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000098', 'draft', now(), now());

-- Run the purge as the test (postgres-equivalent) session. The function is
-- SECURITY DEFINER owned by postgres, so it executes successfully here.
SELECT lives_ok(
  $$SELECT public.enforce_data_retention()$$,
  'enforce_data_retention v4 executes without error'
);

SELECT is(
  (SELECT count(*) FROM public.case_entries WHERE tenant_id = '00000000-0000-0000-0000-000000000051' AND deleted_at IS NULL),
  1::bigint,
  'only the 10-year-old case was soft-deleted; the fresh case remains'
);
ROLLBACK;
```

Note: the old case (`created_at = now() - 10 years`) is beyond the 2555-day cutoff; the fresh case is not. The audit insert runs as the definer (postgres) so RLS does not block it.

**Step 3: Run tests.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_05` plan 2/2 passes.

**Step 4: Verify the cron job is intact** (no change needed):

```powershell
rg -n "enforce-data-retention" supabase/migrations/00056_audit_triggers_and_cron.sql
```

Expected: line with `cron.schedule('enforce-data-retention', '0 3 * * *', ...)`.

**Step 5: Commit.**

```powershell
git add supabase/migrations/20260812140000_retention_v4.sql supabase/tests/p2_05_retention_v4.sql
git commit -m "fix(db): rewrite enforce_data_retention against real schema with per-tenant audit"
```

### Task 1.6: Phase 1 integration gate

- [ ] Run the full suite and record results:

```powershell
supabase db reset
pnpm test:db
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
```

Expected: everything passes. Any regression found here belongs to the task that caused it — fix it in that task's files (no new migrations).

---

## Phase 2: Backend Correctness (Edge Functions)

**Goal:** Fix S6, S7, D1, D2, S9, S13 and make the money path work end to end for individuals.

### Task 2.1: Fix payment-webhook tenant resolution + upsert + payments status (S6, D1, D2)

**Files:**
- Modify: `supabase/functions/payment-webhook/index.ts`
- Test: `supabase/functions/payment-webhook/index.test.ts` (existing) — must keep passing; add cases below.

**Step 1: Read the current resolution code to confirm the exact lines (they must match before editing).**

```powershell
rg -n "readTenantSlug|stripe_account_id|tenant_slug|getConfigForWebhook|onConflict|status: 'succeeded'" supabase/functions/payment-webhook/index.ts
```

Expected: hits at lines ~12-57 (`readTenantSlug`/`getConfigForWebhook`), ~91-120 (fallback), ~225-234 (upsert), ~333-339 (payments insert). If the file differs, re-derive the edits from the actual text; the semantics below are authoritative.

**Step 2: Replace `readTenantSlug` + `getConfigForWebhook` with metadata-based resolution.**

Replace the block starting at `async function readTenantSlug(...)` (the whole function, ~lines 49-57) with:

```ts
async function readTenantIdFromEvent(body: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(body);
    const metadata = parsed?.data?.object?.metadata;
    return (metadata?.tenant_id as string | null) ?? null;
  } catch {
    return null;
  }
}

async function resolveTenantConfig(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<CachedConfig | null> {
  const cached = configCache.get(tenantId);
  if (cached && (Date.now() - cached.fetchedAt) < CONFIG_CACHE_TTL) return cached;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  // Service-role client bypasses the role-gated secret view (Task 1.1) and
  // reads the base table; decrypt_with_version is service_role-executable.
  const { data, error } = await supabase
    .from('payment_gateway_config')
    .select('id, tenant_id, secret_key_enc, webhook_secret_enc, mode, key_version')
    .eq('tenant_id', tenant.id)
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;

  const { data: dec, error: decError } = await supabase.rpc('decrypt_with_version', {
    p_encrypted: data.secret_key_enc,
    p_version: data.key_version,
  });
  if (decError || !dec) return null;

  const { data: decWs, error: decWsError } = await supabase.rpc('decrypt_with_version', {
    p_encrypted: data.webhook_secret_enc,
    p_version: data.key_version,
  });
  if (decWsError) return null;

  const cfg: CachedConfig = {
    id: data.id,
    tenantId: data.tenant_id,
    secret: dec as string,
    webhookSecret: (decWs ?? '') as string,
    mode: data.mode,
    fetchedAt: Date.now(),
  };
  configCache.set(tenantId, cfg);
  return cfg;
}
```

**Step 3: Replace the caller-side resolution block.**

Replace the block from `const stripeAccountId = req.headers.get('Stripe-Account');` through the closing of the `if (!gwConfig && !stripeAccountId) { ... }` fallback (the section ending with the `}` right before `if (!gwConfig) { return new Response(... 401 ...) }`) with:

```ts
  // Tenant resolution: create-checkout sets metadata.tenant_id on the
  // checkout session. All subscription events carry the checkout session's
  // metadata via their subscription metadata. Prefer the event's own
  // metadata; fall back to the subscription's metadata.
  let tenantIdFromEvent = await readTenantIdFromEvent(body);
  if (!tenantIdFromEvent) {
    try {
      const parsed = JSON.parse(body);
      tenantIdFromEvent = (parsed?.data?.object?.metadata?.tenant_id as string | null) ?? null;
    } catch {
      tenantIdFromEvent = null;
    }
  }

  let gwConfig: CachedConfig | null = null;
  if (tenantIdFromEvent) {
    gwConfig = await resolveTenantConfig(supabase, tenantIdFromEvent);
  }

  if (!gwConfig) {
    // Platform-default gateway config for the global tenant.
    gwConfig = await resolveTenantConfig(supabase, '00000000-0000-0000-0000-000000000000');
  }

  if (!gwConfig) {
    return new Response(
      JSON.stringify({ error: 'Could not identify tenant from webhook' }),
      { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
```

**Step 4: Fix the `checkout.session.completed` subscription write.**

Replace:

```ts
      await supabase.from('subscriptions').upsert(
        {
          tenant_id,
          plan_id,
          status: 'active',
          gateway_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
        },
        { onConflict: 'tenant_id' }
      );
```

with:

```ts
      // 00055 dropped UNIQUE(tenant_id); only a partial unique index on
      // (tenant_id) WHERE status IN (active, trialing, past_due) remains.
      // Upsert manually: update any existing row for this tenant, else insert.
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (existingSub) {
        await supabase
          .from('subscriptions')
          .update({
            plan_id,
            status: 'active',
            gateway_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
          })
          .eq('id', existingSub.id);
      } else {
        await supabase.from('subscriptions').insert({
          tenant_id,
          plan_id,
          status: 'active',
          gateway_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
        });
      }
```

**Step 5: Fix the `invoice.paid` payments status.**

Replace:

```ts
          status: 'succeeded',
```

with:

```ts
          status: 'completed',
```

(Within the same payments insert; the CHECK from 00029 allows only `pending/completed/failed/refunded/cancelled`.)

**Step 6: Wire failure recording.** After each `catch (err)` block that returns a 500 for an event, call `mark_stripe_event_failed`:

At the top of the file, after the client creation, add:

```ts
async function markEventFailed(
  eventId: string,
  eventType: string,
  reason: string,
): Promise<void> {
  try {
    await supabase.rpc('mark_stripe_event_failed', {
      p_event_id: eventId,
      p_event_type: eventType,
      p_failure_reason: reason,
    });
  } catch (logErr) {
    console.error('Failed to record stripe event failure', logErr);
  }
}
```

Confirm the RPC signature first:

```powershell
rg -n "mark_stripe_event_failed" supabase/migrations/*.sql
```

If the parameter names differ from `p_event_id/p_event_type/p_failure_reason`, use the actual names from the migration. In the outer `catch` that wraps event processing, add `await markEventFailed(event.id, event.type, err instanceof Error ? err.message : 'unknown');` before returning the error response.

**Step 7: Fix create-checkout config reads (same pattern).**

Task 1.1's role gate also stops `create-checkout` (director+) from reading the **global** tenant's platform-default gateway config through `secret_payment_gateway_config` (the view no longer returns the global row to non-admin roles). Switch `create-checkout/index.ts` config reads to the service client:

- After `const { supabase, user, tenantId, role } = authResult;` add:

```ts
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
```

- Replace the two `secret_payment_gateway_config` lookups (tenant config ~lines 82-88 and global fallback ~lines 91-99) with a helper that reads `payment_gateway_config` + `decrypt_with_version` via `serviceSupabase`:

```ts
  async function readGatewayConfig(targetTenantId: string) {
    const { data: cfg, error } = await serviceSupabase
      .from('payment_gateway_config')
      .select('id, tenant_id, secret_key_enc, publishable_key, mode, webhook_secret_enc, key_version')
      .eq('tenant_id', targetTenantId)
      .eq('provider', 'stripe')
      .eq('is_active', true)
      .maybeSingle();
    if (error || !cfg) return null;
    const { data: secretKey, error: decError } = await serviceSupabase.rpc('decrypt_with_version', {
      p_encrypted: cfg.secret_key_enc,
      p_version: cfg.key_version,
    });
    if (decError || !secretKey) return null;
    return {
      id: cfg.id,
      tenant_id: cfg.tenant_id,
      secret_key: secretKey as string,
      publishable_key: cfg.publishable_key,
      mode: cfg.mode,
      webhook_secret: '',
    };
  }

  let gwConfig = await readGatewayConfig(tenantId);
  if (!gwConfig) {
    gwConfig = await readGatewayConfig('00000000-0000-0000-0000-000000000000');
  }
```

Keep the `STRIPE_SECRET_KEY` env fallback block unchanged. Keep the rest of the file (rate limit, role gate, session creation with `metadata: { tenant_id, plan_id }`) exactly as-is.

**Step 8: Add/extend Deno tests.**

In `supabase/functions/payment-webhook/index.test.ts`, add a test for `resolveTenantConfig` if it is exported; if it is not exported, export it for tests:

```ts
// test: resolveTenantConfig returns null for unknown tenant
Deno.test('resolveTenantConfig returns null when tenant does not exist', async () => {
  const stubSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  const result = await resolveTenantConfig(stubSupabase as never, '00000000-0000-0000-0000-000000000000');
  assertEquals(result, null);
});
```

Adjust the mock shape to match the actual chain used (`.from('tenants').select('id').eq('id', tenantId).maybeSingle()`). Keep all existing tests passing.

**Step 9: Run function tests.**

```powershell
cd supabase/functions/payment-webhook && deno test
```

Expected: all tests pass.

**Step 10: Commit.**

```powershell
git add supabase/functions/payment-webhook/index.ts supabase/functions/payment-webhook/index.test.ts supabase/functions/create-checkout/index.ts
git commit -m "fix(functions): resolve webhook tenant via metadata.tenant_id, fix subscription upsert and payment status, service-role gateway config reads"
```

### Task 2.2: Add ownership check to list-invoices (S7)

**Files:**
- Modify: `supabase/functions/list-invoices/index.ts`

**Step 1: Replace the subscription lookup + invoice call block.**

Current code looks up the caller's subscription (`gateway_subscription_id`) then lists invoices for the **customer_id from the query param** with no cross-check. Replace the section from the `const { data: subscription } = ...` line through the end of the function body with:

```ts
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('gateway_subscription_id, stripe_customer_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .single();

  if (!subscription?.gateway_subscription_id) {
    return new Response(JSON.stringify({ invoices: [] }), { status: 200 });
  }

  // Ownership: the requested customer must be the caller's own Stripe customer.
  if (subscription.stripe_customer_id !== customerId) {
    return new Response(
      JSON.stringify({ error: 'customer_id does not belong to your subscription' }),
      { status: 403 },
    );
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
    });
    ...
```

(Keep the existing try/catch and response shape exactly as they are.)

**Step 2: Verify typecheck.**

```powershell
deno check supabase/functions/list-invoices/index.ts
```

Expected: no errors (if `deno check` is unavailable locally, the CD `functions` job will typecheck at deploy; state that in the task output).

**Step 3: Commit.**

```powershell
git add supabase/functions/list-invoices/index.ts
git commit -m "fix(functions): verify customer ownership in list-invoices"
```

### Task 2.3: Create-checkout metadata is already correct — verify only

`create-checkout/index.ts:142` already sets `metadata: { tenant_id, plan_id }`, which Task 2.1 now consumes. Run:

```powershell
rg -n "metadata" supabase/functions/create-checkout/index.ts
```

Expected: `metadata: { tenant_id: tenantId, plan_id },` present. **No code change.** If absent, stop and report — do not invent a fix.

Also verify the role gate question from Task 1.1 Step 5:

```powershell
rg -n "AUTHORIZED_ROLES|user_role|role" supabase/functions/create-checkout/index.ts
```

Record which roles may create checkouts. If `resident` is not allowed and individual-tenant users have role `resident`, note it in the launch checklist (§15) as a blocker for individual billing — the individuals-first launch requires individual tenants to reach checkout. If needed, the fix is: allow `resident` when the caller's tenant has `tenant_type = 'individual'` (look up the tenant first). Implement only if the grep proves the gap exists.

### Task 2.4: Fix edge-function audit writes via service role (S9)

**Files:**
- Modify: `supabase/functions/generate-pdf/index.ts`
- Modify: `supabase/functions/webads-export/index.ts`

**Step 1: In each file, create a service-role client and use it for the audit insert.**

In `generate-pdf/index.ts`, after the `authenticate(req)` block (where `const { supabase, tenantId } = authResult;` appears), add:

```ts
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
```

(`createClient` is already imported from `_shared/auth.ts`'s dependency — confirm the import line; if `createClient` is not imported, add it: `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';`.)

Replace the audit insert block:

```ts
  // P2.10: write an audit log entry for every PDF export.
  await serviceSupabase.from('audit_logs').insert({
    tenant_id: tenantId,
    user_id: userId,
    action: 'pdf_export',
    resource_type: 'case_entries',
    resource_id: case_ids.join(','),
    changes: {
      case_count: case_ids.length,
      resident_name,
      format: 'pdf',
    },
  });
```

(Same fields as before; only the client changes.)

Do the same in `webads-export/index.ts`: add the service-role client after `authenticate(req)` and switch the existing audit insert (currently `await supabase.from('audit_logs').insert({...})` with `user_id: (await supabase.auth.getUser()).data.user?.id`) to `serviceSupabase`, keeping all fields identical.

**Step 2: Verify with the Deno test in generate-pdf.**

```powershell
cd supabase/functions/generate-pdf && deno test
```

Expected: existing 401 test passes.

**Step 3: Commit.**

```powershell
git add supabase/functions/generate-pdf/index.ts supabase/functions/webads-export/index.ts
git commit -m "fix(functions): write export audit rows with service role so they are not silently dropped"
```

### Task 2.5: Replace wildcard CORS in ai-gap-analysis (S13)

**Files:**
- Modify: `supabase/functions/ai-gap-analysis/index.ts`

**Step 1: Remove the local `corsHeaders` const (lines ~16-19) and import the shared helper.**

Replace:

```ts
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
```

with:

```ts
import { corsHeaders } from '../_shared/auth.ts';
```

(Move this import to the top with the other imports; remove the local const. The file already imports `authenticate` from `_shared/auth.ts`, so extend that import: `import { authenticate, corsHeaders } from '../_shared/auth.ts';`)

**Step 2: Update call sites.**

The shared `corsHeaders` takes an origin argument: replace `{ ...corsHeaders, 'Content-Type': 'application/json' }` usages with `{ ...corsHeaders(req.headers.get('Origin')), 'Content-Type': 'application/json' }`.

**Step 3: Verify.**

```powershell
rg -n "Access-Control-Allow-Origin|\.\.\.corsHeaders" supabase/functions/ai-gap-analysis/index.ts
```

Expected: no `'*'` remains; all usages pass an origin.

**Step 4: Commit.**

```powershell
git add supabase/functions/ai-gap-analysis/index.ts
git commit -m "fix(functions): use shared origin allow-list CORS in ai-gap-analysis"
```

### Task 2.6: Prepare ai-insights/ai-quality for the gated secret view (S1 follow-up)

**Files:**
- Modify: `supabase/functions/ai-insights/index.ts`
- Modify: `supabase/functions/ai-quality/index.ts`

After Task 1.1, the `secret_ai_config` view no longer returns rows for residents/supervisors. These two functions read it with the **user-token** client, so AI calls would break. Switch both to a service-role read of the base table + `decrypt_with_version`.

**Step 1: Add the service client and replace the config read in ai-insights.**

In `ai-insights/index.ts`, after `const { supabase, user, tenantId, role } = authResult;` add:

```ts
  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
```

(Confirm `createClient` is imported; if not, add `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';`.)

Replace the config fetch block (currently reading `secret_ai_config` with the user client):

```ts
  let { data: aiConfig, error: configError } = await supabase
    .from('secret_ai_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();
```

with:

```ts
  let aiConfig: { id: string; tenant_id: string; provider: string; model: string; endpoint_url: string | null; api_key: string } | null = null;
  let configError: unknown = null;

  const { data: rawConfig, error: rawConfigError } = await serviceSupabase
    .from('ai_config')
    .select('id, tenant_id, provider, model, endpoint_url, api_key_enc, key_version, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();
  configError = rawConfigError;

  if (rawConfig && !rawConfigError) {
    const { data: decrypted, error: decError } = await serviceSupabase.rpc('decrypt_with_version', {
      p_encrypted: rawConfig.api_key_enc,
      p_version: rawConfig.key_version,
    });
    if (decError || !decrypted) {
      configError = decError ?? new Error('decrypt failed');
    } else {
      aiConfig = {
        id: rawConfig.id,
        tenant_id: rawConfig.tenant_id,
        provider: rawConfig.provider,
        model: rawConfig.model,
        endpoint_url: rawConfig.endpoint_url,
        api_key: decrypted as string,
      };
    }
  }
```

Keep the `PLATFORM_OPENAI_KEY` fallback block unchanged (it runs when `!aiConfig && !configError`).

**Step 2: Repeat the same replacement in ai-quality.**

In `ai-quality/index.ts`, the config read is:

```ts
  const { data: aiConfig, error: configError } = await supabase
    .from('secret_ai_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();
```

Apply the identical service-role pattern (same code block as Step 1, with the same field names). Confirm the file's surrounding variable usage matches (`aiConfig?.api_key`, `aiConfig?.model`, etc.) with:

```powershell
rg -n "aiConfig" supabase/functions/ai-quality/index.ts
```

**Step 3: Verify.**

```powershell
deno check supabase/functions/ai-insights/index.ts
deno check supabase/functions/ai-quality/index.ts
```

Expected: no type errors.

**Step 4: Commit.**

```powershell
git add supabase/functions/ai-insights/index.ts supabase/functions/ai-quality/index.ts
git commit -m "fix(functions): read AI config via service role after secret-view role gating"
```

### Task 2.7: Phase 2 gate

- [ ] Run all function tests and the web build:

```powershell
cd supabase/functions/payment-webhook && deno test
pnpm typecheck
pnpm build:web
```

Expected: all pass.

---

## Phase 3: Web App Fixes

**Goal:** Close W1, S10, S11, D3, P7; single CSV helper.

### Task 3.1: Create shared CSV escaping helper and use it in every CSV route (S10)

**Files:**
- Create: `apps/web/lib/csv.ts`
- Create: `apps/web/lib/__tests__/csv.test.ts`
- Modify: `apps/web/app/api/[tenant]/reports/duty-hours.csv/route.ts`
- Modify: `apps/web/app/api/[tenant]/reports/evaluations.csv/route.ts`
- Modify: `apps/web/app/api/[tenant]/reports/specialty.csv/route.ts`
- Modify: `apps/web/app/api/[tenant]/reports/status.csv/route.ts`
- Modify: `apps/web/app/(authenticated)/[tenant]/audit/export/route.ts` (replace its local `escapeCsv`)

**Step 1: Write the helper.**

`apps/web/lib/csv.ts`:

```ts
export function escapeCsvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  let out = s;
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    out = '"' + s.replace(/"/g, '""') + '"';
  }
  // Neutralize spreadsheet formula injection for untrusted cell content.
  if (/^[=+\-@\t]/.test(out)) {
    out = "'" + out;
  }
  return out;
}
```

**Step 2: Write the test (TDD — write before wiring).**

`apps/web/lib/__tests__/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { escapeCsvCell } from '../csv';

describe('escapeCsvCell', () => {
  it('quotes values containing commas', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });
  it('doubles embedded quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes values with newlines', () => {
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
  it('neutralizes formula prefixes', () => {
    expect(escapeCsvCell('=cmd()')).toBe("'=cmd()");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('@x')).toBe("'@x");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
  });
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
  });
});
```

**Step 3: Run the test to see it pass (the helper already exists).**

```powershell
pnpm --filter @elogbook/web test -- lib/__tests__/csv.test.ts
```

Expected: 5/5 pass.

**Step 4: Rewrite the four CSV routes to use the helper.**

Pattern (applies to all four files): add the import `import { escapeCsvCell } from '@/lib/csv';`, then replace manual interpolation. Example — `duty-hours.csv/route.ts`, replace:

```ts
  const lines = ['Resident ID,Date,Hours Worked,Shift Type'];
  for (const r of (rows ?? [])) {
    lines.push(`"${r.resident_id}","${r.shift_date}",${r.hours_worked},"${r.shift_type}"`);
  }
```

with:

```ts
  const lines = ['Resident ID,Date,Hours Worked,Shift Type'];
  for (const r of (rows ?? [])) {
    lines.push([r.resident_id, r.shift_date, r.hours_worked, r.shift_type].map(escapeCsvCell).join(','));
  }
```

Apply the same transformation in:
- `evaluations.csv/route.ts` (fields: resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures, comments)
- `specialty.csv/route.ts` (`"${s}",${c}` → `[s, c].map(escapeCsvCell).join(',')`)
- `status.csv/route.ts` (same as specialty)

**Step 5: Replace the local `escapeCsv` in the audit page route.**

In `apps/web/app/(authenticated)/[tenant]/audit/export/route.ts`: delete the local `escapeCsv` function (lines ~22-28) and import `escapeCsvCell` from `@/lib/csv`. In `toCsv`, replace `escapeCsv(r[h])` with `escapeCsvCell(r[h])`.

**Step 6: Verify.**

```powershell
pnpm --filter @elogbook/web test
pnpm --filter @elogbook/web typecheck
```

Expected: all pass.

**Step 7: Commit.**

```powershell
git add apps/web/lib/csv.ts apps/web/lib/__tests__/csv.test.ts apps/web/app/api/[tenant]/reports apps/web/app/(authenticated)/[tenant]/audit/export/route.ts
git commit -m "fix(web): shared CSV escaping with formula-injection neutralization across all exports"
```

### Task 3.2: Escape HTML in audit export (S10)

**Files:**
- Modify: `apps/web/app/api/[tenant]/audit/export/route.ts`

**Step 1: Add the helper and apply it in `generateAuditHtml`.**

Add below the imports:

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

Replace:

```ts
  const rowsHtml = rows.map(r =>
    `<tr>${headers.map(h => `<td>${String((r as unknown as Record<string, unknown>)[h] ?? '')}</td>`).join('')}</tr>`
  ).join('\n      ');
```

with:

```ts
  const rowsHtml = rows.map(r =>
    `<tr>${headers.map(h => `<td>${escapeHtml(String((r as unknown as Record<string, unknown>)[h] ?? ''))}</td>`).join('')}</tr>`
  ).join('\n      ');
```

**Step 2: Add a unit test.**

`apps/web/app/api/[tenant]/audit/export/__tests__/html-escape.test.ts` — note `generateAuditHtml` is not exported. Export it for tests: change `function generateAuditHtml` to `export function generateAuditHtml` and add:

```ts
import { describe, it, expect } from 'vitest';
import { generateAuditHtml } from '../route';

describe('generateAuditHtml', () => {
  it('escapes HTML in audit values', () => {
    const html = generateAuditHtml([{
      id: '<script>alert(1)</script>',
      created_at: '2026-08-12',
      action: 'phi_view',
      resource_type: 'case_entry',
      resource_id: 'x&y',
      user_id: null,
      ip_address: '1.2.3.4',
    }] as never);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x&amp;y');
  });
});
```

**Step 3: Run tests.**

```powershell
pnpm --filter @elogbook/web test -- app/api/[tenant]/audit/export
```

Expected: existing audit-export tests + new test pass.

**Step 4: Commit.**

```powershell
git add apps/web/app/api/[tenant]/audit/export/route.ts apps/web/app/api/[tenant]/audit/export/__tests__/html-escape.test.ts
git commit -m "fix(web): HTML-escape audit export rows to prevent XSS"
```

### Task 3.3: Implement /api/contact with storage + rate limiting (S11)

**Files:**
- Create: `supabase/migrations/20260812170000_contact_submissions.sql`
- Modify: `apps/web/app/api/contact/route.ts`
- Create: `apps/web/app/api/contact/__tests__/route.test.ts`

**Step 1: Migration.**

```sql
-- 20260812170000_contact_submissions.sql
-- S11: the contact API was a fake-success stub. Store submissions in a
-- service_role-only table; platform staff read them via the dashboard/SQL.

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_submissions FORCE ROW LEVEL SECURITY;

-- No policies: default-deny for anon/authenticated; service_role bypasses RLS.
```

**Step 2: Rewrite the route.**

`apps/web/app/api/contact/route.ts` (replace the whole file):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Message too large' }, { status: 413 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const { allowed, retryAfter } = await checkRateLimit(`contact:${ip}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  let body: { name?: string; email?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim().slice(0, 200);
  const email = (body.email ?? '').trim().slice(0, 320);
  const message = (body.message ?? '').trim().slice(0, 5000);

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email and message are required' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from('contact_submissions').insert({ name, email, message });
  if (error) {
    return NextResponse.json({ error: 'Could not store message' }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: 'Thank you for your inquiry. We will respond within 1 business day.' });
}
```

**Step 3: Write the route test.**

`apps/web/app/api/contact/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit-redis';

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: (retryAfter: number) => new Response('Rate limited', { status: 429, headers: { 'retry-after': String(retryAfter) } }),
}));

const insertMock = vi.fn();

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: () => ({ insert: insertMock }),
  } as never);
  insertMock.mockReset();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  it('stores a valid submission', async () => {
    insertMock.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ name: 'Dr A', email: 'a@example.com', message: 'hello' }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith({ name: 'Dr A', email: 'a@example.com', message: 'hello' });
  });
  it('rejects missing fields', async () => {
    const res = await POST(makeRequest({ name: '', email: '', message: '' }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });
  it('rejects invalid email', async () => {
    const res = await POST(makeRequest({ name: 'Dr A', email: 'nope', message: 'x' }));
    expect(res.status).toBe(400);
  });
  it('rate limits by IP', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 60 });
    const res = await POST(makeRequest({ name: 'Dr A', email: 'a@example.com', message: 'x' }));
    expect(res.status).toBe(429);
  });
});
```

**Step 4: Run.**

```powershell
supabase db reset
pnpm --filter @elogbook/web test -- app/api/contact
pnpm --filter @elogbook/web typecheck
```

Expected: 4/4 tests pass; reset applies the new migration.

**Step 5: Commit.**

```powershell
git add supabase/migrations/20260812170000_contact_submissions.sql apps/web/app/api/contact/route.ts apps/web/app/api/contact/__tests__/route.test.ts
git commit -m "fix(web): store contact form submissions with validation and rate limiting"
```

### Task 3.4: Fix admin AI config read (D3)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`

**Step 1: Replace the broken select.**

Current (lines ~46-50):

```tsx
      supabase
        .from('ai_config')
        .select('id, tenant_id, provider, model, endpoint_url, is_active, encrypted_api_key')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
```

Replace `encrypted_api_key` with nothing sensitive:

```tsx
      supabase
        .from('ai_config')
        .select('id, tenant_id, provider, model, endpoint_url, is_active')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
```

Confirm with `rg -n "encrypted_api_key" apps/web` that no other web code reads the dropped column.

**Step 2: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
```

**Step 3: Commit.**

```powershell
git add apps/web/app/(authenticated)/[tenant]/admin/page.tsx
git commit -m "fix(web): drop reference to removed encrypted_api_key column in admin AI config read"
```

### Task 3.5: Remove dead @heroui reference (P7)

**Files:**
- Modify: `apps/web/next.config.mjs`

**Step 1:** Change line 26 from:

```js
    optimizePackageImports: ['@heroui/react', 'framer-motion', '@sentry/nextjs'],
```

to:

```js
    optimizePackageImports: ['framer-motion', '@sentry/nextjs'],
```

**Step 2: Verify.**

```powershell
pnpm build:web
```

Expected: build succeeds (identical output to before; the entry was a no-op).

**Step 3: Commit.**

```powershell
git add apps/web/next.config.mjs
git commit -m "chore(web): remove dead @heroui/react optimizePackageImports entry"
```

### Task 3.6: Remove broken evaluations "View" link (W1)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/evaluations/page.tsx`

**Step 1:** Replace the actions cell (lines ~275-282) — remove the `Link` entirely:

```tsx
                      <div className="flex items-center gap-1.5">
                        <span className="px-3 py-1.5 rounded-full text-xs font-medium text-text-muted">
                          {form.completed_at ? 'Completed' : 'In Progress'}
                        </span>
                      </div>
```

(The status is already shown in the previous column; keeping a non-link status text here preserves row rhythm. If the row grid has 5 columns, change `sm:grid-cols-[2fr_1fr_1fr_1fr_auto]` to `sm:grid-cols-[2fr_1fr_1fr_1fr]` and drop the last cell entirely — choose based on the actual file; the goal is **no link to a nonexistent route**.)

**Step 2: Verify no dead links remain.**

```powershell
rg -n "evaluations/\$\{form.id\}" apps/web
```

Expected: no matches.

**Step 3: Verify build.**

```powershell
pnpm --filter @elogbook/web typecheck
```

**Step 4: Commit.**

```powershell
git add apps/web/app/(authenticated)/[tenant]/evaluations/page.tsx
git commit -m "fix(web): remove link to nonexistent evaluation detail route"
```

### Task 3.7: Phase 3 gate

- [ ] Run:

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
```

Expected: all pass.

---

## Phase 4: Performance — Move Aggregation to SQL

**Goal:** Close P1–P4. Pages become thin wrappers over tenant-validated RPCs.

### Task 4.1: Dashboard — use resident_counts from get_dashboard_data (P1)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`
- Test: pgTAP already covers the RPC (Task 1.2); add a web type assertion below.

**Step 1: Update the `DashboardRpcResult` interface.**

Replace:

```tsx
interface DashboardRpcResult {
  stats: Record<CaseStatus, number>;
  recent_cases: {
    id: string;
    case_date: string;
    status: CaseStatus;
    template_name: string;
    template_specialty: string;
  }[];
  pending_approvals: number;
  total_residents: number;
}
```

with:

```tsx
interface DashboardRpcResult {
  stats: Record<CaseStatus, number>;
  recent_cases: {
    id: string;
    case_date: string;
    status: CaseStatus;
    template_name: string;
    template_specialty: string;
  }[];
  resident_counts: { resident_id: string; total: number; approved: number }[];
  pending_approvals: number;
  total_residents: number;
}
```

**Step 2: Delete the load-all-then-count block.**

Delete the entire block from `if (isDirectorPlus) {` (line ~162) through the closing of the residents mapping `}` (line ~191) — i.e., the `residentCaseCounts` fetch with `.limit(10000)` and the JS loops. Replace it with:

```tsx
  const residents: { id: string; full_name: string; specialty: string | null; total_cases: number; approved: number }[] = [];
  if (isDirectorPlus) {
    const residentProfiles = residentsDataResult.data;
    if (residentProfiles && residentProfiles.length > 0) {
      const counts = dashboard.resident_counts ?? [];
      const countsById = new Map(counts.map((c) => [c.resident_id, c]));
      for (const rp of residentProfiles) {
        const c = countsById.get(rp.id);
        residents.push({
          id: rp.id,
          full_name: rp.full_name,
          specialty: rp.specialty,
          total_cases: c?.total ?? 0,
          approved: c?.approved ?? 0,
        });
      }
    }
  }
```

Note the existing `let residents = [...]` declaration and the later `const` usage inside the JSX — unify: remove the old `let residents` line and use this `const residents` above it. Read the final file after editing and make sure `residents` is declared exactly once.

**Step 3: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/web test
```

Expected: pass. Also `rg -n "10000" apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx` → no matches.

**Step 4: Commit.**

```powershell
git add apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx
git commit -m "perf(web): compute per-resident dashboard counts in SQL instead of fetching all rows"
```

### Task 4.2: Analytics — new get_analytics_data RPC (P2)

**Files:**
- Create: `supabase/migrations/20260812180000_analytics_rpcs.sql`
- Create: `supabase/tests/p2_06_analytics_rpc.sql`
- Modify: `apps/web/app/(authenticated)/[tenant]/analytics/page.tsx`

**Step 1: Migration.**

```sql
-- 20260812180000_analytics_rpcs.sql
-- P2/P3: move analytics and report aggregation from the web layer into
-- tenant-validated SQL.

CREATE OR REPLACE FUNCTION public.get_analytics_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_from DATE := (CURRENT_DATE - INTERVAL '11 months')::DATE;
  v_monthly_volume JSONB;
  v_specialty JSONB;
  v_monthly_rate JSONB;
  v_workload JSONB;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant analytics access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_volume
  FROM (
    SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(c.cnt, 0) AS count
    FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS m
    LEFT JOIN (
      SELECT date_trunc('month', case_date)::DATE AS month, count(*) AS cnt
      FROM public.case_entries
      WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
      GROUP BY 1
    ) c ON c.month = m::DATE
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]'::jsonb) INTO v_specialty
  FROM (
    SELECT ct.specialty, count(*) AS count
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id AND ce.deleted_at IS NULL
    GROUP BY ct.specialty
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_rate
  FROM (
    SELECT m.month,
           COALESCE(round((a.approved::numeric / NULLIF(a.approved + a.rejected, 0)), 3), 0) AS rate
    FROM (
      SELECT to_char(m, 'YYYY-MM') AS month
      FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS m
    ) m
    LEFT JOIN (
      SELECT to_char(date_trunc('month', case_date)::DATE, 'YYYY-MM') AS month,
             count(*) FILTER (WHERE status = 'approved') AS approved,
             count(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM public.case_entries
      WHERE tenant_id = p_tenant_id AND deleted_at IS NULL
      GROUP BY 1
    ) a ON a.month = m.month
  ) t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.pending DESC), '[]'::jsonb) INTO v_workload
  FROM (
    SELECT ar.supervisor_id,
           count(*) FILTER (WHERE ar.status = 'pending')  AS pending,
           count(*) FILTER (WHERE ar.status = 'approved') AS approved,
           count(*) FILTER (WHERE ar.status = 'rejected') AS rejected,
           COALESCE(p.full_name, 'Unknown') AS supervisor_name
    FROM public.approval_requests ar
    LEFT JOIN public.profiles p ON p.id = ar.supervisor_id
    WHERE ar.tenant_id = p_tenant_id AND ar.supervisor_id IS NOT NULL
    GROUP BY ar.supervisor_id, p.full_name
  ) t;

  RETURN jsonb_build_object(
    'monthly_volume', v_monthly_volume,
    'specialty_breakdown', v_specialty,
    'monthly_approval_rate', v_monthly_rate,
    'supervisor_workload', v_workload
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_analytics_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_data(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_report_counts(
  p_tenant_id UUID,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status JSONB;
  v_specialty JSONB;
  v_eval JSONB;
  v_eval_count BIGINT;
  v_from TIMESTAMPTZ := NULLIF(p_date_from, '')::timestamptz;
  v_to TIMESTAMPTZ := NULLIF(p_date_to, '')::timestamptz;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
      RAISE EXCEPTION 'cross-tenant report access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'draft',    COALESCE(count(*) FILTER (WHERE status = 'draft'),    0),
    'pending',  COALESCE(count(*) FILTER (WHERE status = 'pending'),  0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_status
  FROM public.case_entries
  WHERE tenant_id = p_tenant_id
    AND deleted_at IS NULL
    AND (v_from IS NULL OR created_at >= v_from)
    AND (v_to IS NULL OR created_at <= v_to);

  SELECT COALESCE(jsonb_object_agg(specialty, count), '{}'::jsonb) INTO v_specialty
  FROM (
    SELECT ct.specialty, count(*) AS count
    FROM public.case_entries ce
    JOIN public.case_templates ct ON ct.id = ce.template_id
    WHERE ce.tenant_id = p_tenant_id
      AND ce.deleted_at IS NULL
      AND (v_from IS NULL OR ce.created_at >= v_from)
      AND (v_to IS NULL OR ce.created_at <= v_to)
    GROUP BY ct.specialty
  ) t;

  SELECT jsonb_build_object(
    'clinical', COALESCE(round(avg(clinical_skills)::numeric, 1), 0),
    'prof',     COALESCE(round(avg(professionalism)::numeric, 1), 0),
    'proc',     COALESCE(round(avg(procedures)::numeric, 1), 0)
  ), count(*)
  INTO v_eval, v_eval_count
  FROM public.faculty_evaluations
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'status_counts', v_status,
    'specialty_counts', v_specialty,
    'eval_averages', v_eval,
    'eval_count', v_eval_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) TO authenticated, service_role;
```

Note: `p_date_from`/`p_date_to` are plain `YYYY-MM-DD` strings from the UI query params; casting empty strings to NULL first. The UI passes `''` when unset — the NULLIF handles it.

**Step 2: pgTAP test.**

`supabase/tests/p2_06_analytics_rpc.sql`:

```sql
BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000061', 'Analytics Tenant', 'analytics-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000000', 'analytics@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000061';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000061', 'director', 'Analytics Director');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000061","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000061","user_role":"director"}}';

SELECT throws_ok(
  $$SELECT * FROM public.get_analytics_data('00000000-0000-0000-0000-000000000062')$$,
  '42501', NULL,
  'get_analytics_data rejects cross-tenant'
);
SELECT lives_ok(
  $$SELECT * FROM public.get_analytics_data('00000000-0000-0000-0000-000000000061')$$,
  'get_analytics_data works for own tenant'
);
ROLLBACK;
```

**Step 3: Run.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_06` 2/2 passes.

**Step 4: Rewrite the analytics page.**

Replace the whole `apps/web/app/(authenticated)/[tenant]/analytics/page.tsx` with:

```tsx
import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

interface AnalyticsRpcResult {
  monthly_volume: { month: string; count: number }[];
  specialty_breakdown: { specialty: string; count: number }[];
  monthly_approval_rate: { month: string; rate: number }[];
  supervisor_workload: {
    supervisor_id: string;
    pending: number;
    approved: number;
    rejected: number;
    supervisor_name: string;
  }[];
}

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');
  if (!['director', 'institution_admin', 'admin'].includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc('get_analytics_data', {
    p_tenant_id: auth.profile.tenant_id,
  });

  if (error) {
    throw new Error(`Analytics RPC failed: ${error.message}`);
  }

  const rpc = data as unknown as AnalyticsRpcResult;

  const supervisorWorkload = (rpc.supervisor_workload ?? []).map((w) => ({
    supervisorId: w.supervisor_id,
    supervisorName: w.supervisor_name,
    pending: w.pending,
    approved: w.approved,
    rejected: w.rejected,
  }));

  return (
    <AnalyticsDashboard
      data={{
        monthlyVolume: rpc.monthly_volume ?? [],
        specialtyBreakdown: rpc.specialty_breakdown ?? [],
        supervisorWorkload,
        monthlyApprovalRate: rpc.monthly_approval_rate ?? [],
      }}
    />
  );
}
```

Confirm the `AnalyticsDashboard` component's expected prop shapes match by reading `apps/web/components/AnalyticsDashboard.tsx` (its `data` prop keys must be exactly `monthlyVolume`, `specialtyBreakdown`, `supervisorWorkload`, `monthlyApprovalRate`; if different, adapt the object keys — the RPC keys stay as defined above).

**Step 5: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
pnpm build:web
```

**Step 6: Commit.**

```powershell
git add supabase/migrations/20260812180000_analytics_rpcs.sql supabase/tests/p2_06_analytics_rpc.sql apps/web/app/(authenticated)/[tenant]/analytics/page.tsx
git commit -m "perf: SQL-side analytics and report aggregation RPCs"
```

### Task 4.3: Reports page — use get_report_counts (P3)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`

**Step 1: Replace the aggregation queries.**

Delete `buildQuery`, the `Promise.all([...])` counts block, the `faculty_evaluations` fetch, `buildEntriesQuery`, the `entries` fetch, and the JS `specialtyCounts`/`statusCounts`/`evalStats` loops. Replace them with a single RPC call placed after `const tenantId = auth.tenant.id;`:

```tsx
  const { data: reportData, error: reportError } = await supabase.rpc('get_report_counts', {
    p_tenant_id: tenantId,
    p_date_from: date_from ?? '',
    p_date_to: date_to ?? '',
  });

  if (reportError) return <ErrorDisplay message={reportError.message} />;

  const rpc = reportData as unknown as {
    status_counts: Record<string, number>;
    specialty_counts: Record<string, number>;
    eval_averages: { clinical: number; prof: number; proc: number };
    eval_count: number;
  };

  const totalCount =
    (rpc.status_counts.draft ?? 0) + (rpc.status_counts.pending ?? 0) +
    (rpc.status_counts.approved ?? 0) + (rpc.status_counts.rejected ?? 0);
  const approvedCount = rpc.status_counts.approved ?? 0;
  const pendingCount = rpc.status_counts.pending ?? 0;
  const draftCount = rpc.status_counts.draft ?? 0;
  const statusCounts: Record<string, number> = {
    draft: rpc.status_counts.draft ?? 0,
    pending: rpc.status_counts.pending ?? 0,
    approved: rpc.status_counts.approved ?? 0,
    rejected: rpc.status_counts.rejected ?? 0,
  };
  const specialtyCounts: Record<string, number> = rpc.specialty_counts ?? {};
  const evalStats = {
    clinical: String(rpc.eval_averages?.clinical ?? 0),
    prof: String(rpc.eval_averages?.prof ?? 0),
    proc: String(rpc.eval_averages?.proc ?? 0),
  };
```

Keep the JSX unchanged below (it reads `totalCount`, `approvedCount`, `pendingCount`, `draftCount`, `specialtyCounts`, `statusCounts`, `evalStats`, `maxSpecialty`). Recompute `maxSpecialty` after the RPC:

```tsx
  const maxSpecialty = Math.max(1, ...Object.values(specialtyCounts));
```

The original file declared these as `const` before the JSX — place all declarations before the `return`.

**Step 2: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
pnpm build:web
```

**Step 3: Commit.**

```powershell
git add apps/web/app/(authenticated)/[tenant]/reports/page.tsx
git commit -m "perf(web): aggregate report counts in SQL via get_report_counts"
```

### Task 4.4: Compliance PHI-inventory counts exclude soft-deleted rows (P4)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/compliance/page.tsx`

**Step 1:** In `fetchPhiInventory` (lines ~129-144), add `.is('deleted_at', null)` to all three queries:

```tsx
    supabase
      .from('case_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .is('deleted_at', null),
    supabase
      .from('case_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_deidentified', false)
      .is('deleted_at', null),
    supabase
      .from('case_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_deidentified', true)
      .is('deleted_at', null),
```

**Step 2: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
```

**Step 3: Commit.**

```powershell
git add apps/web/app/(authenticated)/[tenant]/compliance/page.tsx
git commit -m "fix(web): exclude soft-deleted rows from PHI inventory counts"
```

### Task 4.5: Phase 4 gate

- [ ] Run:

```powershell
pnpm test:db
pnpm typecheck
pnpm test
pnpm build:web
```

Expected: all pass.

---

## Phase 5: Mobile Fixes + Light Offline Queue

**Goal:** Close M1–M7, deliver honest offline save. Mobile tests are pure-function Vitest tests (no RN testing lib — matches the existing pattern).

### Task 5.1: Fix duty-hours resident_id (M1)

**Files:**
- Modify: `apps/mobile/app/(tabs)/duty-hours.tsx`
- Create: `apps/mobile/app/__tests__/duty-hours.test.ts` (pure helper extraction)

**Step 1: Extract a pure builder for testability and fix the bug.**

Add a helper (top-level, above the component) and rewrite the save block. Replace lines ~38-57 (the profile query + insert) with:

```tsx
export function buildDutyPeriodPayload(
  profile: { id: string; tenant_id: string },
  date: Date,
  hours: string,
  shiftType: string,
  notes: string,
): {
  tenant_id: string;
  resident_id: string;
  shift_date: string;
  hours_worked: number;
  shift_type: string;
  notes: string | null;
} {
  return {
    tenant_id: profile.tenant_id,
    resident_id: profile.id,
    shift_date: date.toISOString().slice(0, 10),
    hours_worked: Number(hours),
    shift_type: shiftType,
    notes: notes || null,
  };
}
```

And in `handleSave`, replace the query/insert section:

```tsx
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, tenant_id')
      .eq('user_id', user.id)
      .single();

    if (!profile) {
      setSaving(false);
      Alert.alert('Error', 'Unable to save duty hours.');
      return;
    }

    const { error } = await supabase
      .from('duty_periods')
      .insert(buildDutyPeriodPayload(profile as { id: string; tenant_id: string }, date, hours, shiftType, notes));
```

(Note the select now includes `id`.)

**Step 2: Test.**

`apps/mobile/app/__tests__/duty-hours.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildDutyPeriodPayload } from '../duty-hours';

describe('buildDutyPeriodPayload', () => {
  it('uses the profile row id as resident_id, not undefined', () => {
    const payload = buildDutyPeriodPayload(
      { id: 'profile-1', tenant_id: 'tenant-1' },
      new Date('2026-08-12T10:00:00Z'),
      '8.5',
      'regular',
      '',
    );
    expect(payload.resident_id).toBe('profile-1');
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.shift_date).toBe('2026-08-12');
    expect(payload.hours_worked).toBe(8.5);
    expect(payload.notes).toBeNull();
  });
});
```

Note: `duty-hours.tsx` imports RN modules; the test file imports only the pure function, but Vitest still resolves the module. The existing `apps/mobile/vitest.config.ts` runs with node env and module mocking elsewhere; if importing the screen module fails (RN imports), move `buildDutyPeriodPayload` into `apps/mobile/lib/duty-payload.ts` and import it from both the screen and the test. Prefer the lib file approach to keep tests importable:

`apps/mobile/lib/duty-payload.ts`:

```ts
export function buildDutyPeriodPayload(
  profile: { id: string; tenant_id: string },
  date: Date,
  hours: string,
  shiftType: string,
  notes: string,
) {
  return {
    tenant_id: profile.tenant_id,
    resident_id: profile.id,
    shift_date: date.toISOString().slice(0, 10),
    hours_worked: Number(hours),
    shift_type: shiftType,
    notes: notes || null,
  };
}
```

Then the screen imports it. Test imports from `../../lib/duty-payload` (path from `app/__tests__/` is `../../lib/duty-payload`).

**Step 3: Run.**

```powershell
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/mobile typecheck
```

Expected: all pass.

**Step 4: Commit.**

```powershell
git add apps/mobile/lib/duty-payload.ts apps/mobile/app/(tabs)/duty-hours.tsx apps/mobile/app/__tests__/duty-hours.test.ts
git commit -m "fix(mobile): use profile row id as resident_id when logging duty hours"
```

### Task 5.2: Fix my-cases de-identified display (S14)

**Files:**
- Modify: `apps/mobile/app/(tabs)/my-cases.tsx`

**Step 1: Select `patient_hash` in the query (line ~112).**

Change:

```tsx
      .select('id, patient_mrn, patient_dob, case_date, status, is_deidentified, template_id, local_sync_status, case_templates(name, specialty)')
```

to:

```tsx
      .select('id, patient_mrn, patient_hash, patient_dob, case_date, status, is_deidentified, template_id, local_sync_status, case_templates(name, specialty)')
```

**Step 2: Map it (line ~115-125).** Add `patient_hash: entry.patient_hash` to the mapped object and to the `CaseData` interface (`patient_hash: string | null;`).

**Step 3: Fix the display line (line ~64).**

Replace:

```tsx
            {item.is_deidentified ? `Age: — Hash: ${item.patient_mrn?.slice(0, 12) ?? '—'}` : `MRN: ${item.patient_mrn}`}
```

with:

```tsx
            {item.is_deidentified ? `Hash: ${item.patient_hash?.slice(0, 12) ?? '—'}` : `MRN: ${item.patient_mrn}`}
```

**Step 4: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
rg -n "patient_mrn" apps/mobile/app/\(tabs\)/my-cases.tsx
```

Expected: `patient_mrn` remains only in the non-deidentified branch and the select list.

**Step 5: Commit.**

```powershell
git add apps/mobile/app/(tabs)/my-cases.tsx
git commit -m "fix(mobile): display patient_hash for de-identified cases instead of raw MRN"
```

### Task 5.3: Fix mobile approve/reject RPC call (M2)

**Files:**
- Modify: `apps/mobile/app/(tabs)/case-detail.tsx`
- Check: `apps/mobile/app/(tabs)/approvals.tsx`

**Step 1: Confirm the bug exists as described.**

```powershell
rg -n "approve_case|reject_case" apps/mobile/app/\(tabs\)/case-detail.tsx apps/mobile/app/\(tabs\)/approvals.tsx
```

**Step 2: Fix case-detail.**

In `handleApprovalAction` (lines ~128-150), replace the RPC call:

```tsx
        const { error } = await supabase.rpc(
          action === 'approve' ? 'approve_case' : 'reject_case',
          {
            p_entry_id: caseId,
            ...(action === 'reject' ? { p_comment: comment ?? '' } : {}),
          }
        );
```

with:

```tsx
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await supabase.rpc(
          action === 'approve' ? 'approve_case' : 'reject_case',
          {
            p_entry_id: caseId,
            p_supervisor_id: user.id,
            p_comment: action === 'reject' ? comment ?? '' : null,
          }
        );
```

(`approve_case`/`reject_case` accept `p_comment TEXT DEFAULT NULL` and require `p_supervisor_id = auth.uid()` — the web route `apps/web/app/api/[tenant]/approvals/action/route.ts:111-115` does exactly this.)

**Step 3: Fix approvals.tsx if needed.**

```powershell
rg -n -A 8 "approve_case|reject_case" apps/mobile/app/\(tabs\)/approvals.tsx
```

If the call omits `p_supervisor_id`, apply the same change: pass `p_supervisor_id: user.id` (fetch the user first with `supabase.auth.getUser()` if not already available in scope).

**Step 4: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/mobile test
```

**Step 5: Commit.**

```powershell
git add apps/mobile/app/(tabs)/case-detail.tsx apps/mobile/app/(tabs)/approvals.tsx
git commit -m "fix(mobile): pass p_supervisor_id to approve/reject RPCs"
```

### Task 5.4: Stop wiping biometric preference on login (M3)

**Files:**
- Modify: `apps/mobile/app/login.tsx`

**Step 1:** In the session-restore block (lines ~30-38) and the fresh-login block (lines ~68-84), remove the `setBiometricPreference(false).catch(console.error);` lines. Keep `clearBiometricAuthCache()` (that clears the in-memory 5-minute auth cache, which is correct on new login).

After the edit, both blocks look like:

```tsx
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        clearBiometricAuthCache();
        router.replace('/(tabs)');
      }
    });
  }, []);
```

and

```tsx
      // Clear biometric cache on fresh login
      clearBiometricAuthCache();
      router.replace('/(tabs)');
```

**Step 2: Remove the now-unused import if it becomes unused.**

```powershell
rg -n "setBiometricPreference" apps/mobile/app/login.tsx
```

Expected: no matches after the edit → delete the import line `import { setBiometricPreference } from '../lib/secure-store';`.

**Step 3: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
```

**Step 4: Commit.**

```powershell
git add apps/mobile/app/login.tsx
git commit -m "fix(mobile): preserve biometric opt-in across logins"
```

### Task 5.5: Fix profile id resolution (M6)

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx`

**Step 1:** Replace `const profileId = user.id;` (line ~57) with the JWT `app_metadata.profile_id` (same pattern as `index.tsx`):

```tsx
      const profileId = (user.app_metadata?.profile_id as string) ?? null;
```

Then update the DB fallback: if `profileId` is null, fall back to the profiles table lookup (which already happens for specialty — extend it). Ensure `id: profileId` is not set to a null into state: guard `if (!profileId) return;` after the fallback attempt.

Concretely replace the block:

```tsx
      const profileId = user.id;

      if (role && fullName && tenantId) {
        setProfile({
          id: profileId,
          full_name: fullName,
          role,
          specialty: null,
          tenant_id: tenantId,
        });
```

with:

```tsx
      const profileId = (user.app_metadata?.profile_id as string | null) ?? null;

      if (role && fullName && tenantId) {
        setProfile({
          id: profileId ?? '',
          full_name: fullName,
          role,
          specialty: null,
          tenant_id: tenantId,
        });
```

and in the existing DB fallback (which already sets `id: dbProfile.id` when found) keep it — it corrects a missing/empty id. Do not change anything else.

**Step 2: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
```

**Step 3: Commit.**

```powershell
git add apps/mobile/app/(tabs)/profile.tsx
git commit -m "fix(mobile): resolve profile id from JWT app_metadata instead of auth user id"
```

### Task 5.6: Compute patient_hash server-side on case submit (M5)

**Files:**
- Modify: `apps/mobile/app/(tabs)/log-case.tsx`
- Create: `apps/mobile/lib/__tests__/case-payload.test.ts` (pure helper)

**Step 1: Confirm the RPC signature.**

```powershell
rg -n -B 3 -A 12 "CREATE OR REPLACE FUNCTION public.hash_patient_mrn|CREATE FUNCTION public.hash_patient_mrn" supabase/migrations/00007_enterprise_upgrade.sql supabase/migrations/00011_critical_schema_fixes.sql supabase/migrations/00055_p2_batch_misc.sql
```

Read the confirmed parameter names (likely `p_mrn TEXT` and `p_tenant_id UUID`) and return type (TEXT). Use those exact names below. If the parameter names differ, substitute them everywhere in this task.

**Step 2: Extract a pure payload builder.**

`apps/mobile/lib/case-payload.ts`:

```ts
export interface CasePayloadInput {
  tenantId: string;
  residentId: string;
  templateId: string;
  patientMrn: string;
  patientDob: string;
  patientAge: string;
  caseDate: string;
  fieldValues: Record<string, string>;
  isDeidentified: boolean;
  status: 'pending' | 'draft';
  patientHash: string | null;
}

export function buildCasePayload(input: CasePayloadInput) {
  return {
    tenant_id: input.tenantId,
    resident_id: input.residentId,
    template_id: input.templateId,
    patient_mrn: input.isDeidentified ? null : input.patientMrn,
    patient_dob: input.isDeidentified ? null : input.patientDob,
    patient_age_years: input.isDeidentified ? Number(input.patientAge) || null : null,
    patient_hash: input.patientHash,
    case_date: input.caseDate,
    field_values: input.fieldValues,
    status: input.status,
    is_deidentified: input.isDeidentified,
  };
}
```

**Step 3: Wire the hash into handleSubmit in log-case.tsx.**

Replace the `caseData` construction (lines ~414-425) with:

```tsx
    let patientHash: string | null = null;
    if (!isDeidentified && patientMrn) {
      const { data: hashData, error: hashError } = await supabase.rpc('hash_patient_mrn', {
        p_mrn: patientMrn,
        p_tenant_id: profile.tenant_id,
      });
      if (hashError || !hashData) {
        setSubmitting(false);
        isSubmitting.current = false;
        setValidationError('Could not compute patient hash. Please try again.');
        return;
      }
      patientHash = hashData as string;
    }

    const caseData = buildCasePayload({
      tenantId: profile.tenant_id,
      residentId: profile.id,
      templateId: selectedTemplate.id,
      patientMrn,
      patientDob,
      patientAge,
      caseDate,
      fieldValues,
      isDeidentified,
      status,
      patientHash,
    });
```

(Add `import { buildCasePayload } from '../../lib/case-payload';`. The de-identified branch now submits `patient_hash: null` instead of the old validation-only `patient_hash: ''` at line 368 — update that `entryData` literal to `patient_hash: null as string | null` so the Zod schema, which you must check, matches. Confirm `caseEntrySchema` accepts `patient_hash` nullable by reading `packages/shared/src/schemas/cases.ts`; if the schema has no `patient_hash` field, `.safeParse` ignores extras in non-strict mode — verify with `rg -n "patient_hash" packages/shared/src/schemas/cases.ts` and adapt: only include fields the schema declares.)

**Step 4: Test the pure helper.**

`apps/mobile/lib/__tests__/case-payload.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCasePayload } from '../case-payload';

describe('buildCasePayload', () => {
  it('nulls out PHI when deidentified and carries the hash', () => {
    const p = buildCasePayload({
      tenantId: 't1', residentId: 'r1', templateId: 'tmpl1',
      patientMrn: '123456', patientDob: '1990-01-01', patientAge: '34',
      caseDate: '2026-08-12', fieldValues: { procedure: 'appendectomy' },
      isDeidentified: true, status: 'pending', patientHash: null,
    });
    expect(p.patient_mrn).toBeNull();
    expect(p.patient_dob).toBeNull();
    expect(p.patient_hash).toBeNull();
    expect(p.patient_age_years).toBe(34);
  });
  it('keeps PHI when identified', () => {
    const p = buildCasePayload({
      tenantId: 't1', residentId: 'r1', templateId: 'tmpl1',
      patientMrn: '123456', patientDob: '1990-01-01', patientAge: '',
      caseDate: '2026-08-12', fieldValues: {}, isDeidentified: false,
      status: 'draft', patientHash: 'h4sh',
    });
    expect(p.patient_mrn).toBe('123456');
    expect(p.patient_hash).toBe('h4sh');
    expect(p.patient_age_years).toBeNull();
  });
});
```

**Step 5: Verify.**

```powershell
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/mobile typecheck
```

**Step 6: Commit.**

```powershell
git add apps/mobile/lib/case-payload.ts apps/mobile/lib/__tests__/case-payload.test.ts apps/mobile/app/(tabs)/log-case.tsx
git commit -m "fix(mobile): compute server-salted patient_hash on submit"
```

### Task 5.7: Real encrypted offline queue (M4, M12)

**Files:**
- Create: `apps/mobile/lib/offline-queue.ts`
- Create: `apps/mobile/lib/__tests__/offline-queue.test.ts`
- Modify: `apps/mobile/app/(tabs)/log-case.tsx` (replace fake offline path)
- Modify: `apps/mobile/lib/sync.ts` (flush queue on reconnect/foreground)
- Modify: `apps/mobile/package.json` (add dependency)

**Step 1: Add the dependency.**

```powershell
pnpm --filter @elogbook/mobile add crypto-js
pnpm --filter @elogbook/mobile add -D @types/crypto-js
```

(Verify versions resolve; `crypto-js` is pure JS and works in RN/Hermes. After install, run `pnpm audit --filter @elogbook/mobile` — the pinned `brace-expansion`/`minimatch` overrides in `.pnpmfile.cjs` must still hold.)

**Step 2: Write the queue module.**

`apps/mobile/lib/offline-queue.ts`:

```ts
// Light offline queue: encrypted case payloads stored in AsyncStorage.
// Each item is AES-256-CBC encrypted with the SecureStore-backed device key
// (lib/db/encryption-key.ts) and a fresh random IV. Flushed on reconnect /
// app foreground via SyncService.initSync.
import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';
import * as Crypto from 'expo-crypto';
import { getOrCreateDbEncryptionKey } from './db/encryption-key';
import { supabase } from './supabase';

export const OFFLINE_QUEUE_KEY = 'offline_case_queue_v1';

export interface QueuedCasePayload {
  id: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

export type QueueCaseData = Record<string, unknown>;

function uuidv4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function readQueue(): Promise<QueuedCasePayload[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedCasePayload[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedCasePayload[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueCase(caseData: QueueCaseData): Promise<void> {
  const key = await getOrCreateDbEncryptionKey();
  const ivBytes = await Crypto.getRandomBytesAsync(16);
  const ivHex = Array.from(ivBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(caseData), key, {
    iv: CryptoJS.enc.Hex.parse(ivHex),
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString();

  const items = await readQueue();
  items.push({ id: uuidv4(), iv: ivHex, ciphertext, createdAt: Date.now() });
  await writeQueue(items);
}

export async function getPendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export interface FlushResult {
  synced: number;
  failed: number;
  lastError: string | null;
}

export async function flushQueue(): Promise<FlushResult> {
  const items = await readQueue();
  if (items.length === 0) return { synced: 0, failed: 0, lastError: null };

  const key = await getOrCreateDbEncryptionKey();
  const remaining: QueuedCasePayload[] = [];
  let synced = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const item of items) {
    try {
      const plaintext = CryptoJS.AES.decrypt(item.ciphertext, key, {
        iv: CryptoJS.enc.Hex.parse(item.iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }).toString(CryptoJS.enc.Utf8);
      const caseData = JSON.parse(plaintext) as QueueCaseData;
      const { error } = await supabase.from('case_entries').insert(caseData);
      if (error) {
        // Network/transient errors: keep the item for a later retry.
        // RLS/validation errors are permanent for this payload: drop it.
        const isTransient = /network|fetch|timeout|abort|connect/i.test(error.message);
        if (isTransient) remaining.push(item);
        failed++;
        lastError = error.message;
      } else {
        synced++;
      }
    } catch {
      // Decrypt/parse failure = corrupted item; drop it so the queue drains.
      failed++;
      lastError = 'corrupted queue item dropped';
    }
  }

  await writeQueue(remaining);
  return { synced, failed, lastError };
}
```

**Step 3: Write the tests.**

`apps/mobile/lib/__tests__/offline-queue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    },
  };
});
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => new Uint8Array(n).fill(7),
}));
vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { store.set(k, v); },
    deleteItemAsync: async (k: string) => { store.delete(k); },
  };
});
vi.mock('../supabase', () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueCase, readQueue, getPendingCount, flushQueue, OFFLINE_QUEUE_KEY } from '../offline-queue';

beforeEach(async () => {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
});

describe('offline queue', () => {
  it('encrypts payloads at rest', async () => {
    await enqueueCase({ patient_mrn: 'SECRET-MRN', tenant_id: 't1' });
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('SECRET-MRN');
    expect(await getPendingCount()).toBe(1);
  });
  it('flushes items and clears the queue', async () => {
    await enqueueCase({ tenant_id: 't1', status: 'draft' });
    const result = await flushQueue();
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(await readQueue()).toHaveLength(0);
  });
});
```

**Step 4: Wire the queue into log-case.tsx.**

Replace the fake offline catch blocks (both the edit branch ~441-446 and the insert branch ~464-468) with a real enqueue. In the insert catch:

```tsx
    } catch (err) {
      const supabaseError = (err as { message?: string })?.message ?? '';
      const isNetworkError = /network|fetch|timeout|abort/i.test(supabaseError);
      if (isNetworkError) {
        try {
          await enqueueCase(caseData);
          haptics.offlineSave();
          setConfirmationSuccess(false);
          confirmationTypeRef.current = 'offline';
          setShowConfirmation(true);
        } catch {
          setValidationError('Could not save this case. Check your connection and try again.');
        }
      } else {
        setValidationError('Could not save this case. Please try again.');
      }
    }
```

Same pattern for the edit branch: on network error enqueue the update payload as a new draft insert (the update cannot be queued safely — queue an insert of the edited case data with status `'draft'`), with the same confirmation modal. Update the modal subtitle text (line ~584): `'Will sync when online'` is now accurate — keep it. Change the `AUTO_SAVE_KEY` draft removal (line ~459) to also remove the draft on successful submit (it already does — keep).

Add the import: `import { enqueueCase } from '../../lib/offline-queue';`

**Step 5: Flush on reconnect/foreground.**

In `apps/mobile/lib/sync.ts`, make `initSync` flush the queue (it currently warns). Replace the stub body:

```ts
  async initSync(_tenantId?: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }
```

with:

```ts
  async initSync(_tenantId?: string) {
    // WatermelonDB full sync remains disabled (UXM-001). The light offline
    // queue IS live: flush encrypted queued cases when we have a session.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const result = await flushQueue();
      if (result.synced > 0) {
        this.setStatus('synced');
        this.emitStatus();
      }
      if (result.failed > 0 && result.lastError) {
        this.partialFailureMessage = result.lastError;
        this.consumePartialFailure();
      }
    } catch {
      // stay quiet; next periodic tick retries
    }
  }
```

Add the import: `import { flushQueue } from './offline-queue';`

**Step 6: Verify.**

```powershell
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/mobile lint
```

Expected: all pass. Existing `sync.push.test.ts` and `sync.tenant.test.ts` must still pass (the stubs they assert on are unchanged; only `initSync` changed — check those tests' expectations about `initSync` and adjust only if they explicitly assert the old warn behavior; if they do, update them to mock `offline-queue`).

**Step 7: Commit.**

```powershell
git add apps/mobile/lib/offline-queue.ts apps/mobile/lib/__tests__/offline-queue.test.ts apps/mobile/app/(tabs)/log-case.tsx apps/mobile/lib/sync.ts apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): encrypted offline case queue with honest saved-offline UX"
```

### Task 5.8: Remove intentional startup error (M7)

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

**Step 1:** Delete line 155 (`useEffect(() => { initDatabase().catch(console.error); }, []);`) and the now-unused `initDatabase` import (line 32). Keep `lib/db/*` files untouched (future v2).

**Step 2: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/mobile lint
```

**Step 3: Commit.**

```powershell
git add apps/mobile/app/_layout.tsx
git commit -m "fix(mobile): stop throwing OfflineStorageDisabledError at every launch"
```

### Task 5.9: Phase 5 gate

- [ ] Run:

```powershell
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/mobile lint
pnpm test:db
```

Expected: all pass.

## Phase 6: Push Notifications

**Goal:** Replace reliance on 60s polling with real push for approval events. Scope: approval lifecycle only (`case.approved`, `case.rejected`, `approval.pending`).

### Task 6.1: push_tokens migration (M14)

**Files:**
- Create: `supabase/migrations/20260812160000_push_tokens.sql`
- Create: `supabase/tests/p2_07_push_tokens_rls.sql`

**Step 1: Migration.**

```sql
-- 20260812160000_push_tokens.sql
-- M14/P6: device push tokens for Expo push notifications.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON public.push_tokens (user_id) WHERE active;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY push_tokens_own ON public.push_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND tenant_id = get_tenant_id());
```

Notes: service_role bypasses RLS (needed by the web dispatcher `lib/notifications.ts`, which runs server-side with the user/server client — the web dispatcher will switch to the service client in Task 6.4).

**Step 2: pgTAP test.**

`supabase/tests/p2_07_push_tokens_rls.sql`:

```sql
BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000071', 'Push Tenant', 'push-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000000', 'push-a@example.com'),
  ('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000000', 'push-b@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000071', 'resident', 'Push A'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072', 'resident', 'Push B');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000071","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000071","user_role":"resident"}}';

SELECT lives_ok(
  $$INSERT INTO public.push_tokens (tenant_id, user_id, token, platform)
    VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000071', 'ExponentPushToken[test-a]', 'android')$$,
  'user can register their own push token'
);
SELECT throws_ok(
  $$INSERT INTO public.push_tokens (tenant_id, user_id, token, platform)
    VALUES ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000072', 'ExponentPushToken[test-b]', 'android')$$,
  NULL,
  'user cannot register a token for another user'
);
ROLLBACK;
```

**Step 3: Run.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_07` 2/2 passes.

**Step 4: Commit.**

```powershell
git add supabase/migrations/20260812160000_push_tokens.sql supabase/tests/p2_07_push_tokens_rls.sql
git commit -m "feat(db): push_tokens table with owner-only RLS"
```

### Task 6.2: Mobile push registration

**Files:**
- Create: `apps/mobile/lib/push.ts`
- Create: `apps/mobile/lib/__tests__/push.test.ts` (pure mapping helpers)
- Modify: `apps/mobile/app.json` (add expo-notifications plugin)
- Modify: `apps/mobile/app/_layout.tsx` (register + configure + token upsert + badge reset)

**Step 1: Add the plugin to app.json.**

In `apps/mobile/app.json`, add `"expo-notifications"` to the `plugins` array (after `"expo-font",`):

```json
      "expo-font",
      "expo-notifications",
```

**Step 2: Write lib/push.ts.**

```ts
// Push notification registration + foreground presentation for the
// approval lifecycle. Uses the push_tokens table (Task 6.1).
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export interface PushRegistration {
  ok: boolean;
  error: string | null;
}

export function notificationPayloadToBadgeIncrement(
  type: string | undefined,
): number {
  return type === 'case.approved' || type === 'case.rejected' || type === 'approval.pending' ? 1 : 0;
}

export async function configureForegroundNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

export async function registerPushToken(): Promise<PushRegistration> {
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return { ok: false, error: 'permission denied' };

    const projectId = Constants.easConfig?.projectId;
    if (!projectId) return { ok: false, error: 'missing EAS project id' };

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'no session' };

    const tenantId = (user.app_metadata?.tenant_id as string) ?? null;
    if (!tenantId) return { ok: false, error: 'no tenant' };

    const { error } = await supabase.from('push_tokens').upsert(
      {
        tenant_id: tenantId,
        user_id: user.id,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function clearBadge(): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // non-fatal
  }
}
```

**Step 3: Wire into _layout.tsx.**

In `apps/mobile/app/_layout.tsx`:
- Import: `import { registerPushToken, configureForegroundNotifications, clearBadge } from '../lib/push';`
- Add an effect that runs once authenticated:

```tsx
  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    configureForegroundNotifications();
    registerPushToken().catch(() => undefined);
    clearBadge();
  }, [authLoading, isAuthenticated]);
```

- Remove the duplicate notification-navigation wiring (M9): delete the `useNotificationNavigation()` call (line ~157) AND the `useNotificationNavigation` import, keeping `registerNotificationHandler()`-style wiring via **one** path. The root already imports `handleColdStartNotification` nowhere — currently `useNotificationNavigation` handles tap + cold start. Replace line ~157 with:

```tsx
  useEffect(() => {
    const unsubscribe = registerNotificationHandler();
    handleColdStartNotification();
    return unsubscribe;
  }, []);
```

and add the imports `import { registerNotificationHandler, handleColdStartNotification } from '../lib/notification-handler';`. Delete `hooks/useNotificationNavigation.ts`? **No** — deleting is Task 8.6 cleanup; for now just stop using it.

**Step 4: Pure-helper test.**

`apps/mobile/lib/__tests__/push.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { notificationPayloadToBadgeIncrement } from '../notification-payload';

describe('notificationPayloadToBadgeIncrement', () => {
  it('returns 1 for approval events', () => {
    expect(notificationPayloadToBadgeIncrement('case.approved')).toBe(1);
    expect(notificationPayloadToBadgeIncrement('case.rejected')).toBe(1);
    expect(notificationPayloadToBadgeIncrement('approval.pending')).toBe(1);
  });
  it('returns 0 for anything else', () => {
    expect(notificationPayloadToBadgeIncrement('deep.link')).toBe(0);
    expect(notificationPayloadToBadgeIncrement(undefined)).toBe(0);
  });
});
```

The helper lives in `apps/mobile/lib/notification-payload.ts` (pure, no imports) and `push.ts` re-exports it — see below.

```ts
export function notificationPayloadToBadgeIncrement(
  type: string | undefined,
): number {
  return type === 'case.approved' || type === 'case.rejected' || type === 'approval.pending' ? 1 : 0;
}
```

`push.ts` re-exports: `export { notificationPayloadToBadgeIncrement } from './notification-payload';` — and the test imports from `../notification-payload`.

**Step 5: Verify.**

```powershell
pnpm --filter @elogbook/mobile test
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/mobile expo prebuild --clean
```

Expected: tests/typecheck pass; prebuild completes (validates the notifications plugin config).

**Step 6: Commit.**

```powershell
git add apps/mobile/lib/push.ts apps/mobile/lib/notification-payload.ts apps/mobile/lib/__tests__/push.test.ts apps/mobile/app.json apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): register Expo push tokens and unify notification navigation"
```

### Task 6.3: Web dispatcher — service client + existing senders

**Files:**
- Modify: `apps/web/lib/notifications.ts`

**Step 1:** `sendPushNotification` currently uses `createServerSupabase()` (user session context — in API routes this is the caller's session, which cannot read other users' tokens). Switch the token lookup and deactivation writes to the service client:

Replace the top of `sendPushNotification`:

```ts
  const supabase = await createServerSupabase();
```

with:

```ts
  const supabase = createServiceRoleClient();
```

And change the import from `import { createServerSupabase } from '@/lib/supabase/server';` to `import { createServiceRoleClient } from '@/lib/supabase/admin';`.

**Step 2: Unit test for the send function.**

`apps/web/lib/__tests__/notifications.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPushNotification } from '../notifications';
import { createServiceRoleClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

const updateMock = vi.fn();

beforeEach(() => {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({
            data: table === 'push_tokens' ? [{ token: 'ExponentPushToken[abc]' }] : null,
            error: null,
          }),
        }),
      }),
      update: () => ({ in: updateMock }),
    }),
  } as never);
  updateMock.mockResolvedValue({ error: null });
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok', to: 'ExponentPushToken[abc]' }] }), { status: 200 }));
});

describe('sendPushNotification', () => {
  it('POSTs to the Expo push API with the stored token', async () => {
    await sendPushNotification('user-1', { title: 't', body: 'b', data: { type: 'case.approved', caseId: 'c1' } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

**Step 3: Run.**

```powershell
pnpm --filter @elogbook/web test -- lib/__tests__/notifications.test.ts
pnpm --filter @elogbook/web typecheck
```

Expected: pass.

**Step 4: Commit.**

```powershell
git add apps/web/lib/notifications.ts apps/web/lib/__tests__/notifications.test.ts
git commit -m "fix(web): push dispatcher reads tokens via service role"
```

### Task 6.4: Fire pushes from approval + submit routes

**Files:**
- Modify: `apps/web/app/api/[tenant]/approvals/action/route.ts`
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts`

**Step 1: approvals/action route.** The profile select must include the reviewer's name for the push body — change line ~46 from:

```ts
    .select('id, tenant_id, role, tenants!inner(slug)')
```

to:

```ts
    .select('id, tenant_id, role, full_name, tenants!inner(slug)')
```

After the successful `notifications` insert (the `await supabase.from('notifications').insert({...})` block, lines ~124-133), add (fire-and-forget):

```ts
  // Push notification to the resident (fire-and-forget; failures are logged).
  notifyCaseApproval(entry_id, entry.resident_id, approved ? 'approved' : 'rejected', profile.full_name)
    .catch((err) => console.error('[push] approval push failed:', err));
```

Add the import: `import { notifyCaseApproval } from '@/lib/notifications';`

**Step 2: cases/[id]/submit route.** After the supervisor fan-out insert (search the file for `approval_requests` insert), add for each supervisor:

```ts
  notifyPendingApproval(entryId, supervisorRow.supervisor_id, profile.full_name)
    .catch((err) => console.error('[push] pending-approval push failed:', err));
```

First read the file to confirm variable names (`entryId`, `supervisorRow`, `profile`):

```powershell
rg -n "approval_requests|supervisor|resident_name|full_name" "apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts"
```

Use the actual local variable names in the call — do not invent them. Add `import { notifyPendingApproval } from '@/lib/notifications';`.

**Step 3: Verify.**

```powershell
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/web test
```

Expected: all pass (existing route tests must still pass — the new calls are mocked-away/no-ops because `notify*` catches internally; if a test asserts exact fetch calls, update it).

**Step 4: Commit.**

```powershell
git add "apps/web/app/api/[tenant]/approvals/action/route.ts" "apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts"
git commit -m "feat(web): dispatch Expo push notifications on approval and submit"
```

### Task 6.5: Phase 6 gate

- [ ] Run:

```powershell
pnpm test:db
pnpm --filter @elogbook/web test
pnpm --filter @elogbook/mobile test
pnpm typecheck
pnpm build:web
```

Expected: all pass.

---

## Phase 7: AI Clinical Reflection GA

**Goal:** Close S8 (atomic quota), keep safety guardrails, add tests. Scope: `ai-insights` only.

### Task 7.1: Atomic quota consumption in ai-insights (S8)

**Files:**
- Create: `supabase/migrations/20260812150000_release_ai_quota.sql`
- Create: `supabase/tests/p2_08_ai_quota_release.sql`
- Modify: `supabase/functions/ai-insights/index.ts`

**Step 1: Migration (release path for provider failures).**

```sql
-- 20260812150000_release_ai_quota.sql
-- S8 companion: consume_ai_quota() is atomic; when the provider call fails
-- after consumption, release the reservation.

CREATE OR REPLACE FUNCTION public.release_ai_quota(
  p_resident_id UUID,
  p_count INT DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_owner_profile_id UUID;
  v_new_used INT;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;

  SELECT id INTO v_owner_profile_id FROM public.profiles WHERE user_id = v_actor_id LIMIT 1;
  IF v_owner_profile_id IS NULL OR v_owner_profile_id != p_resident_id THEN
    IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('error', 'cannot release quota for another resident', 'code', 'forbidden');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.resident_ai_toggle r
      WHERE r.resident_id = p_resident_id
        AND r.tenant_id = get_tenant_id()
    ) THEN
      RETURN jsonb_build_object('error', 'cross-tenant quota release', 'code', 'forbidden');
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
     SET quota_used = GREATEST(0, quota_used - p_count),
         updated_at = now()
   WHERE resident_id = p_resident_id
   RETURNING quota_used INTO v_new_used;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'resident not found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'ok', 'quota_used', v_new_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_ai_quota(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(UUID, INT) TO authenticated;
```

**Step 2: pgTAP test.**

`supabase/tests/p2_08_ai_quota_release.sql`:

```sql
BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000081', 'AI Tenant', 'ai-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000000', 'ai-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000081';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000081', 'resident', 'AI Resident');

INSERT INTO resident_ai_toggle (tenant_id, resident_id, enabled, quota_limit, quota_used)
VALUES ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000103', true, 20, 5)
ON CONFLICT (tenant_id, resident_id) DO UPDATE SET quota_used = 5;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000081","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000081","user_role":"resident"}}';

SELECT is(
  (SELECT (public.consume_ai_quota('00000000-0000-0000-0000-000000000103', 1)->>'quota_used')::int),
  6,
  'consume increments quota atomically'
);
SELECT is(
  (SELECT (public.release_ai_quota('00000000-0000-0000-0000-000000000103', 1)->>'quota_used')::int),
  5,
  'release decrements quota back'
);
ROLLBACK;
```

**Step 3: Run.**

```powershell
supabase db reset
pnpm test:db
```

Expected: `p2_08` 2/2 passes.

**Step 4: Rewire ai-insights quota logic.**

In `supabase/functions/ai-insights/index.ts`, replace the read-only check block (lines ~241-260, the `resident_ai_toggle` select + the two early returns) with a consume-after-generation flow:

- Delete the `aiToggle` select block and both early returns (the "not enabled" 403 and the "quota exceeded" 429).
- Right **before** the provider call (where the AI request is about to be made), call:

```ts
  const { data: quota, error: quotaError } = await supabase.rpc('consume_ai_quota', {
    p_resident_id: resident_id,
    p_count: 1,
  });
  if (quotaError || !quota || (quota as { code?: string }).code !== 'ok') {
    return new Response(
      JSON.stringify({ error: 'AI query quota exceeded or AI is disabled' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } },
    );
  }
```

- Wrap the provider call in try/catch: on provider failure, release:

```ts
  try {
    // ... existing provider call ...
  } catch (providerErr) {
    await supabase.rpc('release_ai_quota', { p_resident_id: resident_id, p_count: 1 });
    throw providerErr;
  }
```

Identify the exact provider call block with:

```powershell
rg -n "fetch|stream|provider|OpenAI|api_key" supabase/functions/ai-insights/index.ts
```

Keep the DB rate-limit check (`checkRateLimitDb`) exactly where it is (it limits frequency, the quota RPC limits volume — different knobs).

**Step 5: Add a Deno unit test for the quota gate.**

If `ai-insights` has no existing test file, create `supabase/functions/ai-insights/index.test.ts` testing the exported `sanitizeQuery` and `checkSafety` helpers (export them for tests):

```ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { sanitizeQuery, checkSafety } from './index.ts';

Deno.test('sanitizeQuery strips control characters and truncates', () => {
  assertEquals(sanitizeQuery('  hello\x00world  '), 'hello world');
  assertEquals(sanitizeQuery('x'.repeat(2000)).length, 1000);
});

Deno.test('checkSafety flags diagnosis/prescription/prognosis patterns', () => {
  const flags = checkSafety('The patient is diagnosed with diabetes and we recommend medication');
  assertEquals(flags.includes('blocked_diagnosis'), true);
});
```

Export `sanitizeQuery` and `checkSafety` (add `export` keyword) if they are module-private. Confirm the exact std assert import version used elsewhere in the repo (`rg -n "deno.land/std" supabase/functions`); match it.

**Step 6: Run.**

```powershell
cd supabase/functions/ai-insights && deno test
```

Expected: tests pass.

**Step 7: Commit.**

```powershell
git add supabase/migrations/20260812150000_release_ai_quota.sql supabase/tests/p2_08_ai_quota_release.sql supabase/functions/ai-insights/index.ts supabase/functions/ai-insights/index.test.ts
git commit -m "feat(functions): atomic AI quota consumption with release on provider failure"
```

### Task 7.2: Phase 7 gate

- [ ] Run:

```powershell
cd supabase/functions/ai-insights && deno test
pnpm test:db
pnpm typecheck
```

Expected: all pass.

---

## Phase 8: Compliance Artifacts, Cleanup, Launch Gate

### Task 8.1: Wire real compliance contacts

**Files:**
- Modify: `docs/compliance/security-overview.md`

**Step 1:** Replace the placeholder contacts (`security@example.com`, `+1-555-000-9999`) with the production values. If no real address exists yet, the deployer must create the mailbox **before launch** and fill it in. Also replace "Draft — not certified" banners with an accurate status (do not claim certification). Add one line: "AI features are de-identified-only by policy (ai-insights rejects identified cases — 403)."

**Step 2: Verify.**

```powershell
rg -n "example.com|555-000" docs/compliance
```

Expected: no matches.

**Step 3: Commit.**

```powershell
git add docs/compliance/security-overview.md
git commit -m "docs(compliance): real security contact and honest certification status"
```

### Task 8.2: Region/framework defaults in seed

**Files:**
- Modify: `supabase/seed.sql`

**Step 1:** Confirm the seed already covers ACGME + GMC frameworks (`00089`, `00090` migrations). For SCFHS, add a seed row to `accreditation_frameworks`:

```sql
INSERT INTO accreditation_frameworks (tenant_id, name, version, framework_type, milestones)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'SCFHS Competency Framework',
  '1.0',
  'scfhs',
  '[]'::jsonb
)
ON CONFLICT DO NOTHING;
```

First check `accreditation_frameworks` columns (is there a UNIQUE constraint on (tenant_id, framework_type)?):

```powershell
rg -n -A 15 "CREATE TABLE.*accreditation_frameworks" supabase/migrations/00007_enterprise_upgrade.sql
```

If a UNIQUE constraint exists on `(tenant_id, framework_type)`, use `ON CONFLICT (tenant_id, framework_type) DO NOTHING;` — use the confirmed constraint columns.

**Step 2: Verify.**

```powershell
supabase db reset
```

Expected: reset succeeds.

**Step 3: Commit.**

```powershell
git add supabase/seed.sql
git commit -m "feat(db): seed SCFHS accreditation framework for global templates"
```

### Task 8.3: Backup + retention runbook check

**Files:** none (verification only)

- [ ] Confirm the retention cron and backups are scheduled per `docs/backup-strategy.md` and `docs/operations/backup-drill.md`. Run a dry-run backup:

```powershell
bash scripts/backup-db.sh --dry-run
```

Expected: script prints the pg_dump command without executing. If `bash` is unavailable on Windows, run in WSL/Git Bash and record the result.

- [ ] Verify `mark_stripe_event_failed`/stripe_events monitoring: confirm the `stripe_events` table receives rows on webhook errors (deploy + test after Task 2.1 ships). Record as a post-deploy verification item in the launch checklist (§15).

### Task 8.4: Conservative Supabase auth hardening

**Files:**
- Modify: `supabase/config.toml`

**Step 1:** Add an `[auth]` section with conservative-but-safe values:

```toml
[auth.session]
time_validity = "3600"
```

Do **not** add `enable_confirmations` in this task (it changes signup flow behavior; adding it is a product decision — leave the default off unless the launch checklist requires it). Do **not** set `site_url` in config.toml (it affects auth email links; production email settings live in the Supabase dashboard).

**Step 2: Verify.**

```powershell
supabase start
supabase status
```

Expected: starts cleanly; `supabase status` shows Auth API healthy. (Local CLI honors config.toml for the auth service.)

**Step 3: Commit.**

```powershell
git add supabase/config.toml
git commit -m "chore(supabase): conservative session timeout and signup config"
```

### Task 8.5: Mobile Sentry DSN from env (M10)

**Files:**
- Modify: `apps/mobile/sentry.config.ts`
- Modify: `apps/mobile/eas.json`

**Step 1:** In `sentry.config.ts`, read the DSN from `process.env.SENTRY_DSN` instead of `app.json extra.sentryDsn`:

Confirm current line first:

```powershell
rg -n "sentryDsn|example@sentry" apps/mobile/sentry.config.ts apps/mobile/app.json
```

Then in `sentry.config.ts` replace the DSN source with:

```ts
const dsn = process.env.SENTRY_DSN;
if (!dsn || dsn.includes('example@sentry.io')) {
  throw new Error('SENTRY_DSN must be set for sourcemap upload');
}
```

Match the surrounding file style (it may already export a config object; adapt minimally).

**Step 2:** In `eas.json`, remove the hardcoded `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` from all three profiles (they are already injected by CI secrets in `deploy-mobile.yml` — confirm with `rg -n "EXPO_PUBLIC_SUPABASE" .github/workflows/deploy-mobile.yml`; if CI does NOT pass them, add `env:` entries in the workflow instead of eas.json). Add `SENTRY_DSN` to the GitHub Actions secrets used by `deploy-mobile.yml` (or to EAS project secrets) so the build-time sourcemap upload has a real DSN. Replace `"extra": { "sentryDsn": "https://example@sentry.io/0" }` in `apps/mobile/app.json` with the runtime-only approach — delete the `sentryDsn` extra key (runtime already uses `EXPO_PUBLIC_SENTRY_DSN`).

**Step 3: Verify.**

```powershell
pnpm --filter @elogbook/mobile typecheck
rg -n "example@sentry|sb_publishable" apps/mobile/eas.json apps/mobile/app.json
```

Expected: no matches in eas.json/app.json.

**Step 4: Commit.**

```powershell
git add apps/mobile/sentry.config.ts apps/mobile/eas.json apps/mobile/app.json
git commit -m "fix(mobile): strip placeholder Sentry DSN and hardcoded keys from build config"
```

### Task 8.6: Dead-code cleanup (explicit allow-list only)

Delete **only** the files/entries listed here. Do not delete anything else.

- [ ] Web:
  - Delete `apps/web/lib/supabase/pagination.ts` (unused cursor helper; offset pagination remains).
  - Delete `apps/web/lib/performance.ts` (beacons to nonexistent `/api/metrics`).
  - Delete `apps/web/lib/sso.ts` (SSO login disabled) **only if** no test imports it — check `rg -n "lib/sso" apps/web`. If `lib/__tests__/sso.test.ts` exists, delete it too (it tests dead code).
  - Add `*.tsbuildinfo` to `.gitignore` and `git rm --cached apps/web/tsconfig.tsbuildinfo`.
- [ ] Mobile:
  - Delete `apps/mobile/hooks/useNotificationNavigation.ts` (replaced by `lib/notification-handler.ts` in Task 6.2).
  - Delete `apps/mobile/components/AppleCard.tsx` (unused) and `apps/mobile/theme/design-tokens.ts` **only if** `rg -n "design-tokens|AppleCard" apps/mobile --glob '!theme/**' --glob '!components/AppleCard.tsx'` shows no imports.
  - Delete `apps/mobile/lib/analytics.ts` and `apps/mobile/lib/performance.ts` **only if** no imports remain (`rg -n "lib/analytics|lib/performance" apps/mobile --glob '!lib/analytics.ts' --glob '!lib/performance.ts'` → expect no matches).
  - Delete `apps/mobile/lib/today-stats.ts` offline dead branch? **No** — keep the file; only its docstring is stale. Fix the docstring instead: change the "falls back to local WatermelonDB records" comment to "offline: returns empty stats (local storage deferred)".

**Verify after deletions:**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
```

Expected: all pass. Any deletion that breaks a test must be reverted and reported.

**Commit.**

```powershell
git add -A
git commit -m "chore: remove dead code allow-listed in launch plan"
```

### Task 8.7: Full verification suite (the launch gate)

Run **every** gate in order and record results:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint:all
pnpm test
supabase db reset
pnpm test:db
pnpm build:web
pnpm security:scan
cd supabase/functions/payment-webhook && deno test
cd supabase/functions/ai-insights && deno test
pnpm --filter @elogbook/web test:e2e
```

Expected: all pass. `security:scan` = `pnpm audit --prod --audit-level=high` + Trivy CRITICAL gate (Trivy requires Docker — if unavailable, run the audit half and record the Trivy step as post-deploy CI).

If any gate fails, fix only what that gate flags, re-run **that** gate, then continue. Do not skip.

### Task 8.8: Final commit + changelog

- [ ] Update `CHANGELOG.md` with a `## [Launch v3]` entry listing the fixed findings by ID (S1–S15, D1–D5, P1–P4, W1, M1–M7) and the new features (offline queue, push, AI quota GA).
- [ ] Commit:

```powershell
git add CHANGELOG.md
git commit -m "docs: changelog for launch v3 hardening and features"
```

---

## 15. Launch Checklist (post-implementation, post-deploy)

1. `supabase db push --linked --include-all` against production; confirm all new migrations apply cleanly.
2. Deploy the 9 edge functions (cd.yml `functions` job).
3. Vercel production deploy from `main`.
4. EAS production build for Android (`eas build --platform android --profile production`); TestFlight/Play internal track.
5. Stripe: create test-mode checkout for an individual tenant → verify `payment-webhook` resolves the tenant via `metadata.tenant_id`, subscription row appears, payment row appears with status `completed`. Then live-mode with a real card (sandbox tenant).
6. Verify `stripe_events` receives rows on simulated failure (Task 8.3).
7. Push: send a test approval from a supervisor → resident device receives push, tap navigates to case detail, badge increments.
8. Offline queue: airplane mode → log case → "Saved Offline" → reconnect → case appears in My Cases.
9. Retention cron: run `SELECT enforce_data_retention();` once manually via SQL editor as postgres; confirm audit row with `resource_type = 'retention_purge'`.
10. Compliance: `docs/compliance/security-overview.md` contacts are live; consent banner + consent_records working; PHI inventory excludes soft-deleted rows.
11. Monitoring: Sentry DSN set for web + mobile; PostHog consent-gated; alerting on `global-error` and edge function errors.
12. Backup: daily `backup.yml` workflow running; restore drill executed once (see `docs/operations/backup-drill.md`).

---

## 16. Appendix A — Command Quick Reference

| Command | Purpose |
|---|---|
| `pnpm typecheck` | TS across all packages |
| `pnpm lint:all` | ESLint web + mobile |
| `pnpm test` | Vitest web + mobile |
| `supabase db reset` | local DB migrations + seed |
| `pnpm test:db` | pgTAP suite |
| `pnpm build:web` | production web build |
| `deno test` (in a function dir) | edge function tests |
| `pnpm security:scan` | audit + Trivy |
| `pnpm --filter @elogbook/web test:e2e` | Playwright suite |
| `supabase db push --linked --include-all` | push migrations to prod |
| `supabase functions deploy <name>` | deploy one edge function |

## 17. Appendix B — Deliberately Deferred (do NOT implement in launch)

- SSO (SAML/OIDC) and SCIM: stubs remain; admin CRUD UI exists but login flow is disabled.
- Full WatermelonDB offline sync engine + SQLCipher (UXM-001, SEC-006, SEC-007) — the light queue is the launch offline story.
- Institution billing (`institution_billing`), enterprise webhook billing flows beyond the Stripe fix.
- `ai-quality` / `ai-gap-analysis` GA (both remain supervisor-only experimental; only CORS + config-read fixes landed).
- Benchmarking UI (`benchmark_data`/`benchmark_mv` exist, no UI).
- CSV streaming for very large exports (1000-row caps remain).
- Per-tenant Stripe keys in `create-portal-session` (platform `STRIPE_SECRET_KEY` only).
- `tenant_storage_usage_mb` view tightening (D7).
- Mobile screen-level render tests (`@testing-library/react-native`).
- `scripts/patch-renderer-version.js` removal (M11).
- Cross-tenant admin switcher (`lib/supabase/auth.ts` TODO P6.x).

## 18. Appendix C — Finding → Task Traceability

| Finding ID | Task | Phase |
|---|---|---|
| S1 | 1.1 (+2.6 consumer fix) | 1, 2 |
| S2 / D4 / D5 | 1.2 | 1 |
| S3 | 1.3 (+5.1 app fix) | 1, 5 |
| S4 / S5 | 1.4 | 1 |
| S12 | 1.5 | 1 |
| S6 / D1 / D2 | 2.1 | 2 |
| S7 | 2.2 | 2 |
| S9 | 2.4 | 2 |
| S13 | 2.5 | 2 |
| S10 | 3.1, 3.2 | 3 |
| S11 | 3.3 | 3 |
| D3 | 3.4 | 3 |
| P7 | 3.5 | 3 |
| W1 | 3.6 | 3 |
| P1 | 4.1 | 4 |
| P2 | 4.2 | 4 |
| P3 | 4.3 | 4 |
| P4 | 4.4 | 4 |
| M1 | 5.1 | 5 |
| S14 / M15-adjacent | 5.2 | 5 |
| M2 | 5.3 | 5 |
| M3 | 5.4 | 5 |
| M6 | 5.5 | 5 |
| M5 | 5.6 | 5 |
| M4 / M12 / M13 | 5.7 | 5 |
| M7 | 5.8 | 5 |
| M14 | 6.1, 6.3, 6.4 | 6 |
| M9 | 6.2 | 6 |
| S8 | 7.1 | 7 |
| M10 | 8.5 | 8 |
| P5 (dead code) | 8.6 | 8 |
| D9 | 8.4 | 8 |
| D6, D7, D8, D10(covered by new tests), P6, W2-W10, M8, M11, M15, M16 | documented, deferred or covered | — |
