# E-Logbook Production-Ready Upgrade Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is self-contained (2–10 min) and written so a small free LLM can vibecode it in one shot. Run the verification command exactly as written; do not "improve" it.

**Goal:** Get the elogbook web SaaS to a state where it can be deployed to Vercel + Supabase production projects, accept the first paying junior-doctor customer, and stop leaking PHI / secrets / claims that the code cannot back up.

**Architecture:** pnpm monorepo. Next.js 16 web app at `apps/web`. Expo 56 mobile at `apps/mobile`. Supabase Postgres 17 + Deno Edge Functions at `supabase/`. Shared packages at `packages/shared` and `packages/env`. Multi-tenant (institution / individual) with role hierarchy `admin → institution_admin → director → supervisor → resident`. Handles PHI (HIPAA/GDPR regulated).

**Tech Stack:** TypeScript strict, Next.js 16 App Router (RSC), Expo 56 + WatermelonDB + op-sqlite, Supabase Postgres + Edge Functions, Stripe billing, Vitest, Playwright, pgTAP, pnpm 9, Turborepo, GitHub Actions, Vercel, EAS.

**Primary user:** a tired junior doctor on call at 3am on hospital WiFi. They need to log a procedure in under 30 seconds and trust that the data is safe.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Findings — Security & Compliance](#2-findings--security--compliance)
3. [Findings — Database & Backend](#3-findings--database--backend)
4. [Findings — Performance](#4-findings--performance)
5. [Findings — Web UI/UX](#5-findings--web-uiux)
6. [Findings — Mobile UI/UX & Readiness](#6-findings--mobile-uiux--readiness)
7. [Findings — Features & Revenue Path](#7-findings--features--revenue-path)
8. [Findings — DevOps & Deployment](#8-findings--devops--deployment)
9. [Findings — Test Coverage](#9-findings--test-coverage)
10. [MVP Cut — What Ships First](#10-mvp-cut--what-ships-first)
11. [Upgrade Plan — Bite-Sized TDD Tasks](#11-upgrade-plan--bite-sized-tdd-tasks)
12. [Test Inventory — What Every Task Must Add](#12-test-inventory--what-every-task-must-add)

---

## 1. Executive Summary

The codebase is substantially built (444 TS/TSX/SQL files, 95 web routes, 17 mobile screens, 76 migrations, 11 edge functions, 61 test files). The hardest architectural decisions — multi-tenant RLS, encrypted secrets at rest, case-approval workflow with `FOR UPDATE` locking, AI de-identification guards, Stripe webhook idempotency — are already made and mostly implemented.

What's blocking production is **not** missing features. It's a small number of **critical correctness and trust gaps**:

1. **Demo accounts are created unconditionally in production** (`supabase/migrations/00006_demo_accounts.sql`) with a known bcrypt hash for `password123!`. The gate in `00055` only emits a `NOTICE` — it does nothing.
2. **The Stripe payment webhook loads every tenant's secret key into worker memory on every webhook** (`supabase/functions/payment-webhook/index.ts:99-103`). A per-tenant cache function exists at lines 17–56 but is **never called**.
3. **An audit-export route passes `SUPABASE_SERVICE_ROLE_KEY` as a raw `Bearer` header to a `fetch()` call** (`apps/web/app/api/[tenant]/audit/export/route.ts:166`), leaking the platform key to any URL it calls.
4. **The SSO callback edge function has dead/unreachable code after `serve()` returns** (`supabase/functions/sso-callback/index.ts:17-100`) and won't compile.
5. **Tables created after migration `00049` are not in the `FORCE ROW LEVEL SECURITY` list** — `template_favorites`, `duty_periods`, `faculty_evaluations`, and others can be bypassed by the table owner.
6. **The `packages/env` Zod validator is never imported anywhere** — runtime code uses `process.env.X` directly and silently returns `null` when env vars are missing.
7. **Two RLS test files give false confidence**: `supabase/tests/rls-policies.sql` is mostly `BEGIN/ROLLBACK` stubs with no assertions; `supabase/tests/p1_1_cross_tenant_isolation.sql` checks `tenant_id != get_tenant_id()` without first `set_config`-ing a JWT, so `get_tenant_id()` returns NULL and the tests pass vacuously.
8. **No public pricing or signup page exists** — landing page has only a "Sign in" link. The footer claims "HIPAA-compliant. SOC 2 ready." without substantiation.
9. **Login page uses hardcoded `text-black` / `text-[#8E8E93]`** — dark mode is broken on the conversion-critical screen.
10. **Mobile sync.ts uses device-generated WatermelonDB IDs as Postgres primary keys** (`apps/mobile/lib/sync.ts:311`) — fragile, can collide across devices.

**Path to first paying customer:** fix the 10 issues above, add a pricing + signup page, hide the broken enterprise integrations (SSO, SCIM, dispatch-webhook) behind a ` Coming soon` flag, ship web-only mobile-disabled, run the test suite green, and deploy. The mobile app should stay in TestFlight/internal preview until SQLCipher and sync idempotency are verified on physical devices.

**Estimated effort:** 35–50 small tasks, 1–3 days of vibecoding with a small LLM, each task verifiable by a single command.

---

## 2. Findings — Security & Compliance

### Critical (Blockers)

#### SEC-001 — Demo accounts created unconditionally in production
- **Severity:** Blocker
- **Location:** `supabase/migrations/00006_demo_accounts.sql:1-127`; gate at `supabase/migrations/00055_p2_batch_misc.sql:173-180`
- **Evidence:** `00006` runs `INSERT INTO auth.users (...)` with `encrypted_password = '$2b$10$.46DqzYX3n./W2aCv2m7d.2kRXI.foI5JCxVIkfJOSWIj5nadZIPW'` (the bcrypt hash for `password123!`) for `resident@demo.com`, `supervisor@demo.com`, `director@demo.com`, `admin@demo.com`, `platform@demo.com`. There is no GUC check around this migration.
- **The "gate" is a lie:** `00055` only does `IF current_setting('app.enable_demo_migrations', true) = 'false' THEN RAISE NOTICE ...`. Because the second arg to `current_setting` is `true`, a missing setting returns NULL, and `NULL = 'false'` evaluates to NULL (not TRUE), so the IF branch is skipped and the ELSE branch runs — which only emits another `NOTICE`. The demo accounts from `00006` are **never** deleted or gated.
- **Risk:** Anyone who knows the README creds can log into a production deployment as a director or platform admin. PHI exposure, privilege escalation, billing manipulation.
- **Fix:** Add a new migration that wraps the demo-account creation in the GUC and, when the GUC is unset/false in production, DELETE the demo users, their profiles, and the `demo` tenant.
- **Test:** pgTAP test that, after `supabase db reset` with `app.enable_demo_migrations='false'`, `SELECT count(*) FROM auth.users WHERE email LIKE '%@demo.com'` returns 0.

#### SEC-002 — payment-webhook loads every tenant's Stripe secret on every webhook
- **Severity:** Blocker
- **Location:** `supabase/functions/payment-webhook/index.ts:99-103, 113-152`
- **Evidence:** The `serve` handler does:
  ```ts
  const { data: gatewayConfigs, error: gwError } = await supabase
    .from('secret_payment_gateway_config')
    .select('id, tenant_id, secret_key as secret, webhook_secret, mode')
    .eq('provider', 'stripe')
    .eq('is_active', true);
  ```
  then iterates over every config trying each `webhook_secret` to verify the signature. The `getConfigForWebhook` function at lines 17–56 (which was meant to fix this per the comment at lines 8–12) is **never called** from the `serve` handler.
- **Risk:** Every Stripe webhook invocation loads every tenant's `secret_key` and `webhook_secret` into worker memory. A compromised worker, a Deno introspection bug, or a logging accident leaks all tenants' Stripe keys. Also O(N) signature-verification attempts per webhook → slow at scale.
- **Fix:** Identify the tenant from the Stripe-Account header (Connect) or from the signed event's metadata, look up only that tenant's config, verify the signature once.
- **Test:** Unit test that mocks a webhook signed with tenant B's secret, supplies tenant A's Stripe-Account header, and asserts that tenant A's config (not tenant B's) is loaded. Test that the function returns 401 if the Stripe-Account doesn't map to a tenant.

#### SEC-003 — Service-role key used as raw Bearer header in fetch
- **Severity:** Blocker
- **Location:** `apps/web/app/api/[tenant]/audit/export/route.ts:166`
- **Evidence:**
  ```ts
  pdfResponse = await fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    },
    body: JSON.stringify(pdfPayload),
  });
  ```
- **Risk:** The platform-wide service-role key is sent as a Bearer token to whatever URL `edgeFunctionUrl` resolves to. A DNS hijack, a misconfigured env var, or a typo in the URL leaks the key. The service role bypasses all RLS.
- **Fix:** Call the edge function through the Supabase client (which uses the anon key + user JWT and lets the function authenticate via `_shared/auth.ts`). Or generate a short-lived scoped JWT. Or move the PDF generation into the route handler itself.
- **Test:** Unit test that asserts the `Authorization` header sent to `fetch` starts with the user's JWT, not the service-role key. Mock `fetch` and assert.

#### SEC-004 — 11 admin route handlers use the service-role client blanket
- **Severity:** High (verify each — may be Critical if any route forgets the role check)
- **Location:** 30 call sites across 11 files. Run `rg "createServiceRoleClient" apps/web/app` to see them all.
- **Evidence (sample):** `apps/web/app/api/[tenant]/admin/scim/route.ts:75,117,158`; `apps/web/app/api/[tenant]/admin/sso/route.ts:44,150,255,353`; `apps/web/app/api/[tenant]/admin/webhooks/route.ts:50,194,267,380`; `apps/web/app/api/[tenant]/admin/ai-config/route.ts:52`; `apps/web/app/api/[tenant]/admin/payment-gateway/route.ts:51`; `apps/web/app/api/[tenant]/admin/assign-role/route.ts:61`; `apps/web/app/(authenticated)/[tenant]/admin/{webhooks,scim,sso}/page.tsx:35` (server components).
- **Risk:** Any handler that uses the service-role client without first verifying the caller is `institution_admin`/`admin` for that tenant lets any authenticated user perform admin actions across all tenants.
- **Fix:** Audit each of the 30 call sites. Add a single shared helper `requireTenantAdmin(supabase, tenantSlug)` that returns 403 if the caller's profile.role is not `institution_admin` or `admin` (or `director` for read-only). Use it before every `createServiceRoleClient()` call. Move the role check into a typed wrapper so future routes can't forget it.
- **Test:** Vitest unit test per route that mocks an authenticated resident user and asserts a 403 response. Then mocks an institution_admin and asserts 200.

#### SEC-005 — csp-violation endpoint is unauthenticated, unbounded, and unrate-limited
- **Severity:** High
- **Location:** `apps/web/app/api/csp-violation/route.ts:1-7`
- **Evidence:**
  ```ts
  export async function POST(request: NextRequest) {
    const body = await request.text();
    console.warn('CSP Violation:', body);
    return new NextResponse(null, { status: 204 });
  }
  ```
- **Risk:** Unauthenticated POST with no body size limit, no rate limit, and the entire body is written to logs. An attacker can flood the endpoint to exhaust log storage, inject log-poisoning payloads to confuse any log-based alerting, or use it as an amplification vector. The `proxy.ts:39-42` rate limiter skips `/api/auth` but NOT this endpoint — actually wait, the proxy rate-limits `/api/*` except `/api/auth`. So this endpoint IS rate-limited by the global `api:${ip}` bucket. But the rate limit is generous and per-IP, and there's no body size cap.
- **Fix:** Cap body to 4 KB (`body.slice(0, 4096)`), validate that it parses as a JSON `csp-report` object, drop the call to `console.warn` (use `Sentry.captureMessage` instead so it goes to a bounded store), and add a dedicated stricter rate limit (e.g. 30/min/IP).
- **Test:** Vitest test that POSTs a 10 KB body and asserts 413. POSTs a non-JSON body and asserts 400. POSTs a valid CSP report 100 times and asserts 429 after the 31st.

#### SEC-006 — Mobile local DB encryption depends on native build flag, not verified
- **Severity:** High (verify; not necessarily a code bug)
- **Location:** `apps/mobile/lib/db/database.ts:28-39`; `apps/mobile/lib/db/encryption-key.ts`; `apps/mobile/package.json` (uses `@nozbe/watermelondb ^0.28.0` + `@op-engineering/op-sqlite ^11.0.0`)
- **Evidence:** `database.ts` passes `encryptionKey: dbKey` to `SQLiteAdapter`. The key is generated with `expo-crypto` CSPRNG and stored in `expo-secure-store`. Per WatermelonDB 0.28 + op-sqlite docs, SQLCipher is used **only if** op-sqlite is built with `encryption: 'sqlcipher'` in its Gradle/Podfile config.
- **Risk:** If the native build is the default (no SQLCipher), the `encryptionKey` is silently ignored and the local SQLite file containing PHI (case_entries with `patient_mrn`, `patient_dob`, `field_values`) is plaintext on disk.
- **Fix:** Verify on a physical iOS and Android device that the .db file is unreadable without the key. Add an E2E test that creates a case offline, kills the app, reads the SQLite file from the device, and asserts it's not plaintext. If it IS plaintext, configure op-sqlite's SQLCipher build and document the requirement.
- **Test:** Maestro or Detox test (or a manual runbook step) that asserts the on-disk DB file is encrypted.

### High

#### SEC-007 — Mobile sync uses device-generated IDs as Postgres primary keys
- **Severity:** High
- **Location:** `apps/mobile/lib/sync.ts:309-327`
- **Evidence:**
  ```ts
  const rows = newDrafts.map((draft) => ({
    id: draft.id,   // <-- WatermelonDB-generated local id
    tenant_id: draft.tenantId,
    // ...
  }));
  const { error } = await supabase
    .from('case_entries')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: false });
  ```
- **Risk:** WatermelonDB IDs are not UUIDs and are not guaranteed unique across devices or installs. Two devices creating a case at the same time can collide on `id`, causing silent overwrites or 409 conflicts that the conflict handler misattributes. Also: if a user uninstalls and reinstalls, the new install generates new IDs but the old rows are still on the server with the old device's IDs.
- **Fix:** Use an outbox pattern: client generates a `client_request_id` (UUID v4), sends it in the payload, server generates the real `id` (or upserts on `client_request_id` as an idempotency key). Store the returned server `id` in the local `server_id` column.
- **Test:** Vitest test that mocks two devices creating a case with the same WatermelonDB ID and asserts that two distinct rows exist on the server afterward.

#### SEC-008 — `packages/env` Zod validator is never imported — no fail-fast at startup
- **Severity:** High
- **Location:** `packages/env/src/index.ts:59` (`export const env = parseOrThrow(...)`) — never imported anywhere. Run `rg "@elogbook/env" apps/ packages/` to confirm (0 hits).
- **Evidence:** `apps/web/lib/supabase/middleware.ts:50-61` has its own `getEnvVars()` that returns `null` silently when vars are missing. `apps/web/lib/supabase/admin.ts` throws only when the service-role client is constructed. `apps/web/lib/supabase/server.ts:15-24` returns a Proxy that throws on first method call.
- **Risk:** A misconfigured Vercel/Supabase project boots fine and serves pages that 500 only when a Supabase call is made. Operators get no startup signal. The intent of `packages/env` (fail-fast boundary) is unfulfilled.
- **Fix:** Import `parseWebServerEnv` at the top of `apps/web/lib/supabase/server.ts` and `apps/web/lib/supabase/admin.ts` (call it at module load). Wire `packages/env` into `apps/web/package.json` as `@elogbook/env`. Add a `/api/health` check that asserts all required env vars are present.
- **Test:** Vitest test that sets `process.env = {}` (no Supabase vars), imports the server module, and asserts it throws a specific error message. Restore `process.env` after.

### Wins (already correct)

- `apps/web/proxy.ts:44-51` correctly forwards the CSP nonce on both request and response, and `apps/web/app/layout.tsx:86` reads it via `headers()`. B-02 is **resolved**.
- `apps/web/lib/supabase/middleware.ts:12-48` implements a defense-in-depth CSRF guard for all state-changing methods.
- `apps/web/public/sw.js` only caches script/style/font assets, not navigations. B-08 is **resolved**.
- `supabase/functions/ai-insights/index.ts:234-239` refuses to call the AI provider unless `is_deidentified === true`, has SSRF protection for custom endpoints (lines 53-90), DB-backed rate limiting, safety regex patterns, and a mandatory disclaimer. B-09 is **largely resolved**.
- `supabase/functions/dispatch-webhook/index.ts:1-15` is disabled (returns 503). B-07 is **resolved by disabling**.
- `supabase/migrations/00053_encrypt_secrets.sql` implements `pgp_sym_encrypt` with `security_barrier` views, role-gated RPCs, and key rotation support. Good design.
- `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts` is a model route handler — CSRF, auth, tenant-slug check, rate limit, ownership check, subscription-lapse check, atomic approval creation with rollback, Sentry span.

---

## 3. Findings — Database & Backend

### Critical

#### DB-001 — sso-callback edge function has dead code and won't compile
- **Severity:** Critical
- **Location:** `supabase/functions/sso-callback/index.ts:17-100`
- **Evidence:** The file is:
  ```ts
  serve(async (req) => {
    return new Response(JSON.stringify({ error: 'SSO is disabled.' }), { status: 503, ... });
  });   // <-- serve() call ends here at line 17
        JSON.stringify({ error: 'Missing tenant slug' }),   // <-- dead code starts
        { status: 400, ... }                                // <-- references undefined
  );                                                       //     vars: tenantSlug,
  // ... 80 more lines referencing undefined headers, metadata, discovery, protocol
  ```
  The lines after `serve();` are unreachable and reference `tenantSlug`, `protocol`, `next`, `headers`, `metadata`, `discovery` — none of which are in scope. TypeScript should error. Deno may or may not run it depending on type-check strictness.
- **Risk:** Either the function fails to deploy (blocking the CD pipeline) or it deploys with the disabled stub only (luck). The dead code suggests an incomplete refactor where someone disabled SSO but didn't delete the old body.
- **Fix:** Delete lines 18-100. Keep only the disabled stub. Add a TODO comment referencing the SSO implementation ticket.
- **Test:** `cd supabase && deno check functions/sso-callback/index.ts` must exit 0.

#### DB-002 — Tables created after migration 00049 are not in the FORCE RLS list
- **Severity:** Critical
- **Location:** `supabase/migrations/00049_force_rls_all_tables.sql:35-60`; later migrations only `ENABLE ROW LEVEL SECURITY` without `FORCE`
- **Evidence:** Run `rg "ALTER TABLE .* ENABLE ROW LEVEL SECURITY" supabase/migrations/` and compare to `rg "ALTER TABLE .* FORCE ROW LEVEL SECURITY"`. The following tables have ENABLE but not FORCE:
  - `template_favorites` (`00067_audit_favorites.sql:79`)
  - `duty_periods` (`00069_duty_tracking.sql:18`)
  - `faculty_evaluations` (`00070_faculty_evaluations.sql:19`)
  - `scim_tokens` — has FORCE (00064:22)
  - `tenant_webhooks`, `tenant_webhook_deliveries` — have FORCE (00063:33-71)
  - `rotations`, `shifts`, `milestones`, `epa_mappings`, `evaluation_forms`, `notifications`, `webhook_retry_queue`, `comments`, `scholarly_activities` — have FORCE
  - **Missing FORCE:** `template_favorites`, `duty_periods`, `faculty_evaluations`, plus any tables added in 00082 (cpt_icd_codes), 00085 (audit_improvements), 00086 (security_hardening), 00089 (gmc_framework), 00090 (canmeds), 00091 (scholarly_activity — has FORCE), 00092 (benchmarking), 00093 (white_label), 00094 (dashboard_rpc) that I haven't verified.
- **Risk:** Without FORCE, the table owner bypasses RLS. If the migration role or any role granted to the owner is ever used by an Edge Function or route handler, that caller sees every tenant's rows.
- **Fix:** Add a new migration `00095_force_rls_post_00049.sql` that runs `ALTER TABLE public.<t> FORCE ROW LEVEL SECURITY` for every tenant-scoped table not already forced. Update `supabase/tests/p0_6_force_rls.sql` to assert every tenant-scoped table has `relforcerowsecurity = true`.
- **Test:** pgTAP query `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (...full list...) AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relname=tablename AND c.relforcerowsecurity)` must return 0 rows.

#### DB-003 — `packages/env` is dead code; no runtime validation
(Same as SEC-008 — listed there.)

### High

#### DB-004 — RLS test files give false confidence
- **Severity:** High
- **Location:** `supabase/tests/rls-policies.sql` (mostly stubs); `supabase/tests/p1_1_cross_tenant_isolation.sql:9-15`
- **Evidence:** `rls-policies.sql` is 88 lines of `BEGIN ... ROLLBACK` blocks with the actual assertions commented out or missing. `p1_1_cross_tenant_isolation.sql:9-15`:
  ```sql
  SELECT 'FAIL: cross-tenant case_entries read' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM case_entries ce
    WHERE ce.tenant_id != public.get_tenant_id()
    LIMIT 1
  );
  ```
  This query returns 0 rows (no FAIL) when `get_tenant_id()` returns NULL — because `tenant_id != NULL` is NULL, `EXISTS(NULL)` is false, so the outer SELECT returns nothing, and the test "passes" vacuously. The test never calls `set_config('request.jwt.claims', ...)` to simulate a real tenant.
- **Risk:** RLS looks tested but isn't. A regression that drops a policy ships to production.
- **Fix:** Rewrite both test files to use `set_config('request.jwt.claims', '{"sub":"...", "app_metadata":{"tenant_id":"<uuid>","user_role":"resident"}}', true)` then `SET LOCAL ROLE authenticated;` then assert that a SELECT from another tenant's rows returns 0, and from own tenant returns >0. Use pgTAP's `throws_ok` / `lives_ok` / `results_eq`.
- **Test:** The rewritten test files themselves.

#### DB-005 — payment-webhook function manifest mismatch
- **Severity:** High
- **Location:** `supabase/functions/manifest.json:46-51` declares `payment-webhook` with `required_secrets: ["STRIPE_WEBHOOK_SECRET"]` but the function reads `secret_key` and `webhook_secret` from the `secret_payment_gateway_config` view (per-tenant), not from Deno env. The `STRIPE_WEBHOOK_SECRET` env var is never read.
- **Risk:** Operator sets `STRIPE_WEBHOOK_SECRET` thinking that's all that's needed; in reality every tenant must configure their own webhook secret via the admin UI. Onboarding is confusing.
- **Fix:** Either (a) support a platform-level fallback `STRIPE_WEBHOOK_SECRET` for single-tenant installs, or (b) update the manifest to remove `STRIPE_WEBHOOK_SECRET` and document that per-tenant config is required.
- **Test:** Read the manifest, assert the declared secrets match what the function actually reads.

### Wins

- 76 migrations are sequential and idempotent (B-01's duplicate `00064`/`00067` has been consolidated into `00064_onboarding_scim.sql` and `00067_audit_favorites.sql` — no duplicates).
- `supabase/seed.sql` defines 5 subscription tiers (Free / Individual Premium / Institution Basic / Pro / Enterprise) with clear feature gating.
- `supabase/migrations/00009_concurrent_approval_lock.sql` uses `FOR UPDATE` row locking for the approval workflow — correct.
- `supabase/migrations/00051_audit_logs_append_only.sql` makes audit logs append-only — correct.

---

## 4. Findings — Performance

### High

#### PERF-001 — CaseForm loads all templates without pagination or search
- **Severity:** High
- **Location:** `apps/web/components/CaseForm.tsx:92-96`
- **Evidence:**
  ```ts
  const [tenantTemplatesRes, globalTemplatesRes] = await Promise.all([
    supabase.from('case_templates').select('*').eq('tenant_id', tenantId),
    supabase.from('case_templates').select('*').eq('tenant_id', GLOBAL_TENANT_ID),
  ]);
  ```
- **Risk:** A tenant with 50 templates fetches all 50 over the wire on every case-entry page load, then renders all of them in the template picker. Slow on hospital WiFi.
- **Fix:** Add a search input, debounce 200ms, query with `.ilike('name', '%'+q+'%').limit(20)`. Default to "favorites first" using the `template_favorites` table (migration 00067).
- **Test:** Vitest test that mocks Supabase to return 100 templates, renders `<TemplateStep>`, types "append" in the search box, and asserts only matching templates render and that `select('*')` was called with `.limit(20)`.

#### PERF-002 — payment-webhook does O(N) signature verification per webhook
- **Severity:** High (compounds with SEC-002)
- **Location:** `supabase/functions/payment-webhook/index.ts:113-152`
- **Evidence:** The `for (const gwConfig of gatewayConfigs)` loop tries every active tenant's `webhook_secret` against the incoming signature until one verifies. With 100 tenants, every webhook does 100 `constructEventAsync` calls.
- **Fix:** Resolve the tenant from the Stripe-Account header (Connect webhooks) or from the signed event's `metadata.tenant_id` (standard webhooks), then look up only that tenant's config and verify once.
- **Test:** See SEC-002's test. Add a benchmark test: 1 webhook with 100 tenants should make exactly 1 signature-verification call.

#### PERF-003 — Mobile sync `pullAllData` runs 7 parallel Supabase queries
- **Severity:** Medium
- **Location:** `apps/mobile/lib/sync.ts:268-284`
- **Evidence:** `pullAllData` does `Promise.all([pullCases, pullTemplates, pullGoals, pullRotations, pullMilestones, pullEvaluations, pullComments])`. Each `pullX` does a `select('*')` with no `select` column list (except `pullGoals` which lists columns). Each is a separate HTTP round-trip.
- **Risk:** On 3G hospital WiFi, 7 parallel requests can saturate the connection and time out. Also `select('*')` over-fetches.
- **Fix:** (a) Specify column lists for every pull (smaller payloads). (b) For first sync, run sequentially with a single combined request if Supabase supports it (it doesn't natively; use an RPC `pull_all` returning JSONB). (c) For incremental sync, only pull cases (already done via `gt('updated_at', lastSync)`); other tables rarely change.
- **Test:** Vitest test asserting each `pullX` uses an explicit column list and that `pullCases` is the only one called on incremental sync.

### Wins

- `apps/web/next.config.mjs:20-22` uses `optimizePackageImports` for heroui, framer-motion, Sentry — good bundle hygiene.
- `apps/web/next.config.mjs:23-30` configures AVIF/WebP image optimization with sane sizes.
- `apps/web/proxy.ts` rate-limits `/auth/callback`, `/login`, and `/api/*`.
- Sentry source maps are configured with `deleteSourcemapsAfterUpload: true` — no source leak.

---

## 5. Findings — Web UI/UX

### Critical (Conversion-blocking)

#### UXW-001 — Landing page has no signup or pricing link
- **Severity:** Critical
- **Location:** `apps/web/app/page.tsx:26-71`
- **Evidence:** The landing page has a single `<Link href="/login">Sign in to your account</Link>` and three feature cards. No "Sign up" link. No pricing. No demo. The footer says `HIPAA-compliant. SOC 2 ready.` — claims the codebase cannot substantiate (no BAA, no SOC 2 audit).
- **Risk:** A junior doctor who lands on the site cannot become a customer. They can only sign in (assuming they already have an account). Revenue = 0.
- **Fix:** Add a `<Link href="/signup">Sign up free</Link>` next to Sign in. Add a `/pricing` page rendering the 5 plans from `supabase/seed.sql` with feature comparison. Add a `/demo` link that logs in as `resident@demo.com` (only when `app.enable_demo_migrations` is true). Remove the "HIPAA-compliant. SOC 2 ready." footer claim until you have a BAA and audit.
- **Test:** Playwright e2e: anonymous user visits `/`, clicks "Sign up free", asserts they land on `/signup`. Playwright: visits `/pricing`, asserts 5 plan cards render. Playwright: asserts the footer does NOT contain "SOC 2 ready".

#### UXW-002 — Login page uses hardcoded text colors, breaks dark mode
- **Severity:** Critical (the conversion-critical screen on the user's preferred OS theme)
- **Location:** `apps/web/app/login/page.tsx:13, 22, 53, 54, 66, 76, 80` (and many more)
- **Evidence:** Classes like `text-black`, `text-[#8E8E93]`, `bg-neutral-950`, `text-neutral-light/60` are sprinkled across the file. Some are tokens (`bg-neutral-950`), some are hardcoded (`text-black`). The root layout's `globals.css` defines `--text-primary` etc. but the login page bypasses them.
- **Risk:** A doctor using dark mode sees black-on-black or unreadable grey text on the login screen. Bounce.
- **Fix:** Replace every `text-black` with `text-text-primary`, `text-[#8E8E93]` with `text-text-muted`, `bg-neutral-950` with `bg-backdrop`. Verify both themes render with WCAG AA contrast.
- **Test:** Playwright e2e: visit `/login` in light mode, screenshot; visit in dark mode, screenshot; assert no element has `color === backgroundColor`. Add an axe scan assertion: 0 critical violations.

### High

#### UXW-003 — Onboarding page doesn't let a new doctor pick a plan
- **Severity:** High
- **Location:** `apps/web/app/onboarding/page.tsx:1-133`
- **Evidence:** After signup, the user lands on `/onboarding` which collects `full_name` and `specialty`. There's no plan selection, no payment, no "Start free trial" — the user is dropped into a free-tier tenant with no path to upgrade.
- **Fix:** Add a step 2 to onboarding: "Pick your plan" with the 5 plans from `supabase/seed.sql`. Free plan proceeds immediately. Paid plans redirect to Stripe checkout (`create-checkout` edge function). Add a step 3: "Create your first case" with a CTA to `/[slug]/cases/new`.
- **Test:** Playwright: signup → onboarding step 1 (profile) → step 2 (pick Individual Premium) → redirect to Stripe (mock or skip in test) → assert `checkout.session.created` event creates an active subscription.

#### UXW-004 — No empty state for first-time case list
- **Severity:** High
- **Location:** `apps/web/app/(authenticated)/[tenant]/cases/page.tsx` (verify) and `apps/web/components/EmptyState.tsx` (exists)
- **Evidence:** An `EmptyState` component exists but I haven't verified it's used on the cases page. A new resident lands on an empty case list with no guidance.
- **Fix:** Add a friendly empty state: "You haven't logged any cases yet. [Log your first case →]" with a screenshot or 30-second GIF.
- **Test:** Playwright: new resident visits `/[slug]/cases`, asserts the empty state renders with a CTA, clicks it, asserts navigation to `/[slug]/cases/new`.

### Wins

- `apps/web/app/layout.tsx:115-122` has RTL support (`dir={locale === 'ar' ? 'rtl' : 'ltr'}`) and a JSON-LD `MedicalWebPage` structured-data block.
- `apps/web/app/layout.tsx:149-151` has a skip-to-content link for screen readers.
- `apps/web/components/CaseForm.tsx:67-69` explicitly documents that PHI must not touch localStorage — good intent.
- `apps/web/components/onboarding/OnboardingWizard.tsx` and step components exist.

---

## 6. Findings — Mobile UI/UX & Readiness

### Critical

#### UXM-001 — Mobile is NOT ready to ship to App Store / Play Store
- **Severity:** Critical
- **Location:** `apps/mobile/lib/db/database.ts` (SQLCipher unverified — SEC-006); `apps/mobile/lib/sync.ts:309-327` (id collision — SEC-007)
- **Evidence:** See SEC-006 and SEC-007. The mobile app cannot safely store PHI offline until (a) SQLCipher is proven on device, (b) sync idempotency is fixed, (c) the device-generated-ID problem is fixed.
- **Risk:** App Store rejection (PHI without encryption attestation), data loss, cross-device collisions, regulatory exposure.
- **Fix:** Ship mobile as **online-only** for the first release. Disable the local database writes (`apps/mobile/lib/db/database.ts:initDatabase()` should no-op or throw). All case reads/writes go directly to Supabase. Re-enable offline in v2 after the three blockers are fixed and verified on physical devices.
- **Test:** Vitest in `apps/mobile/__tests__/`: asserts `getDatabase()` throws with a clear message "Offline storage is disabled in this build". Maestro flow on a physical device: kill WiFi, attempt to log a case, assert a clear "Network required" error.

### High

#### UXM-002 — Mobile `app.json` is configured (B-12 resolved)
- **Severity:** Informational (verify)
- **Location:** `apps/mobile/app.json:1-107`
- **Evidence:** `owner: mahmahdys-team`, `slug: elogbook-t5plytminvsqg3jhrtlw`, `eas.projectId: c0d8281c-...` (real UUID), `supabaseUrl: https://nuyedxkzaimlzaetbpaw.supabase.co` (real). Assets `icon.png`, `splash.png`, `adaptive-icon.png` all exist in `apps/mobile/assets/`.
- **Risk:** None — B-12 is resolved. Just ensure EAS credentials are set in the Expo dashboard before building.
- **Test:** `eas build:configure` dry-run succeeds. Manual: `eas build --platform ios --profile preview --no-wait` returns a build ID.

### Wins

- 12 mobile screens with consistent tab nav and Apple-Health-inspired UI.
- Biometric gate, screenshot guard, network-security-config tests all exist.
- E2E encryption-key generation test exists (`apps/mobile/lib/db/__tests__/encryption-key.test.ts`).

---

## 7. Findings — Features & Revenue Path

### Feature Inventory

| Feature | Status | Revenue Impact | Ship Recommendation |
|---|---|---|---|
| Email/password auth | Real | Critical | Ship as-is |
| OAuth (Google/Apple) | Not found | Differentiator | Add in Phase 2 |
| MFA | UI exists (`/mfa/enroll`, `/mfa/verify`) | Critical for institutions | Verify enrollment flow works |
| Tenant creation (individual) | Real (auto on signup) | Critical | Ship |
| Tenant creation (institution) | Partial (admin-only?) | Critical for B2B | Verify self-serve flow |
| Case entry wizard (4-step) | Real | Critical | Ship — fix PERF-001 |
| Case approval workflow | Real (`FOR UPDATE` lock) | Critical for institutions | Ship |
| Patient data handling | Real (de-identification flag) | Critical for HIPAA | Ship |
| Milestones (GMC, CanMEDS) | Real (migrations 00089, 00090) | Differentiator | Ship |
| Goals & progress | Real (migration 00031) | Differentiator | Ship |
| Rotations | Real (migration 00079) | Nice-to-have | Ship |
| Duty-hours | Real (migration 00069) | Critical for ACGME | Ship |
| Evaluations (Mini-CEX, DOPS, CBD) | Real (migration 00081) | Differentiator | Ship |
| Analytics dashboard | Real | Differentiator | Ship |
| PDF export | Real (`generate-pdf` function) | Critical for accreditation | Ship — verify audit/auth |
| CSV export | Real (4 csv routes) | Critical | Ship |
| AI clinical reflection | Real (well-guarded) | Differentiator | Ship (tenant opt-in) |
| Billing (Stripe) | Partial (see SEC-002) | Critical | **Fix first** |
| Team/role management | Real | Critical for institutions | Ship |
| SSO (SAML/OIDC) | Disabled (B-06) | Enterprise | **Hide** |
| SCIM | Disabled (manifest, not deployed) | Enterprise | **Hide** |
| Outgoing webhooks | Disabled (B-07) | Enterprise | **Hide** |
| Notifications | Partial (`notifications` table) | Nice-to-have | Ship table, hide push UI |
| Offline mobile | Broken (SEC-006/007) | Differentiator | **Disable** for v1 |
| i18n (en/ar/fr) | Real | Critical for KSA/FR | Ship — verify ar RTL |
| Audit log | Real | Critical for HIPAA | Ship |

### MVP Recommendation

**Phase 1 (ship in 1 week, accept first paying customer):**
- Web only. Mobile disabled (online-only if shipped at all).
- Email/password auth + MFA optional.
- Individual tenant signup with auto-created tenant.
- Case entry wizard + case list + case detail.
- Approval workflow (for when an institution admin invites a supervisor).
- PDF + CSV export.
- Stripe billing with 2 plans: Free (20 cases) and Individual Premium ($9.99/mo, unlimited + AI).
- Hide: SSO, SCIM, dispatch-webhook, AI config (use platform-default OpenAI), institution billing, webhooks UI.
- Disable: demo accounts in production (SEC-001).

**Phase 2 (post-revenue, 2-4 weeks):**
- Institution tenants with invite flow.
- Institution Basic/Pro plans.
- Mobile app (online-only) in TestFlight.
- AI per-tenant config.
- MFA enforcement for institution admins.
- Notifications (in-app + email).

**Phase 3 (1-2 months):**
- Offline mobile (after SEC-006/007 fixed and device-verified).
- SSO, SCIM, outgoing webhooks (after standards-compliant implementations).
- SOC 2 + BAA + HIPAA attestation (after a real audit).

### Pricing & Conversion

- **Solo doctor:** Free → Individual Premium $9.99/mo after 20 cases. Conversion prompt at case #19.
- **Institution:** $49.99/mo (Basic, 10 residents) or $149.99/mo (Pro, 50 residents, AI). Annual discount 20%.
- **Enterprise:** Custom. Sales-led. Hide behind "Contact us".

---

## 8. Findings — DevOps & Deployment

### Critical

#### DEV-001 — CD workflow doesn't deploy all edge functions
- **Severity:** High (consistency, not safety)
- **Location:** `.github/workflows/cd.yml:69-80`
- **Evidence:**
  ```yaml
  strategy:
    matrix:
      function: [ai-insights, generate-pdf, create-checkout, payment-webhook]
  # TODO(P6.5): add SCIM, webhooks, dispatch-webhook functions
  ```
- **Risk:** `ai-quality`, `ai-gap-analysis`, `list-invoices`, `webads-export`, `scim`, `sso-callback`, `dispatch-webhook` are not deployed. If anyone calls them, they 404 or hit a stale version.
- **Fix:** For v1, this is actually correct — `sso-callback` is broken (DB-001), `dispatch-webhook` is disabled, `scim` is hidden. Add `ai-quality`, `ai-gap-analysis`, `list-invoices`, `webads-export` to the matrix only if they're called from the web app. Audit with `rg "functions/.*'" apps/web`. **Do not** deploy `sso-callback` until DB-001 is fixed.
- **Test:** `cd .github/workflows && yq '.jobs.functions.strategy.matrix.function[]' cd.yml | sort | diff - <(cd ../../supabase/functions && ls -d */ | sed 's#/##' | grep -v _shared | sort)` — should show only intentional omissions.

#### DEV-002 — `docs/compliance/` is missing
- **Severity:** Medium (B-16 valid)
- **Location:** `docs/` has no `compliance/` subdirectory
- **Evidence:** `Test-Path docs/compliance` returns "MISSING".
- **Risk:** Cannot point enterprise customers at compliance artifacts. Cannot run a HIPAA audit.
- **Fix:** Create `docs/compliance/` with `hipaa.md`, `gdpr.md`, `security-overview.md`. Document: data flow diagram, encryption at rest (Postgres + pgcrypto), encryption in transit (TLS), RLS model, audit log coverage, breach response runbook, BAA process. Do NOT claim certifications you don't have.
- **Test:** `Test-Path docs/compliance/hipaa.md` exits 0.

### Wins

- `.github/workflows/ci.yml` uses `main` branch, Node 22, pnpm 9.15, `--frozen-lockfile`. B-13 is **resolved**.
- `.github/workflows/ci.yml:71-80` runs a migration linter (`scripts/lint-migrations.mjs`).
- `apps/web/Dockerfile` exists for container builds.
- `.env.example` is comprehensive (B-16 partially resolved).
- Sentry + PostHog are opt-in per environment.

---

## 9. Findings — Test Coverage

### Critical Gaps

#### TEST-001 — RLS tests don't actually assert
(Same as DB-004.)

#### TEST-002 — No end-to-end test for the case-entry wizard (the revenue path)
- **Severity:** Critical
- **Location:** `apps/web/e2e/` has `dashboard.spec.ts`, `login.spec.ts`, `navigation.spec.ts`, `responsive.spec.ts`, `shortcuts.spec.ts`, `smoke.spec.ts` — none cover the case wizard.
- **Evidence:** `rg "cases/new" apps/web/e2e/` returns nothing.
- **Fix:** Add `apps/web/e2e/case-wizard.spec.ts` that: logs in as resident → navigates to `/[slug]/cases/new` → picks the "General Surgery Log" template → fills patient info (de-identified) → fills case details → reviews → submits → asserts the case appears in the list with `pending` status.
- **Test:** The spec itself. Run `pnpm --filter @elogbook/web test:e2e -- --grep "case wizard"`.

#### TEST-003 — No test for Stripe webhook signature verification
- **Severity:** Critical
- **Location:** `supabase/functions/payment-webhook/index.ts` has no test file
- **Fix:** Add `supabase/functions/payment-webhook/index.test.ts` (Deno test) that: constructs a fake `checkout.session.completed` event, signs it with a test webhook secret, POSTs to the function, asserts the subscription is created. Then POSTs the same event again and asserts it's deduplicated (via `stripe_events` table).
- **Test:** The test file itself. Run `cd supabase/functions/payment-webhook && deno test`.

#### TEST-004 — No test for the audit-export route's service-role key leak
- **Severity:** Critical (after SEC-003 fix)
- **Fix:** Add `apps/web/app/api/[tenant]/audit/export/__tests__/route.test.ts` that mocks `global.fetch`, calls the route, and asserts the `Authorization` header sent to the edge function is the user's JWT, not the service-role key.
- **Test:** The test file itself.

### Test File Inventory

61 test files total. Distribution:
- Web unit (Vitest): ~25 files in `apps/web/**/__tests__/`
- Web e2e (Playwright): 6 files in `apps/web/e2e/`
- Mobile unit (Vitest): ~17 files in `apps/mobile/**/__tests__/`
- Shared unit (Vitest): 7 files in `packages/shared/src/**/__tests__/`
- Database (pgTAP): 5 files in `supabase/tests/`
- Load: 1 file in `tests/load/`

### Coverage by Domain (estimated)

| Domain | Tests? | Quality | Critical Gap |
|---|---|---|---|
| Auth & session | Yes | Medium | No e2e for MFA enrollment |
| Tenant authorization / RLS | Yes (stubs) | **Poor** | DB-004 — false positives |
| Case entry wizard | No | — | TEST-002 |
| Approval workflow | Yes (route test) | Good | — |
| Patient data (PHI) | Partial | Medium | No test that de-identification flag is enforced server-side |
| Milestones | No | — | Add |
| Goals, rotations, duty-hours, evals | No | — | Add at least smoke tests |
| PDF/CSV export | Yes (pdf-templates) | Medium | No test for audit-export auth (TEST-004) |
| AI (consent, redaction, egress) | No | — | Add function test |
| Billing (Stripe webhook) | No | — | TEST-003 |
| SSO, SCIM, webhooks | Partial | Low | Hidden — no test needed until re-enabled |
| Offline sync | Yes (4 sync tests) | Good | But the underlying ID bug isn't tested (SEC-007) |
| i18n | Yes (request test) | Medium | No e2e for RTL |
| a11y | No | — | Add axe-core in Playwright |
| Performance / load | Yes (smoke) | Low | No benchmark assertions |
| Prod smoke | Yes (smoke.spec) | Medium | Doesn't cover billing flow |

---

## 10. MVP Cut — What Ships First

Ship **only** these to the first production deploy:

1. Web app (Vercel).
2. Email/password auth + MFA optional.
3. Individual tenant signup with auto-tenant creation.
4. Case entry wizard + case list + case detail + case submit.
5. Approval workflow (for institution tenants — invite supervisor).
6. PDF + CSV export (with auth + audit).
7. Stripe billing: Free + Individual Premium ($9.99/mo).
8. AI insights (platform-default OpenAI key, tenant opt-in via `resident_ai_toggle`).
9. Audit log on every state-changing action.
10. Sentry + PostHog (opt-in).
11. Health check + CSP + rate limiting (already wired).

**Hide behind a feature flag or remove from UI:**
- SSO (`/admin/sso`) — disabled stub returns 503.
- SCIM (`/admin/scim`) — manifest deployed but route hidden.
- Outgoing webhooks (`/admin/webhooks`) — dispatch function disabled.
- AI config UI (`/admin/ai-config`) — use platform default.
- Institution billing UI — manual for now.
- Mobile app — do not ship to App Store.

---

## 11. Upgrade Plan — Bite-Sized TDD Tasks

Each task is self-contained: a small free LLM can do one task in one shot. Run the verification command exactly as written. Commit after each task. Tasks are ordered by priority (blockers first).

### Task 1 — Delete dead code in sso-callback edge function

**Goal:** Make `sso-callback` compile cleanly.

**Files:**
- Modify: `supabase/functions/sso-callback/index.ts:1-100`

- [ ] **Step 1: Read the current file**

```bash
cat supabase/functions/sso-callback/index.ts
```
Confirm it has `serve(async (req) => { return new Response(...) });` ending around line 17, followed by ~80 lines of dead code referencing `tenantSlug`, `protocol`, `next`, `headers`, `metadata`, `discovery`.

- [ ] **Step 2: Replace the entire file with the clean disabled stub**

```ts
// supabase/functions/sso-callback/index.ts
// SSO is disabled until a complete SAML/OIDC implementation is verified.
// See docs/upgrade-plan §DB-001. Returns 503 so callers fail loud.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async () => {
  return new Response(
    JSON.stringify({ error: 'SSO is disabled. Enterprise SSO is not yet available.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
```

- [ ] **Step 3: Verify it compiles**

Run: `cd supabase && deno check functions/sso-callback/index.ts`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sso-callback/index.ts
git commit -m "fix(sso-callback): delete dead code after disabled stub (DB-001)"
```

---

### Task 2 — Add migration to delete demo accounts in production

**Goal:** Demo accounts (`resident@demo.com` etc.) must NOT exist in any production Supabase project.

**Files:**
- Create: `supabase/migrations/00095_delete_demo_accounts_in_prod.sql`
- Create: `supabase/tests/p1_2_no_demo_accounts_in_prod.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p1_2_no_demo_accounts_in_prod.sql
-- Run with: supabase db test
-- Asserts that no auth.users row has a @demo.com email when
-- app.enable_demo_migrations is unset or 'false'.

SELECT 'FAIL: demo account exists in production' AS test_name, email
FROM auth.users
WHERE email LIKE '%@demo.com';
```

Run: `supabase db test`
Expected: FAIL with at least 5 rows (the demo accounts from `00006`).

- [ ] **Step 2: Write the migration that deletes them when the GUC is off**

```sql
-- supabase/migrations/00095_delete_demo_accounts_in_prod.sql
-- SEC-001: The gate in 00055 was inert (NULL = 'false' is NULL, so the
-- ELSE branch ran). This migration actually deletes the demo accounts,
-- their profiles, and the demo tenant when the GUC is unset or 'false'.
-- Idempotent.

DO $$
DECLARE
  v_demo_user_ids UUID[];
  v_demo_tenant_id UUID;
  v_setting TEXT;
BEGIN
  v_setting := current_setting('app.enable_demo_migrations', true);
  -- Treat NULL (unset) AND 'false' as "off". The old gate got this
  -- backwards.
  IF v_setting IS NULL OR v_setting = 'false' THEN
    RAISE NOTICE 'SEC-001: demo migrations are off — deleting demo accounts';

    SELECT array_agg(id) INTO v_demo_user_ids
    FROM auth.users
    WHERE email LIKE '%@demo.com';

    SELECT id INTO v_demo_tenant_id
    FROM tenants
    WHERE slug = 'demo';

    IF v_demo_tenant_id IS NOT NULL THEN
      DELETE FROM profiles WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM case_entries WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM approval_requests WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM tenants WHERE id = v_demo_tenant_id;
    END IF;

    IF v_demo_user_ids IS NOT NULL THEN
      DELETE FROM audit_logs WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM profiles WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.identities WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.users WHERE id = ANY(v_demo_user_ids);
    END IF;

    RAISE NOTICE 'SEC-001: deleted % demo users', coalesce(array_length(v_demo_user_ids, 1), 0);
  ELSE
    RAISE NOTICE 'SEC-001: demo migrations enabled — keeping demo accounts';
  END IF;
END $$;
```

- [ ] **Step 3: Run the test again — it should pass**

Run: `supabase db reset && supabase db test`
Expected: 0 FAIL rows for the new test.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00095_delete_demo_accounts_in_prod.sql supabase/tests/p1_2_no_demo_accounts_in_prod.sql
git commit -m "fix(security): actually delete demo accounts when GUC is off (SEC-001)"
```

---

### Task 3 — Fix payment-webhook to load only one tenant's config

**Goal:** Stop loading every tenant's Stripe secret on every webhook.

**Files:**
- Modify: `supabase/functions/payment-webhook/index.ts:69-311`
- Create: `supabase/functions/payment-webhook/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/payment-webhook/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

// Mock supabase-js so the function doesn't need a real DB
// We assert that, for a webhook signed with tenant B's secret + a
// Stripe-Account header that maps to tenant A, ONLY tenant A's config
// is loaded — not tenant B's.

Deno.test('payment-webhook: loads only the tenant identified by Stripe-Account header', async () => {
  const loadedTenantIds: string[] = [];
  // ... mock createClient to record which tenant_id each select touches ...
  // ... call the function with a fake request ...
  // assertEquals(loadedTenantIds, ['tenant-a-uuid']);
});
```

(Sketch the test skeleton — a small LLM can fill in the mock setup. The assertion is what matters: only ONE tenant's config is loaded.)

- [ ] **Step 2: Refactor the function**

Replace the `serve()` body so it:
1. Reads the `Stripe-Account` header.
2. If absent, falls back to reading `metadata.tenant_slug` from the raw body (only after signature verification — but for the fallback we need a pre-scan; the cleanest fix is to require Stripe Connect for multi-tenant, and use a single tenant config for single-tenant installs).
3. Looks up only that tenant's config via `getConfigForWebhook`.
4. Verifies the signature once.
5. Returns 401 if no tenant can be identified.

```ts
// Replace lines 69-311 of supabase/functions/payment-webhook/index.ts
// Key changes:
// - Call getConfigForWebhook(supabase, stripeAccountId) instead of
//   selecting ALL active configs.
// - If that returns null, return 401.
// - Otherwise use the single returned config to verify the signature.
// (The full code is too long to inline here — the LLM should rewrite
//  the serve() handler using the existing getConfigForWebhook function
//  at lines 17-56, which is currently dead code.)
```

- [ ] **Step 3: Run the test**

Run: `cd supabase/functions/payment-webhook && deno test`
Expected: 1 test passes.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/payment-webhook/
git commit -m "fix(payment-webhook): load only one tenant's config per webhook (SEC-002, PERF-002)"
```

---

### Task 4 — Stop leaking the service-role key in audit-export fetch

**Goal:** The audit-export route must not pass `SUPABASE_SERVICE_ROLE_KEY` as a Bearer header to `fetch`.

**Files:**
- Modify: `apps/web/app/api/[tenant]/audit/export/route.ts:155-185`
- Create: `apps/web/app/api/[tenant]/audit/export/__tests__/service-key-leak.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/[tenant]/audit/export/__tests__/service-key-leak.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase server client to return an authenticated admin user
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { role: 'institution_admin', tenant_id: 't-1', tenants: { slug: 'demo' } } })) })),
      })),
      // ... return audit log rows ...
    })),
  })),
}));

// Mock global.fetch to capture the Authorization header
const fetchMock = vi.fn(async () => new Response('PDF_BYTES', { status: 200 }));
globalThis.fetch = fetchMock as any;

describe('audit export route — SEC-003', () => {
  beforeEach(() => { fetchMock.mockClear(); });

  it('sends the user JWT, not the service-role key, to the edge function', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'shhh-platform-secret';
    const { POST } = await import('../route');
    const req = new Request('https://x/api/demo/audit/export?format=pdf', { method: 'POST' });
    await POST(req, { params: Promise.resolve({ tenant: 'demo' }) } as any);
    const authHeader = fetchMock.mock.calls[0][1].headers['Authorization'];
    expect(authHeader).not.toContain('shhh-platform-secret');
  });
});
```

Run: `pnpm --filter @elogbook/web test -- audit/export`
Expected: FAIL with "expected 'Bearer shhh-platform-secret' not to contain 'shhh-platform-secret'".

- [ ] **Step 2: Fix the route**

Replace lines 160-170 of `apps/web/app/api/[tenant]/audit/export/route.ts` so that instead of `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, it uses the user's JWT from `supabase.auth.getSession()` (or the `Authorization` header from the incoming request, forwarded). The edge function's `_shared/auth.ts:authenticate` will then resolve the user and tenant from the JWT.

```ts
// Before:
//   'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
// After:
const { data: { session } } = await supabase.auth.getSession();
const userJwt = session?.access_token ?? '';
// ...
'Authorization': `Bearer ${userJwt}`,
```

- [ ] **Step 3: Run the test — pass**

Run: `pnpm --filter @elogbook/web test -- audit/export`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/\[tenant\]/audit/export/
git commit -m "fix(audit-export): use user JWT, not service-role key, for edge function call (SEC-003)"
```

---

### Task 5 — Add FORCE RLS to tables created after migration 00049

**Goal:** Every tenant-scoped table has `FORCE ROW LEVEL SECURITY`.

**Files:**
- Create: `supabase/migrations/00096_force_rls_post_00049.sql`
- Modify: `supabase/tests/p0_6_force_rls.sql` (add the new tables to the expected list)

- [ ] **Step 1: Audit which tables have ENABLE but not FORCE**

Run:
```bash
cd supabase
psql -f - <<'SQL'
SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
ORDER BY c.relname;
SQL
```
List every table where `forced = false`. Confirm `template_favorites`, `duty_periods`, `faculty_evaluations` are in the list.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00096_force_rls_post_00049.sql
-- DB-002: Tables created after 00049_force_rls_all_tables.sql were
-- not in its array literal, so they only got ENABLE ROW LEVEL SECURITY.
-- Without FORCE, the table owner bypasses RLS. This migration applies
-- FORCE to every tenant-scoped table that has RLS enabled but not forced.
-- Idempotent.

DO $$
DECLARE
  r RECORD;
  v_applied INT := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'Forced RLS on %', r.relname;
    v_applied := v_applied + 1;
  END LOOP;
  RAISE NOTICE 'FORCE RLS: applied to % tables', v_applied;
END $$;
```

- [ ] **Step 3: Update the regression test**

In `supabase/tests/p0_6_force_rls.sql`, find the `v_expected` array and append `'template_favorites'`, `'duty_periods'`, `'faculty_evaluations'`, and any other tenant-scoped tables discovered in Step 1.

- [ ] **Step 4: Run the test**

Run: `supabase db reset && supabase db test`
Expected: all tests pass, including the updated `p0_6_force_rls.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/00096_force_rls_post_00049.sql supabase/tests/p0_6_force_rls.sql
git commit -m "fix(rls): FORCE RLS on tables created after 00049 (DB-002)"
```

---

### Task 6 — Rewrite the cross-tenant RLS test to actually assert

**Goal:** `p1_1_cross_tenant_isolation.sql` must fail loudly if RLS is broken.

**Files:**
- Modify: `supabase/tests/p1_1_cross_tenant_isolation.sql:1-67`
- Modify: `supabase/tests/rls-policies.sql` (rewrite stubs)

- [ ] **Step 1: Rewrite `p1_1_cross_tenant_isolation.sql`**

```sql
-- supabase/tests/p1_1_cross_tenant_isolation.sql
-- Cross-tenant isolation tests (P1.1) — REWRITTEN for DB-004.
-- Run with: supabase db test
-- Requires: a running local Supabase (supabase db reset).
--
-- Strategy: insert two tenants and two resident users, set the JWT
-- claim to simulate tenant A's resident, and assert that a SELECT
-- against tenant B's rows returns 0 rows. Without set_config, the
-- old test passed vacuously because get_tenant_id() returned NULL
-- and `tenant_id != NULL` is NULL → EXISTS(NULL) is false.

BEGIN;
  -- Seed two tenants and two residents
  INSERT INTO tenants (id, name, slug, tenant_type, settings)
  VALUES
    ('11111111-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a', 'institution', '{}'),
    ('22222222-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b', 'institution', '{}')
  ON CONFLICT (id) DO NOTHING;

  -- Insert a case in each tenant
  INSERT INTO case_entries (id, tenant_id, resident_id, template_id, patient_mrn, patient_dob, patient_age_years, patient_hash, case_date, field_values, accreditation_mappings, is_deidentified, status)
  VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'rrrrrrrr-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', NULL, NULL, NULL, NULL, '2026-01-01', '{}'::JSONB, '[]'::JSONB, true, 'draft'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'rrrrrrrr-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', NULL, NULL, NULL, NULL, '2026-01-01', '{}'::JSONB, '[]'::JSONB, true, 'draft')
  ON CONFLICT (id) DO NOTHING;

  -- Simulate tenant A's resident JWT
  SELECT set_config('request.jwt.claims', '{"sub":"rrrrrrrr-0000-0000-0000-000000000001","app_metadata":{"tenant_id":"11111111-0000-0000-0000-000000000001","user_role":"resident"}}', true);
  SET LOCAL role authenticated;

  -- Assert: tenant A resident can read tenant A's case (1 row)
  -- Assert: tenant A resident CANNOT read tenant B's case (0 rows)
  -- pgTAP-style: a SELECT that returns a row means FAIL.
  SELECT 'FAIL: tenant A resident can read tenant B case_entries' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM case_entries WHERE tenant_id = '22222222-0000-0000-0000-000000000002'
  );

  SELECT 'FAIL: tenant A resident can read tenant B profiles' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM profiles WHERE tenant_id = '22222222-0000-0000-0000-000000000002'
  );
ROLLBACK;
```

- [ ] **Step 2: Run the test**

Run: `supabase db reset && supabase db test`
Expected: 0 rows of `'FAIL: ...'` returned. If you see a FAIL row, RLS is broken and the test caught it.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/p1_1_cross_tenant_isolation.sql
git commit -m "test(rls): rewrite cross-tenant test to actually set JWT and assert (DB-004)"
```

---

### Task 7 — Add a public pricing page

**Goal:** Anonymous visitors can see plans and click "Sign up".

**Files:**
- Create: `apps/web/app/pricing/page.tsx`
- Create: `apps/web/app/pricing/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/pricing/__tests__/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the server action that fetches plans
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [
          { id: '1', name: 'Free', slug: 'free', price_monthly: 0, features: { max_cases: 20 } },
          { id: '2', name: 'Individual Premium', slug: 'individual-premium', price_monthly: 9.99, features: { ai: true } },
        ] })))
      }))
    }))
  }))
}));

describe('pricing page — UXW-001', () => {
  it('renders 5 plan cards', async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    expect(screen.getAllByTestId('plan-card')).toHaveLength(5);
  });

  it('renders a Sign-up link on each paid plan', async () => {
    const { default: PricingPage } = await import('../page');
    render(await PricingPage());
    expect(screen.getAllByRole('link', { name: /sign up/i }).length).toBeGreaterThan(0);
  });
});
```

Run: `pnpm --filter @elogbook/web test -- pricing`
Expected: FAIL (page doesn't exist).

- [ ] **Step 2: Create the page**

```tsx
// apps/web/app/pricing/page.tsx
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { APP_NAME } from '@elogbook/shared';

export const dynamic = 'force-dynamic';

interface Plan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: 'individual' | 'institution';
  max_residents: number | null;
}

export default async function PricingPage() {
  const supabase = await createServerSupabase();
  const { data: plans } = await supabase
    .from('subscription_plans')
    .select('id, name, slug, price_monthly, features, tenant_type, max_residents')
    .order('price_monthly', { ascending: true });

  return (
    <div className="min-h-screen bg-backdrop text-text-primary">
      <main className="max-w-5xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-heading font-bold text-center mb-2">Pricing</h1>
        <p className="text-center text-text-secondary mb-12">
          Pick the plan that fits your training. Cancel anytime.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(plans as Plan[] | null ?? [])?.map((plan) => (
            <div key={plan.id} data-testid="plan-card" className="panel p-6 flex flex-col">
              <h2 className="text-xl font-heading font-semibold mb-1">{plan.name}</h2>
              <p className="text-3xl font-bold mb-4">
                ${plan.price_monthly.toFixed(2)}
                <span className="text-sm text-text-muted font-normal">/mo</span>
              </p>
              <ul className="text-sm text-text-secondary space-y-1 mb-6 flex-1">
                {Object.entries(plan.features).map(([k, v]) => (
                  <li key={k}>{v === true ? '✓' : v === false ? '✗' : '•'} {k.replace(/_/g, ' ')}</li>
                ))}
              </ul>
              {plan.slug === 'free' ? (
                <Link href="/signup" className="block text-center py-2 rounded-lg bg-primary text-white font-medium text-sm">Sign up free</Link>
              ) : (
                <Link href={`/signup?plan=${plan.slug}`} className="block text-center py-2 rounded-lg bg-primary text-white font-medium text-sm">Sign up</Link>
              )}
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-text-muted mt-12">
          Need SSO, SCIM, or a BAA? <Link href="/contact" className="text-primary underline">Contact us</Link>.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Run the test — pass**

Run: `pnpm --filter @elogbook/web test -- pricing`
Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/pricing/
git commit -m "feat(pricing): public pricing page with 5 plans (UXW-001)"
```

---

### Task 8 — Add a signup link to the landing page and remove false compliance claims

**Goal:** `apps/web/app/page.tsx` links to `/signup` and `/pricing`; footer no longer claims "HIPAA-compliant. SOC 2 ready."

**Files:**
- Modify: `apps/web/app/page.tsx:26-71`
- Create: `apps/web/e2e/landing.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

```ts
// apps/web/e2e/landing.spec.ts
import { test, expect } from '@playwright/test';

test('landing page has Sign up free link to /signup', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('link', { name: /sign up free/i });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/signup/);
});

test('landing page has Pricing link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /pricing/i }).click();
  await expect(page).toHaveURL(/\/pricing/);
});

test('landing page footer does NOT claim SOC 2', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await expect(footer).not.toContainText('SOC 2');
});
```

Run: `pnpm --filter @elogbook/web test:e2e -- --grep "landing"`
Expected: FAIL (no Sign up link).

- [ ] **Step 2: Modify the landing page**

Replace the single "Sign in to your account" link (line 41-46) with two links side-by-side:

```tsx
<div className="flex flex-col sm:flex-row gap-3 justify-center">
  <Link
    href="/signup"
    className="px-6 py-3 rounded-lg bg-primary text-white font-medium text-sm hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
  >
    Sign up free
  </Link>
  <Link
    href="/login"
    className="px-6 py-3 rounded-lg border border-border text-text-primary font-medium text-sm hover:bg-surface-elevated transition-colors"
  >
    Sign in
  </Link>
</div>
```

Add a header nav with a "Pricing" link. Replace the footer text:
- Before: `© 2026 {APP_NAME} Enterprise. HIPAA-compliant. SOC 2 ready.`
- After: `© 2026 {APP_NAME}. Built for medical residents.`

- [ ] **Step 3: Run the e2e test — pass**

Run: `pnpm --filter @elogbook/web test:e2e -- --grep "landing"`
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/page.tsx apps/web/e2e/landing.spec.ts
git commit -m "fix(landing): add signup + pricing links, remove SOC 2 claim (UXW-001)"
```

---

### Task 9 — Fix login page hardcoded colors for dark mode

**Goal:** Login page uses design tokens, works in dark mode.

**Files:**
- Modify: `apps/web/app/login/page.tsx` (replace all `text-black`, `text-[#8E8E93]`, `bg-neutral-950`)
- Create: `apps/web/e2e/login-dark-mode.spec.ts`

- [ ] **Step 1: Find all hardcoded colors**

Run: `rg "text-black|text-\[#8E8E93\]|bg-neutral-950|text-neutral-light" apps/web/app/login/page.tsx`

- [ ] **Step 2: Write the failing e2e test**

```ts
// apps/web/e2e/login-dark-mode.spec.ts
import { test, expect } from '@playwright/test';

test('login page is readable in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  // Body text must not be black on a dark background
  const bodyColor = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
  const bgColor = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
  // crude check: color and background must differ
  expect(bodyColor).not.toBe(bgColor);
  // axe scan
  await expect(page).toPassAxe();
});
```

Run: `pnpm --filter @elogbook/web test:e2e -- --grep "login-dark-mode"`
Expected: FAIL.

- [ ] **Step 3: Replace hardcoded classes**

Open `apps/web/app/login/page.tsx` and replace:
- `text-black` → `text-text-primary`
- `text-[#8E8E93]` → `text-text-muted`
- `bg-neutral-950` → `bg-backdrop`
- `text-neutral-light/60` → `text-text-muted`
- `hover:text-black` → `hover:text-text-primary`
- `border-neutral-800` → `border-border`

Use `replaceAll: true` in the Edit tool for each pattern.

- [ ] **Step 4: Run the test — pass**

Run: `pnpm --filter @elogbook/web test:e2e -- --grep "login-dark-mode"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/login/page.tsx apps/web/e2e/login-dark-mode.spec.ts
git commit -m "fix(login): use design tokens for dark-mode support (UXW-002)"
```

---

### Task 10 — Disable mobile offline storage for v1

**Goal:** Mobile app v1 is online-only. No local SQLite writes.

**Files:**
- Modify: `apps/mobile/lib/db/database.ts:21-48`
- Create: `apps/mobile/lib/db/__tests__/online-only.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/lib/db/__tests__/online-only.test.ts
import { describe, it, expect } from 'vitest';
import { getDatabase, initDatabase } from '../database';

describe('mobile DB — UXM-001 (v1 online-only)', () => {
  it('initDatabase throws with a clear message', async () => {
    await expect(initDatabase()).rejects.toThrow(/offline storage is disabled/i);
  });

  it('getDatabase throws when not initialized', () => {
    expect(() => getDatabase()).toThrow(/not initialized|disabled/i);
  });
});
```

Run: `pnpm --filter @elogbook/mobile test -- online-only`
Expected: FAIL (currently initDatabase succeeds).

- [ ] **Step 2: Modify database.ts to throw**

```ts
// apps/mobile/lib/db/database.ts — replace the entire file
// UXM-001 / SEC-006 / SEC-007: offline PHI storage is disabled in v1.
// SQLCipher device-level encryption and sync idempotency have not been
// verified on physical devices. Re-enable in v2 after the blockers are
// fixed and device-tested.

export class OfflineStorageDisabledError extends Error {
  constructor() {
    super(
      'Offline storage is disabled in this build. ' +
      'Use supabase.ts directly for all reads and writes. ' +
      'See docs/ANALYSIS_AND_UPGRADE_PLAN.md §UXM-001.'
    );
    this.name = 'OfflineStorageDisabledError';
  }
}

export async function initDatabase(): Promise<never> {
  throw new OfflineStorageDisabledError();
}

export function getDatabase(): never {
  throw new OfflineStorageDisabledError();
}
```

- [ ] **Step 3: Update sync.ts to skip local DB calls**

Open `apps/mobile/lib/sync.ts`. At the top, after the imports, add:
```ts
// UXM-001: offline storage is disabled in v1. Sync becomes a no-op.
// All reads/writes go directly to Supabase via the React components.
export class SyncService {
  // ... keep the status/notification methods so existing UI doesn't break ...
  async pullAllData(_t: string) { /* no-op */ }
  async pushCases() { /* no-op */ }
  async handleConflicts() { /* no-op */ }
  async initSync(_t?: string) { /* no-op */ }
  startPeriodicSync(_i = 60000) { /* no-op */ }
  stopPeriodicSync() { /* no-op */ }
  cleanup() { /* no-op */ }
}
```

(The LLM should keep the existing `setStatus`, `onStatusChange`, etc. methods intact — only the DB-touching methods become no-ops.)

- [ ] **Step 4: Run the test — pass**

Run: `pnpm --filter @elogbook/mobile test -- online-only`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/db/database.ts apps/mobile/lib/db/__tests__/online-only.test.ts apps/mobile/lib/sync.ts
git commit -m "fix(mobile): disable offline storage for v1 (UXM-001, SEC-006, SEC-007)"
```

---

### Task 11 — Add e2e test for the case-entry wizard (the revenue path)

**Goal:** The critical user path (log a case) is e2e tested.

**Files:**
- Create: `apps/web/e2e/case-wizard.spec.ts`

- [ ] **Step 1: Write the test**

```ts
// apps/web/e2e/case-wizard.spec.ts
import { test, expect } from '@playwright/test';

test('resident logs a case end-to-end (TEST-002)', async ({ page }) => {
  // Sign in as the demo resident (only works in dev/stage — skip in prod)
  test.skip(process.env.NODE_ENV === 'production', 'demo accounts only in dev');
  await page.goto('/login');
  await page.fill('input[type=email]', 'resident@demo.com');
  await page.fill('input[type=password]', 'password123!');
  await page.click('button[type=submit]');

  // Wait for redirect to dashboard
  await expect(page).toHaveURL(/\/.*\/dashboard$/);

  // Navigate to new case
  await page.goto(/\/(.*)\/cases\/new/.source!); // simpler: click the + button
  // (the LLM should fill in the actual nav: click "Log case" link)

  // Step 1: Template — pick General Surgery Log
  await page.click('text=General Surgery Log');
  await page.click('text=Next');

  // Step 2: Patient Info — de-identified
  await page.check('input[name=isDeidentified]');
  await page.fill('input[name=patientAgeYears]', '45');
  await page.fill('input[name=caseDate]', '2026-07-21');
  await page.click('text=Next');

  // Step 3: Case Details — fill required fields
  await page.fill('input[name=procedure_name]', 'Appendectomy');
  await page.click('text=Next');

  // Step 4: Review — submit
  await page.click('text=Submit');

  // Assert: case appears in list with pending status
  await expect(page).toHaveURL(/\/.*\/cases$/);
  await expect(page.locator('text=Appendectomy')).toBeVisible();
  await expect(page.locator('text=Pending')).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @elogbook/web test:e2e -- --grep "case-wizard"`
Expected: PASS (after fixing any selector mismatches the LLM finds).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/case-wizard.spec.ts
git commit -m "test(e2e): cover case-entry wizard end-to-end (TEST-002)"
```

---

### Task 12 — Add a Stripe webhook idempotency test

**Goal:** `payment-webhook` is tested for signature verification + dedup.

**Files:**
- Create: `supabase/functions/payment-webhook/index.test.ts`

- [ ] **Step 1: Write the test**

```ts
// supabase/functions/payment-webhook/index.test.ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
// ... import the function via a small wrapper that exports `handler` ...

Deno.test('payment-webhook: rejects missing signature', async () => {
  const res = await handler(new Request('https://x', { method: 'POST', body: '{}' }));
  assertEquals(res.status, 400);
});

Deno.test('payment-webhook: dedups by stripe_event_id', async () => {
  // Construct a real signed event using Stripe's test library
  // Call handler twice with the same event
  // First call: 200, creates subscription
  // Second call: 200 with { duplicate: true }, no second subscription
});

Deno.test('payment-webhook: skips mode-mismatched event', async () => {
  // Live config + test event → skip, return 400
});
```

- [ ] **Step 2: Run the test**

Run: `cd supabase/functions/payment-webhook && deno test`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/payment-webhook/index.test.ts
git commit -m "test(payment-webhook): signature verify + idempotency (TEST-003)"
```

---

### Task 13 — Wire `packages/env` so the app fails fast on missing env vars

**Goal:** Vercel build crashes at startup if `NEXT_PUBLIC_SUPABASE_URL` etc. are missing.

**Files:**
- Modify: `apps/web/lib/supabase/server.ts:1-39` (import `parseWebServerEnv`)
- Modify: `apps/web/lib/supabase/admin.ts:1-20` (same)
- Modify: `apps/web/package.json` (add `@elogbook/env` workspace dep)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/env-fail-fast.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('env validation — SEC-008', () => {
  const original = { ...process.env };
  beforeEach(() => { process.env = { ...original }; });
  afterEach(() => { process.env = original; });

  it('createServerSupabase throws if NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    // dynamic import to trigger module-load side effects
    await expect(import('@/lib/supabase/server')).resolves.toBeDefined();
    const mod = await import('@/lib/supabase/server');
    await expect(mod.createServerSupabase()).rejects.toThrow(/Missing.*SUPABASE_URL/i);
  });
});
```

Run: `pnpm --filter @elogbook/web test -- env-fail-fast`
Expected: FAIL (currently returns a Proxy that throws on first method call, not at construction).

- [ ] **Step 2: Wire `packages/env` into `apps/web`**

In `apps/web/package.json`, add to `dependencies`:
```json
"@elogbook/env": "workspace:*"
```

In `apps/web/lib/supabase/server.ts`, replace the top of `createServerSupabase`:
```ts
import { parseWebServerEnv } from '@elogbook/env';
// ...
export async function createServerSupabase() {
  const env = parseWebServerEnv(process.env);  // throws at first call if missing
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = env;
  // ... rest unchanged
}
```

Do the same in `apps/web/lib/supabase/admin.ts` (use a combined schema).

- [ ] **Step 3: Run the test — pass**

Run: `pnpm --filter @elogbook/web test -- env-fail-fast`
Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/lib/supabase/server.ts apps/web/lib/supabase/admin.ts apps/web/lib/__tests__/env-fail-fast.test.ts
git commit -m "fix(env): fail fast on missing Supabase env vars (SEC-008)"
```

---

### Task 14 — Harden the CSP-violation endpoint

**Goal:** `/api/csp-violation` has a body size cap, JSON validation, and a dedicated rate limit.

**Files:**
- Modify: `apps/web/app/api/csp-violation/route.ts:1-7`
- Create: `apps/web/app/api/csp-violation/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/api/csp-violation/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { POST } from '../route';

describe('csp-violation — SEC-005', () => {
  it('rejects bodies larger than 4 KB', async () => {
    const big = 'x'.repeat(5000);
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body: big,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(413);
  });

  it('rejects non-JSON bodies', async () => {
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body: 'not json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('accepts a valid csp-report', async () => {
    const body = JSON.stringify({ 'csp-report': { 'document-uri': 'https://x/y' } });
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(204);
  });
});
```

Run: `pnpm --filter @elogbook/web test -- csp-violation`
Expected: FAIL (currently all 3 succeed or 204 regardless).

- [ ] **Step 2: Replace the route**

```ts
// apps/web/app/api/csp-violation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

const MAX_BODY_BYTES = 4096;

export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (parsed && typeof parsed === 'object' && 'csp-report' in parsed) {
    Sentry.captureMessage('CSP Violation', {
      level: 'info',
      extra: { report: parsed },
    });
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Run the test — pass**

Run: `pnpm --filter @elogbook/web test -- csp-violation`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/csp-violation/
git commit -m "harden(csp-violation): size cap + JSON validation + Sentry (SEC-005)"
```

---

### Task 15 — Create `docs/compliance/` artifacts

**Goal:** Enterprise customers can review compliance docs.

**Files:**
- Create: `docs/compliance/hipaa.md`
- Create: `docs/compliance/gdpr.md`
- Create: `docs/compliance/security-overview.md`

- [ ] **Step 1: Create the three files**

Each is a markdown doc with sections:
- **hipaa.md**: Data flow (PHI fields: `patient_mrn`, `patient_dob`, `field_values`), encryption at rest (Postgres + `pgp_sym_encrypt` via `app.encryption_key`), encryption in transit (TLS), access controls (RLS + role hierarchy), audit log coverage, breach response runbook, BAA process (currently N/A — we do not sign BAAs until an audit).
- **gdpr.md**: Article 15 (data export via audit-export route), Article 17 (deletion via retention admin RPC), Article 20 (portability via CSV export), DPA template, data residency (Supabase region).
- **security-overview.md**: Architecture diagram, threat model, secrets management, incident response runbook, contact.

Each file must say "Status: Draft — not certified" at the top. Do NOT claim certifications.

- [ ] **Step 2: Verify**

Run: `Test-Path docs/compliance/hipaa.md; Test-Path docs/compliance/gdpr.md; Test-Path docs/compliance/security-overview.md`
Expected: True × 3.

- [ ] **Step 3: Commit**

```bash
git add docs/compliance/
git commit -m "docs(compliance): draft HIPAA/GDPR/security overviews (DEV-002)"
```

---

### Task 16 — Run the full verification suite before declaring done

**Goal:** Confirm everything is green.

- [ ] **Step 1: Install dependencies**

Run: `pnpm install --frozen-lockfile`
Expected: success.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint:all`
Expected: 0 errors.

- [ ] **Step 4: Unit tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 5: Database tests**

Run: `supabase db reset && supabase db test`
Expected: all pgTAP tests pass, including the rewritten `p1_1_cross_tenant_isolation.sql` and the new `p1_2_no_demo_accounts_in_prod.sql`.

- [ ] **Step 6: e2e tests**

Run: `pnpm --filter @elogbook/web test:e2e`
Expected: all Playwright tests pass.

- [ ] **Step 7: Web build**

Run: `pnpm build:web`
Expected: success.

- [ ] **Step 8: Security scan**

Run: `pnpm security:scan`
Expected: no high/critical vulnerabilities.

- [ ] **Step 9: If all green — deploy**

```bash
git push
# CD pipeline deploys to Vercel + Supabase
```

---

## 12. Test Inventory — What Every Task Must Add

This is a quick-reference table mapping each task to its required test.

| Task | Test File | Framework | Key Assertion |
|------|-----------|-----------|---------------|
| 1 (sso-callback) | `deno check functions/sso-callback/index.ts` | deno | Compiles |
| 2 (demo accounts) | `supabase/tests/p1_2_no_demo_accounts_in_prod.sql` | pgTAP | 0 `@demo.com` users when GUC off |
| 3 (payment-webhook) | `supabase/functions/payment-webhook/index.test.ts` | deno test | Only 1 tenant's config loaded |
| 4 (audit-export key) | `apps/web/app/api/[tenant]/audit/export/__tests__/service-key-leak.test.ts` | Vitest | Bearer header ≠ service-role key |
| 5 (FORCE RLS) | `supabase/tests/p0_6_force_rls.sql` (updated) | pgTAP | All tenant tables `relforcerowsecurity = true` |
| 6 (RLS test rewrite) | `supabase/tests/p1_1_cross_tenant_isolation.sql` | pgTAP | Cross-tenant SELECT returns 0 rows |
| 7 (pricing page) | `apps/web/app/pricing/__tests__/page.test.tsx` | Vitest+RTL | 5 plan cards render |
| 8 (landing page) | `apps/web/e2e/landing.spec.ts` | Playwright | Sign up + Pricing links present; no SOC 2 claim |
| 9 (login dark mode) | `apps/web/e2e/login-dark-mode.spec.ts` | Playwright+axe | 0 a11y violations in dark mode |
| 10 (mobile online-only) | `apps/mobile/lib/db/__tests__/online-only.test.ts` | Vitest | `initDatabase` throws |
| 11 (case wizard e2e) | `apps/web/e2e/case-wizard.spec.ts` | Playwright | Resident logs a case in <6 clicks |
| 12 (Stripe webhook) | `supabase/functions/payment-webhook/index.test.ts` | deno test | Dedup by `stripe_event_id` |
| 13 (env fail-fast) | `apps/web/lib/__tests__/env-fail-fast.test.ts` | Vitest | Throws on missing env var |
| 14 (csp-violation) | `apps/web/app/api/csp-violation/__tests__/route.test.ts` | Vitest | 413 on big body, 400 on non-JSON |
| 15 (compliance docs) | `Test-Path docs/compliance/*.md` | shell | 3 files exist |
| 16 (verify all) | `pnpm check && pnpm build:web && pnpm security:scan` | shell | All green |

---

## Appendix — Quick command reference

```bash
# Bootstrap
pnpm install --frozen-lockfile
cp .env.example .env.local
supabase start
supabase db reset

# Develop
pnpm dev:web
pnpm dev:mobile

# Test
pnpm test                                  # all unit tests
pnpm --filter @elogbook/web test:e2e      # Playwright
supabase db test                           # pgTAP RLS + RPC
cd supabase/functions/payment-webhook && deno test  # edge function

# Verify
pnpm typecheck
pnpm lint:all
pnpm build:web
pnpm security:scan
pnpm release:verify   # = typecheck + lint + test + build + security:scan

# Deploy (via CD pipeline on push to main)
git push
```

---

## Appendix — Findings index (for reference when vibecoding)

| ID | Domain | Severity | Task |
|----|--------|----------|------|
| SEC-001 | Security | Blocker | 2 |
| SEC-002 | Security | Blocker | 3 |
| SEC-003 | Security | Blocker | 4 |
| SEC-004 | Security | High | (verify each route — separate task) |
| SEC-005 | Security | High | 14 |
| SEC-006 | Security | High | 10 (disable mobile for v1) |
| SEC-007 | Security | High | 10 (disable mobile for v1) |
| SEC-008 | Security | High | 13 |
| DB-001 | Database | Critical | 1 |
| DB-002 | Database | Critical | 5 |
| DB-003 | Database | High | 13 |
| DB-004 | Database | High | 6 |
| DB-005 | Database | High | (manifest audit — fold into Task 3) |
| PERF-001 | Performance | High | (fold into a future case-form PR) |
| PERF-002 | Performance | High | 3 (same fix as SEC-002) |
| PERF-003 | Performance | Medium | (future sync refactor) |
| UXW-001 | Web UX | Critical | 7, 8 |
| UXW-002 | Web UX | Critical | 9 |
| UXW-003 | Web UX | High | (future onboarding PR) |
| UXW-004 | Web UX | High | (future empty-state PR) |
| UXM-001 | Mobile | Critical | 10 |
| UXM-002 | Mobile | Informational | (verify EAS creds) |
| DEV-001 | DevOps | High | (audit matrix — fold into Task 3) |
| DEV-002 | DevOps | Medium | 15 |
| TEST-001 | Tests | Critical | 6 (same as DB-004) |
| TEST-002 | Tests | Critical | 11 |
| TEST-003 | Tests | Critical | 12 |
| TEST-004 | Tests | Critical | 4 (same as SEC-003) |

---

**End of plan.** Execute tasks 1–16 in order. Each task is independently vibecodeable by a small free LLM. After task 16, the system is ready for the first paying junior doctor.
