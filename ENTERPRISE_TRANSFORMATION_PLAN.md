# E-Logbook Enterprise — Master Transformation Plan v4

> **Canonical plan.** Supersedes `specs/001-premium-mobile-logbook/enterprise-transformation-plan.md`, `specs/002-enterprise-transformation-v2/plan.md`, `specs/003-enterprise-transformation-v3/plan.md`, `specs/enterprise-upgrade-plan.md`, `docs/superpowers/plans/*`, and `upgrade/implementation_plan.md`. Archive those after this plan is approved (Task P0.0).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (one fresh subagent per task, two-stage review) or `superpowers:executing-plans` (inline with checkpoints). Steps use `- [ ]` checkboxes. **Every task ends with a DOUBLE-CHECK step — do not skip it. Small or weak models MUST run the double-check literally, even if they "feel sure."**

**Generated:** 2026-06-29
**Auditors:** 5 parallel senior-architect agents (web / mobile / shared / supabase / root-infra), line-by-line.
**Goal:** Transform E-Logbook from a visually-polished prototype into a HIPAA/GDPR/SCFHS-auditable, enterprise-grade, multi-tenant medical SaaS — secure, observable, tested, accessible, and deployable.
**Architecture:** pnpm monorepo (Next.js web + Expo mobile + `@elogbook/shared` contract layer + Supabase Postgres + Deno Edge Functions). Server-authoritative offline sync via WatermelonDB. RLS + JWT claims for tenant isolation.
**Tech Stack:** TypeScript strict, Zod, Supabase (Postgres 17, Auth, Edge Functions, Storage), Stripe/Paddle/LemonSqueezy, WatermelonDB + SQLCipher, Sentry, Playwright/Detox, Vitest, Turborepo, GitHub Actions.

---

## 0. HOW TO USE THIS PLAN (READ BEFORE ANY TASK)

### 0.1 Iron rules for every executor (human or AI)

1. **One task per commit.** Commit messages use the exact format in each task. No drive-by edits.
2. **Never skip the DOUBLE-CHECK step.** It exists because weak models lie to themselves about being done. Run the listed command, paste the output, and verify it matches the **Expected** line. If it doesn't match, the task is NOT done — go back.
3. **If a task blocks you**, do not improvise. Mark the todo `blocked`, describe the blocker in the commit body, and stop. A reviewer will unblock.
4. **No new dependencies without listing them in the task's "Dependencies" line.** A weak model that silently `pnpm add`s something has failed the task.
5. **Tests are not optional.** Phase 1 installs the test scaffold; from Phase 2 onward every code-touching task includes a failing-test step. If you cannot write the test, you do not understand the task — re-read.
6. **Never commit secrets.** If a file you touch contains `sb_publishable_`, `service_role`, `sk_live`, `APP_ENCRYPTION_KEY`, or any `*_KEY`/`*_SECRET` literal value, STOP and ask.
7. **PHI is sacred.** `patient_mrn`, `patient_dob`, `patient_hash`, `field_values` are PHI. Never log them, never persist them to `localStorage`/`AsyncStorage` unencrypted, never send them to an AI provider.
8. **Reproduce before fix.** For any bug task, the first step is a failing test that reproduces the bug. No repro = no fix.
9. **Verify on the right platform.** Web tasks: `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/web lint && pnpm --filter @elogbook/web test`. Mobile tasks: same with `@elogbook/mobile`. Shared: `@elogbook/shared`. Supabase: `supabase db reset && supabase test db` locally.
10. **When in doubt, read the file again.** Weak models hallucinate APIs. Always Read the file you're about to Edit immediately before editing.

### 0.2 Verification primitives (memorize these commands)

| What | Command | Expected on success |
|------|---------|---------------------|
| Web typecheck | `pnpm --filter @elogbook/web typecheck` | exit 0, no output |
| Web lint | `pnpm --filter @elogbook/web lint` | exit 0, no output |
| Web test | `pnpm --filter @elogbook/web test` | `Test Files X passed`, `Tests Y passed`, 0 failed |
| Mobile typecheck | `pnpm --filter @elogbook/mobile typecheck` | exit 0, no output |
| Mobile lint | `pnpm --filter @elogbook/mobile lint` | exit 0, no output |
| Mobile test | `pnpm --filter @elogbook/mobile test` | all pass |
| Shared typecheck | `pnpm --filter @elogbook/shared typecheck` | exit 0, no output |
| Shared test | `pnpm --filter @elogbook/shared test` | all pass |
| Supabase reset | `supabase db reset` | `Resetting local database... Finished.` |
| Supabase RLS tests | `supabase test db` | all `ok` |
| Edge function tests | `supabase functions test ai-insights` | `ok` |
| Monorepo typecheck | `pnpm -r typecheck` | exit 0 across 3 packages |
| Monorepo lint | `pnpm -r lint` | exit 0 |
| Full test | `pnpm test` | all pass |
| Git status clean | `git status --porcelain` | empty (after commit) |

### 0.3 Phase gates

A phase is **DONE** only when ALL of these hold:
- Every task checkbox in the phase is `- [x]`.
- `pnpm -r typecheck && pnpm -r lint && pnpm test` are green on a clean checkout.
- The phase's "Gate Verification" block at the end passes.
- A reviewer has signed off (subagent-driven: reviewer subagent returns APPROVE).

Do not start Phase N+1 until Phase N is DONE. The one exception: Phase 0 (stop-the-bleeding) can run in parallel with Phase 1 (foundation) because they touch disjoint files — see Phase 0 header.

---

## 1. BRUTAL EXECUTIVE SUMMARY

This repo is **not enterprise-ready and must not process real PHI in its current state**. The `specs/001-premium-mobile-logbook/` documentation is exemplary, but the implementation beneath it has critical defects in every layer. A prior 2,865-line `enterprise-transformation-plan.md` self-identified ~222 issues; most remain unfixed.

### 1.1 Top 12 showstoppers (any one of these is a "do not ship to production" finding)

| # | Finding | Layer | Impact |
|---|---------|-------|--------|
| S1 | **Mobile Log Case screen has compile-breaking undefined identifiers** (`selectedTemplateId`, `step`, `setStep`, `setSelectedTemplateId` referenced but never declared). `tsc --noEmit` cannot pass; CI must be broken or not running. | mobile | Residents cannot log cases — the core user flow is broken. |
| S2 | **Mobile offline sync engine is dead in production.** `syncService.setTenantId()` is never called by any screen; every `initSync()` no-ops. Drafts never push; conflicts never detected. The headline feature does not function. | mobile | Offline-first claim is false; data loss on reinstall. |
| S3 | **`approve_case` / `reject_case` RPCs INSERT into `approval_requests` WITHOUT `tenant_id`**, which became `NOT NULL` in migration 00028. Every supervisor approval/rejection raises a constraint violation. | supabase | Approval workflow is broken end-to-end. |
| S4 | **No `FORCE ROW LEVEL SECURITY` on any table.** Table owner and `service_role` bypass RLS entirely. The entire tenant-isolation model is bypassable. | supabase | Cross-tenant PHI exposure via any SECURITY DEFINER function or service-role call. |
| S5 | **Migration `00037_encrypt_secret_columns.sql` is broken in sequence.** Views/functions reference `mode` (added in 00046); `SET NOT NULL` fails without `app.encryption_key`; `REVOKE/GRANT` is commented out so plaintext secret columns remain SELECTable by `authenticated`. `audit_config_change` then logs plaintext Stripe/AI keys to `audit_logs`. | supabase | Plaintext API keys & Stripe secrets readable + audited in clear. |
| S6 | **No encryption-at-rest on mobile WatermelonDB SQLite.** `patient_mrn`, `patient_dob`, `field_values` stored in plaintext. Lost/stolen device = PHI breach. | mobile | HIPAA/GDPR breach risk. |
| S7 | **Open redirect in `/login?next=`** — unvalidated, attacker can phish credentials post-login. Also in `/auth/callback`. | web | Credential phishing. |
| S8 | **`/cases/[id]/submit` POST route has no CSRF, no Origin check, no rate limit, no ownership check.** Any tenant member can submit any other resident's draft. | web | Forgery, accreditation integrity compromise. |
| S9 | **`ai-insights` edge function: `resident_id` taken from request body, never verified.** Any tenant member can impersonate any resident — read their case summaries, forge their AI quota/logs. Quota is also never incremented (enforcement is a no-op). Streaming mode never sends the disclaimer and streams content before safety check. | supabase | Cross-resident PHI leak, quota forgery, unsafe AI output. |
| S10 | **No real tests.** 11 test files; ~10 are `expect(true).toBe(true)` stubs. RLS test file is 88 lines of commented-out assertions. The spec explicitly refused to generate tests. | all | Every fix is unverifiable; regressions ship silently. |
| S11 | **No CI/CD.** CD workflow is `echo "Deploy web to production server"`. No branch protection, no required checks, no Sentry, no Dependabot, no SBOM, no SECURITY.md, no README, no LICENSE. | root | Not deployable; not auditable; not supportable. |
| S12 | **Fictional dependency versions.** `typescript ^6.0.0`, `next ^16.2.7`, `react ^19.2.7` — none exist on npm. Lockfile integrity is unverifiable. Three different Node versions across CI/Docker/docs. | root | Supply-chain integrity risk; reproducibility broken. |

### 1.2 Audit totals (consolidated from 5 parallel agent reports)

| Layer | CRITICAL | HIGH | MEDIUM | LOW | Total |
|-------|----------|------|--------|-----|-------|
| Web app | 8 | 7 | 6 | 2 | 23 |
| Mobile app | 3 | 9 | 9 | 4 | 25 |
| Shared package | 6 | 6 | 3 | 0 | 15 |
| Supabase backend | 13 | 12 | 9 | 2 | 36 |
| Root infrastructure | 11 | 9 | 0 | 0 | 20 |
| **TOTAL** | **41** | **43** | **27** | **8** | **119** |

Full per-finding detail is captured in the audit reports (preserved by the 5 parallel agents). This plan addresses every CRITICAL and HIGH finding and the most impactful MEDIUM/LOW ones.

---

## 2. PHASE OVERVIEW

| Phase | Theme | Tasks | Gate |
|-------|-------|-------|------|
| 0 | Stop the bleeding (CRITICAL security/data-loss) | P0.0–P0.12 | No known way to lose PHI or get exploited trivially |
| 1 | Foundation: tooling, tests, observability, types | P1.0–P1.18 | `pnpm -r typecheck && pnpm test` green with ≥40% shared coverage |
| 2 | Backend: RLS, triggers, edge functions, PHI | P2.0–P2.22 | `supabase test db` green; approvals work; AI quota enforced |
| 3 | Shared package: types, schemas, components, tokens | P3.0–P3.14 | Shared types match DB; light theme contrast ≥4.5:1; components consumed by both apps |
| 4 | Web app: security, perf, a11y, dead code | P4.0–P4.20 | Lighthouse a11y ≥95; no dead code; CSP clean; rate-limit per-user |
| 5 | Mobile app: sync, encryption, compile, a11y | P5.0–P5.18 | Sync round-trip works offline→online; SQLCipher on; biometrics on |
| 6 | Enterprise features: SSO, MFA, i18n, audit, monitoring | P6.0–P6.12 | SSO login works; MFA enforced for director+; 2 locales; Sentry capturing |
| 7 | Hardening & compliance: pen-test, DPIA, SBOM, BAA | P7.0–P7.8 | SBOM in CI; SECURITY.md live; pen-test report filed |
| 8 | Launch readiness: load, DR, runbooks, sign-off | P8.0–P8.6 | 5K-user load test passes; DR drill ≤4h; final sign-off |
| **TOTAL** | | **133 tasks** | |

Order is mostly sequential. Exceptions noted in phase headers.

---

## 3. PHASE 0 — STOP THE BLEEDING (CRITICAL)

> **Parallel with Phase 1.** Phase 0 touches security-critical files; Phase 1 touches tooling/tests. They do not overlap. Run them concurrently with two subagents if available. **No Phase 0 task may skip its DOUBLE-CHECK.**

### Task P0.0 — Archive prior transformation plans + file this plan as canonical

**Files:**
- Create: `specs/_archive/README.md`
- Move (via `git mv`): every prior transformation plan into `specs/_archive/`
- Delete: empty `ENTERPRISE_TRANSFORMATION/` directory

- [ ] **Step 1:** Create `specs/_archive/README.md` stating these are superseded by root `ENTERPRISE_TRANSFORMATION_PLAN.md`.
- [ ] **Step 2:** `git mv` each of: `specs/001-premium-mobile-logbook/enterprise-transformation-plan.md`, `specs/002-enterprise-transformation-v2/`, `specs/003-enterprise-transformation-v3/`, `specs/enterprise-upgrade-plan.md`, `upgrade/`, `docs/superpowers/plans/2026-06-15-enterprise-transformation-plan.md`, `docs/superpowers/plans/2026-06-03-elogbook-foundation.md`, `docs/superpowers/specs/2026-06-15-brutal-audit-upgrade-plan.md` into `specs/_archive/`.
- [ ] **Step 3:** Remove the empty `ENTERPRISE_TRANSFORMATION/` directory.
- [ ] **Step 4: DOUBLE-CHECK.** Run `git status --porcelain` — every line should be a rename (`R  ...`). Run `Test-Path specs/_archive` → `True`. `Get-ChildItem specs -Directory | Select-Object Name` → shows `001-premium-mobile-logbook` and `_archive` only.
- [ ] **Step 5:** Commit: `chore: archive superseded transformation plans under specs/_archive/`

### Task P0.1 — Remove live Supabase URL + anon key from committed documentation

**Files:**
- Modify: `PROJECT_ANALYSIS.md:556-557`
- Modify: any `specs/_archive/**` file containing `nuyedxkzaimlzaetbpaw`
- Modify: `.gitignore` (add `supabase/.temp/` and `*.temp/`)

- [ ] **Step 1:** Use Grep tool with pattern `nuyedxkzaimlzaetbpaw` to find every leak.
- [ ] **Step 2:** For each match in a tracked file, replace `nuyedxkzaimlzaetbpaw` with `<SUPABASE_PROJECT_ID>` and the full anon key `sb_publishable_yVAsnpYhEv5GSIeMfMnlyg_r4EXeBo3` with `<SUPABASE_ANON_KEY>`. Do NOT touch `.env.local` / `apps/mobile/.env` (gitignored).
- [ ] **Step 3:** Add `supabase/.temp/` and `*.temp/` to `.gitignore`.
- [ ] **Step 4: DOUBLE-CHECK.** `grep -r "nuyedxkzaimlzaetbpaw" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.json" --include="*.yml" --include="*.yaml" .` should return ONLY gitignored `.env*` files. If anything else matches, fix it.
- [ ] **Step 5:** Commit: `security: redact live Supabase project ID and anon key from tracked docs`

### Task P0.2 — Fix open redirect in `/login?next=` and `/auth/callback`

**Files:**
- Modify: `apps/web/app/login/page.tsx:44-45`
- Modify: `apps/web/app/auth/callback/route.ts:14`
- Create: `apps/web/lib/safe-redirect.ts`
- Create: `apps/web/lib/__tests__/safe-redirect.test.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/web/lib/__tests__/safe-redirect.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { safeRelativePath } from '../safe-redirect';

describe('safeRelativePath', () => {
  it('allows a single-leading-slash relative path', () => {
    expect(safeRelativePath('/dashboard')).toBe('/dashboard');
  });
  it('strips a protocol-relative URL', () => {
    expect(safeRelativePath('//evil.com/x')).toBe('/');
  });
  it('strips an absolute URL', () => {
    expect(safeRelativePath('https://evil.com/x')).toBe('/');
  });
  it('strips a backslash-relative URL', () => {
    expect(safeRelativePath('/\\evil.com')).toBe('/');
  });
  it('defaults to / when input is empty', () => {
    expect(safeRelativePath('')).toBe('/');
  });
  it('defaults to / when input is null', () => {
    expect(safeRelativePath(null)).toBe('/');
  });
  it('preserves query and hash on relative paths', () => {
    expect(safeRelativePath('/cases?x=1#y')).toBe('/cases?x=1#y');
  });
});
```

- [ ] **Step 2:** Run `pnpm --filter @elogbook/web test -- safe-redirect` — expected: FAIL (`safeRelativePath` not defined).
- [ ] **Step 3:** Create `apps/web/lib/safe-redirect.ts`:

```typescript
export function safeRelativePath(input: string | null | undefined): string {
  if (!input) return '/';
  if (!input.startsWith('/')) return '/';
  if (input.startsWith('//')) return '/';
  if (input.startsWith('/\\')) return '/';
  return input;
}
```

- [ ] **Step 4:** Run the test — expected: PASS (7/7).
- [ ] **Step 5:** Edit `apps/web/app/login/page.tsx` — replace `router.push(next)` with `router.push(safeRelativePath(next))` and import `safeRelativePath` from `@/lib/safe-redirect`.
- [ ] **Step 6:** Edit `apps/web/app/auth/callback/route.ts` — replace `${next}` with `${safeRelativePath(next)}`.
- [ ] **Step 7: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` exit 0. `pnpm --filter @elogbook/web test -- safe-redirect` — all 7 pass. Manually: `open "http://localhost:3000/login?next=//evil.com"` and confirm redirect stays on origin.
- [ ] **Step 8:** Commit: `security(web): close open-redirect in /login and /auth/callback via safeRelativePath`

### Task P0.3 — Add CSRF + ownership + rate-limit to `/cases/[id]/submit`

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts:4-76`
- Create: `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.test.ts`

- [ ] **Step 1:** Read the current route file to understand the existing flow.
- [ ] **Step 2: Write a failing test** asserting: (a) POST without Origin header → 403; (b) POST from a different resident's draft → 403; (c) POST from the owning resident with valid Origin → 200 and case transitions to `pending`. Use the mock scaffold from P1.5 (if not ready, write the test and `it.skip` it — but WRITE it).
- [ ] **Step 3:** Refactor the route to go through `withTenantAuth` (adds Origin validation + rate limit + role gate). Add `entry.resident_id === auth.profile.id` ownership check before updating status.
- [ ] **Step 4:** Un-skip the test once the mock helper exists (P1.5). Run it. Expected: PASS.
- [ ] **Step 5: DOUBLE-CHECK.** Read the route file once more — confirm: (1) `withTenantAuth` wraps the handler, (2) ownership check exists, (3) no raw `await supabase.from('case_entries')...` outside the wrapper. `pnpm --filter @elogbook/web typecheck` exit 0.
- [ ] **Step 6:** Commit: `security(web): require CSRF, ownership, and rate-limit on case submit route`

### Task P0.4 — Add CSRF to `/api/[tenant]/admin/payment-gateway`

**Files:**
- Modify: `apps/web/app/api/[tenant]/admin/payment-gateway/route.ts:6-68`

- [ ] **Step 1:** Replace the manual auth in the route with `withTenantAuth`. The handler becomes `withTenantAuth(async ({ supabase, auth, req }) => { ... })`.
- [ ] **Step 2:** Ensure role check is `institution_admin` or higher (verify by reading `apps/web/lib/api-middleware.ts` for the `roles` option).
- [ ] **Step 3: DOUBLE-CHECK.** Read the modified file. Confirm: no raw `req.json` outside the wrapper, role check present, Origin validation inherited. `pnpm --filter @elogbook/web typecheck` exit 0.
- [ ] **Step 4:** Commit: `security(web): route payment-gateway admin endpoint through withTenantAuth (CSRF + rate-limit)`

### Task P0.5 — Fix `approve_case` / `reject_case` missing `tenant_id` (S3 — BROKEN APPROVALS)

**Files:**
- Create: `supabase/migrations/00048_fix_approval_tenant_id.sql`
- Create: `supabase/tests/approve_reject_tenant_id.test.sql`

> **This is S3. Supervisor approvals are broken end-to-end.** Highest-impact backend fix in the plan.

- [ ] **Step 1:** Read `supabase/migrations/00034_fix_approval_forgery.sql` to see the current `approve_case`/`reject_case` definitions. Confirm the INSERT omits `tenant_id`.
- [ ] **Step 2: Write the failing test.** Create `supabase/tests/approve_reject_tenant_id.test.sql`:

```sql
BEGIN;
SELECT plan(2);
INSERT INTO institutions (id, name, slug) VALUES ('11111111-1111-1111-1111-111111111111','T','t');
INSERT INTO tenants (id, institution_id, tenant_type, name, slug) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','institution','T','t');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name) VALUES ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','supervisor','S');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name) VALUES ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','66666666-6666-6666-6666-666666666666','resident','R');
INSERT INTO case_entries (id, tenant_id, resident_id, template_id, status, case_date, is_deidentified)
  VALUES ('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000','pending','2026-01-01', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"tenant_id":"22222222-2222-2222-2222-222222222222","user_role":"supervisor"}}', false);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
SELECT lives_ok(format('SELECT approve_case(%L, %L, %L)', '77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333', 'ok'), 'approve_case should not raise');
SELECT is((SELECT status FROM case_entries WHERE id='77777777-7777-7777-7777-777777777777'), 'approved', 'case should be approved');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3:** Run `supabase db reset && supabase test db approve_reject_tenant_id`. Expected: FAIL (raises `null value in column "tenant_id" violates not-null constraint`).
- [ ] **Step 4:** Create `supabase/migrations/00048_fix_approval_tenant_id.sql` that drops/recreates `approve_case` and `reject_case` with `tenant_id` in the INSERT, sourced from the case row's `tenant_id` (verify it equals `get_tenant_id()` for defense-in-depth). Include `SET search_path = public` (per the convention in P2.0). Read `00034_fix_approval_forgery.sql` first to copy the exact function bodies.
- [ ] **Step 5:** Run `supabase db reset && supabase test db approve_reject_tenant_id`. Expected: PASS (`2 tests, 0 failures`).
- [ ] **Step 6: DOUBLE-CHECK.** Read the new migration. Confirm: (1) both functions have `tenant_id` in the INSERT, (2) `SET search_path = public` present, (3) `SECURITY DEFINER` present, (4) auth check still present. Read the test file once more — confirm it would catch a regression.
- [ ] **Step 7:** Commit: `fix(supabase): include tenant_id in approve_case/reject_case INSERT (unbreaks supervisor approvals)`

### Task P0.6 — Add `FORCE ROW LEVEL SECURITY` to every tenant-scoped table (S4)

**Files:**
- Create: `supabase/migrations/00049_force_rls_all_tables.sql`
- Create: `supabase/tests/force_rls.test.sql`

- [ ] **Step 1:** Grep `supabase/migrations/*.sql` for `CREATE TABLE` to enumerate all tenant-scoped tables (~24): `institutions, tenants, profiles, case_templates, case_entries, case_attachments, approval_requests, audit_logs, program_goals, goal_progress, subscription_plans, subscriptions, payments, one_time_purchases, ai_config, resident_ai_toggle, ai_query_logs, payment_gateway_config, accreditation_frameworks, attachment_signatures, institution_billing, consent_records, ai_response_cache, stripe_events, rate_limits`.
- [ ] **Step 2: Write the failing test.** Create `supabase/tests/force_rls.test.sql` that queries `pg_class.relforcerowsecurity` for each table and asserts `true`.
- [ ] **Step 3:** Run `supabase db reset && supabase test db force_rls`. Expected: FAIL (every table reports `false`).
- [ ] **Step 4:** Create `00049_force_rls_all_tables.sql` with `ALTER TABLE public.<table> FORCE ROW LEVEL SECURITY;` for each table. For `rate_limits` (which has no RLS yet — see P2.5), enable RLS first.
- [ ] **Step 5:** Run `supabase db reset && supabase test db force_rls`. Expected: PASS.
- [ ] **Step 6: DOUBLE-CHECK.** Run `supabase db reset` then in `psql`:

```sql
SELECT relname FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE pg_namespace.nspname = 'public' AND relkind = 'r'
AND NOT relforcerowsecurity AND relname NOT IN ('schema_migrations');
```

  Expected: zero rows. If any row returns, add it to the migration.
- [ ] **Step 7:** Commit: `security(supabase): FORCE ROW LEVEL SECURITY on all tenant-scoped tables`

### Task P0.7 — Stop logging plaintext secrets to `audit_logs`

**Files:**
- Create: `supabase/migrations/00050_redact_secrets_in_audit.sql`

- [ ] **Step 1:** Read `supabase/migrations/00046_add_missing_audit_triggers.sql` lines 18-21 — confirm `audit_config_change` writes `row_to_json(NEW)` for `ai_config` and `payment_gateway_config`.
- [ ] **Step 2:** Create `00050_redact_secrets_in_audit.sql` that drops and recreates `audit_config_change` to strip `encrypted_api_key`, `encrypted_secret_key`, `encrypted_webhook_secret`, `*_enc` bytea columns from the JSON before insert. Use `jsonb_strip_nulls(row_to_json(NEW)::jsonb - 'encrypted_api_key' - 'encrypted_secret_key' - 'encrypted_webhook_secret' - 'api_key_enc' - 'secret_key_enc' - 'webhook_secret_enc')`. Re-attach triggers.
- [ ] **Step 3: DOUBLE-CHECK.** Manually: `supabase db reset`, sign in as admin, update AI config, then `SELECT changes FROM audit_logs ORDER BY created_at DESC LIMIT 1;` — confirm no `encrypted_*` key appears in the JSON.
- [ ] **Step 4:** Commit: `security(supabase): redact plaintext secrets from audit_config_change trigger`

### Task P0.8 — Make `audit_logs` append-only

**Files:**
- Create: `supabase/migrations/00051_audit_logs_append_only.sql`

- [ ] **Step 1:** Create the migration:

```sql
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, authenticated, anon, service_role;
CREATE OR REPLACE FUNCTION public.reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_block_audit_update ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_block_audit_delete ON public.audit_logs;
CREATE TRIGGER trg_block_audit_update BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER trg_block_audit_delete BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
```

- [ ] **Step 2:** `supabase db reset`. Manually `UPDATE audit_logs SET action='x' WHERE id='...';` — expected: exception raised.
- [ ] **Step 3: DOUBLE-CHECK.** Run `SELECT has_table_privilege('authenticated','audit_logs','UPDATE');` → `false`. Run `SELECT has_table_privilege('service_role','audit_logs','DELETE');` → `false`.
- [ ] **Step 4:** Commit: `security(supabase): make audit_logs append-only (REVOKE + reject triggers)`

### Task P0.9 — Fix mobile Log Case compile errors (S1)

**Files:**
- Modify: `apps/mobile/app/(tabs)/log-case.tsx:87,97,111,116,121`

> **This is S1. The primary resident screen does not compile.** Read the file before touching.

- [ ] **Step 1:** Read `apps/mobile/app/(tabs)/log-case.tsx` fully. Identify every reference to `selectedTemplateId`, `setSelectedTemplateId`, `step`, `setStep`. Compare to the actual state declarations (which use `selectedTemplate`/`setSelectedTemplate` and likely a different step state name).
- [ ] **Step 2:** Decide: either (a) restore the missing state declarations, or (b) rename the references to the existing state. Prefer (a) if the autosave/draft-recovery logic semantically needs `selectedTemplateId` and a `step` counter separate from the template object.
- [ ] **Step 3:** Make the minimal change. Do NOT refactor anything else in this 579-line file in this task.
- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/mobile typecheck` — exit 0. `pnpm --filter @elogbook/mobile lint` — exit 0. Re-read every line you changed; confirm no other reference to the old names remains (Grep `selectedTemplateId|setSelectedTemplateId|\bstep\b|setStep` in the file).
- [ ] **Step 5:** Commit: `fix(mobile): restore missing state declarations in Log Case screen (unbreaks tsc)`

### Task P0.10 — Wire `syncService.setTenantId()` so offline sync actually runs (S2)

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/lib/sync.ts` (if the API needs adjustment)
- Create: `apps/mobile/lib/__tests__/sync.tenant.test.ts`

> **This is S2. Offline sync is dead.** This task makes it run; full correctness (conflict resolution, id divergence, atomicity) is Phase 5.

- [ ] **Step 1:** Read `apps/mobile/lib/sync.ts:37,44-46,248-252` — confirm `tenantId` is undefined and `initSync` early-returns.
- [ ] **Step 2:** Read `apps/mobile/app/_layout.tsx` and `(tabs)/_layout.tsx` — find the auth state listener that fires on `SIGNED_IN`. After session is confirmed, fetch the user's `profiles` row to get `tenant_id`, then call `syncService.setTenantId(tenantId)` and `syncService.startPeriodicSync()`. On `SIGNED_OUT`, call `syncService.setTenantId(undefined)` and `syncService.cleanup()`.
- [ ] **Step 3:** Add a `useSyncInit` hook in `apps/mobile/lib/sync.ts` that encapsulates this so screens don't repeat it. Call it once from `(tabs)/_layout.tsx`.
- [ ] **Step 4: Write the test** `apps/mobile/lib/__tests__/sync.tenant.test.ts` — mock the Supabase client; assert that after sign-in, `syncService.tenantId` is set and `startPeriodicSync` was called; after sign-out, `tenantId` is undefined.
- [ ] **Step 5:** Run `pnpm --filter @elogbook/mobile test -- sync.tenant`. Expected: PASS.
- [ ] **Step 6: DOUBLE-CHECK.** Manually: launch the app, sign in as `resident@demo.com`, open the sync status indicator on the dashboard — confirm it shows "Synced" with a recent timestamp (not "Never" or empty). Add a draft case in airplane mode, re-enable network, confirm it appears on web within 60s.
- [ ] **Step 7:** Commit: `fix(mobile): wire syncService.setTenantId from auth state so offline sync runs`

### Task P0.11 — Replace mobile `generatePatientHash` with `expo-crypto` SHA-256

**Files:**
- Modify: `apps/mobile/app/(tabs)/log-case.tsx:27-35,256`
- Add dep: `expo-crypto` (declared in `apps/mobile/package.json`)

- [ ] **Step 1:** Read the existing `generatePatientHash` — confirm it's a 32-bit DJB2 with `Date.now()+Math.random()` salt.
- [ ] **Step 2:** Add `expo-crypto` to `apps/mobile/package.json` deps (latest stable).
- [ ] **Step 3:** Replace `generatePatientHash` with an async function using `Crypto.digestStringAsync(CryptoDigestAlgorithm.SHA256, `${tenantId}:${mrn}:${dob}`)`. Match the server-side `hash_patient_mrn` salt convention (read `supabase/migrations/00047_configurable_hash_salt.sql`; fetch the salt via an authenticated edge function call at login and cache in SecureStore).
- [ ] **Step 4:** Update all call sites to `await generatePatientHash(...)`.
- [ ] **Step 5: DOUBLE-CHECK.** Write a quick assertion in the screen's submit handler: hash the same MRN+DOB twice — confirm identical output (determinism). `pnpm --filter @elogbook/mobile typecheck` exit 0.
- [ ] **Step 6:** Commit: `fix(mobile): use expo-crypto SHA-256 for patient_hash (deterministic, cryptographic)`

### Task P0.12 — Stop persisting PHI to web `localStorage` autosave

**Files:**
- Modify: `apps/web/components/CaseForm.tsx:139-148`

- [ ] **Step 1:** Read the autosave effect. Confirm `patientMrn` and `patientDob` are included in the JSON blob written to `localStorage`.
- [ ] **Step 2:** Strip those two fields from the persisted object. Keep `templateId`, `fieldValues` (de-identified clinical content only — verify field_values can't contain PHI; if it can, also strip), `isDeidentified`, `caseDate`, `accreditationMappings`.
- [ ] **Step 3:** Add a comment: `// PHI fields (patientMrn, patientDob) are intentionally NOT persisted`.
- [ ] **Step 4: DOUBLE-CHECK.** Open the case form in the browser, enter an MRN and DOB, wait 2s, then in DevTools: `localStorage.getItem('case-draft-...')` — confirm the JSON has NO `patientMrn` / `patientDob` keys. `pnpm --filter @elogbook/web typecheck` exit 0.
- [ ] **Step 5:** Commit: `security(web): exclude patientMrn and patientDob from localStorage autosave`

---

## 4. PHASE 1 — FOUNDATION: TOOLING, TESTS, OBSERVABILITY, TYPES

> **Sequential.** Phase 1 must complete before Phase 2 because Phase 2 tasks require the test scaffold. Phase 1 may run in parallel with Phase 0 (disjoint files).

### Task P1.0 — Pin Node/pnpm/engines; add `.nvmrc`; align Docker/CI

**Files:** root `package.json`, `.nvmrc`, `Dockerfile:1`, `.github/workflows/ci.yml`, `.github/workflows/cd.yml`

- [ ] **Step 1:** Pick Node 20.x (LTS) — verify `pnpm --filter @elogbook/web typecheck` passes on Node 20.
- [ ] **Step 2:** Add to root `package.json`: `"engines": { "node": ">=20.11.0 <21", "pnpm": ">=9.0.0 <10" }, "packageManager": "pnpm@9.15.0"`.
- [ ] **Step 3:** Create `.nvmrc` containing `20.11.0`.
- [ ] **Step 4:** Change `Dockerfile:1` from `node:22-alpine` to `node:20.11-alpine`.
- [ ] **Step 5:** Verify CI workflows `node-version: 20` and `pnpm-version: 9`; bump `pnpm/action-setup@v3` → `@v4` in `cd.yml`.
- [ ] **Step 6: DOUBLE-CHECK.** `node --version` matches. `pnpm --filter @elogbook/web typecheck` still exit 0. `Get-Content .nvmrc` → `20.11.0`. `Dockerfile` first line is `FROM node:20.11-alpine`.
- [ ] **Step 7:** Commit: `chore: pin Node 20.11 + pnpm 9 across repo, Docker, CI`

### Task P1.1 — Replace fictional dependency versions with real, published versions (S12)

**Files:** root `package.json`, `apps/web/package.json`, `apps/mobile/package.json`, `packages/shared/package.json`

> **This is S12.** `typescript ^6.0.0`, `next ^16.2.7`, `react ^19.2.7` do not exist on npm.

- [ ] **Step 1:** Run `pnpm view typescript version`, `pnpm view next version`, `pnpm view react version`, `pnpm view react-native version`, `pnpm view @heroui/react version`, `pnpm view nativewind version`, `pnpm view framer-motion version` — note real latest stable for each.
- [ ] **Step 2:** Replace every fictional version with the real latest stable. Pin with `^` (caret).
- [ ] **Step 3:** Run `pnpm install` — confirm it resolves and writes `pnpm-lock.yaml` against real packages.
- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` exit 0. `pnpm --filter @elogbook/mobile typecheck` exit 0. `pnpm --filter @elogbook/shared typecheck` exit 0. If any fails, the version bump broke an API — read the breaking-change notes and fix the call sites (separate commits per package if needed).
- [ ] **Step 5:** Commit: `chore: replace fictional dep versions (TS 6/Next 16/React 19.2) with real published versions`

### Task P1.2 — Add Turborepo for build orchestration

**Files:** `turbo.json` (new), root `package.json`, each package's `package.json`

- [ ] **Step 1:** `pnpm add -Dw turbo` (real version per P1.1).
- [ ] **Step 2:** Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 3:** Add turbo scripts to root `package.json` (e.g. `"dev": "turbo run dev --parallel"`). Keep existing `dev:web`/`dev:mobile` aliases.
- [ ] **Step 4: DOUBLE-CHECK.** `pnpm turbo typecheck` — runs typecheck across all packages with caching. Confirm `node_modules/.cache/turbo` appears after first run, and second run hits cache (telemetry shows `FULL TURBO`).
- [ ] **Step 5:** Commit: `build: add Turborepo for cached, incremental task orchestration`

### Task P1.3 — Add root `README.md`, `SECURITY.md`, `LICENSE`, `CONTRIBUTING.md`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`

**Files:** six new files at repo root.

- [ ] **Step 1:** `README.md` — project name, one-paragraph purpose, architecture diagram (text), quickstart (`pnpm install`, `supabase start`, `pnpm dev:web`), link to `ENTERPRISE_TRANSFORMATION_PLAN.md` and `specs/001-premium-mobile-logbook/`, demo accounts, license.
- [ ] **Step 2:** `SECURITY.md` — responsible disclosure `security@elogbook.example`, 72h SLA, PGP key placeholder, scope, safe-harbor clause.
- [ ] **Step 3:** `LICENSE` — full MIT text with copyright holder placeholder.
- [ ] **Step 4:** `CONTRIBUTING.md` — branch model, PR checklist (tests, typecheck, lint, no secrets), DCO sign-off, code style pointer, link to this plan.
- [ ] **Step 5:** `CHANGELOG.md` — Keep a Changelog format, `[Unreleased]` section listing the Phase 0 work.
- [ ] **Step 6:** `CODE_OF_CONDUCT.md` — verbatim Contributor Covenant 2.1.
- [ ] **Step 7: DOUBLE-CHECK.** `Get-ChildItem README.md,SECURITY.md,LICENSE,CONTRIBUTING.md,CHANGELOG.md,CODE_OF_CONDUCT.md | Select-Object Name, Length` — all six exist with non-zero length.
- [ ] **Step 8:** Commit: `docs: add README, SECURITY, LICENSE, CONTRIBUTING, CHANGELOG, CODE_OF_CONDUCT`

### Task P1.4 — Fix `docker-compose.yml` so it actually runs

**Files:** `docker-compose.yml`, move `Dockerfile` → `apps/web/Dockerfile`, optionally `nginx.conf`

- [ ] **Step 1:** Read `docker-compose.yml` — list broken references: (a) `context: ./apps/web` + `dockerfile: Dockerfile` (Dockerfile is at root); (b) `./nginx.conf` does not exist; (c) `redis` service unused.
- [ ] **Step 2:** `git mv Dockerfile apps/web/Dockerfile`. Update paths inside it for the new context.
- [ ] **Step 3:** Remove the `redis` service (rate-limit moves to Supabase RPC in P2.5).
- [ ] **Step 4:** Either create a minimal `nginx.conf` or remove the `nginx` service (prefer remove for now).
- [ ] **Step 5:** Add `healthcheck` to the `web` service: `test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"], interval: 30s, timeout: 5s, retries: 3`.
- [ ] **Step 6: DOUBLE-CHECK.** `docker compose config` — no warnings about missing files. `docker compose build web` — succeeds. `docker compose up -d web` — `docker compose ps` shows healthy within 60s. `curl http://localhost:3000/api/health` — returns `{"status":"ok"}`.
- [ ] **Step 7:** Commit: `fix(docker): move Dockerfile to apps/web, remove unused redis/nginx, add healthcheck`

### Task P1.5 — Build the test mocking scaffold (Supabase + auth + fetch)

**Files:**
- Create: `apps/web/lib/__tests__/helpers/supabase-mock.ts`
- Create: `apps/web/lib/__tests__/helpers/auth-mock.ts`
- Create: `apps/mobile/lib/__tests__/helpers/supabase-mock.ts`
- Create: `packages/shared/src/test/fixtures.ts`

- [ ] **Step 1:** Web `supabase-mock.ts` — a `createMockSupabaseClient()` returning a client with `from(table)` returning a chainable builder (`select/insert/update/delete/eq/gte/lt/limit/range/single/maybeSingle/order`) whose terminal calls return `{ data, error }` from a per-table fixture map. Expose `setTableData(table, rows)` and `assertQuery(table, expectedFilter)`.
- [ ] **Step 2:** Web `auth-mock.ts` — a `mockAuthContext(role, tenantId)` returning the shape `getAuthContext` yields, used to seed `withTenantAuth` tests.
- [ ] **Step 3:** Mobile `supabase-mock.ts` — same pattern, but also mock `auth.getUser`, `auth.onAuthStateChange`, `functions.invoke`.
- [ ] **Step 4:** `packages/shared/src/test/fixtures.ts` — factory functions: `makeProfile()`, `makeCaseEntry()`, `makeTenant()`, `makeTemplate()`, each accepting partial overrides.
- [ ] **Step 5: Write a smoke test** in each package that uses the mock to fetch a fixture and assert the shape. Run them — expected PASS.
- [ ] **Step 6: DOUBLE-CHECK.** `pnpm test` — all smoke tests pass. Read the mock files; confirm they don't import real `@supabase/supabase-js`.
- [ ] **Step 7:** Commit: `test: add Supabase/auth mocking scaffold for web + mobile + shared fixtures`

### Task P1.6 — Install Playwright; wire `pnpm test:e2e`; replace orphan stubs

**Files:** `apps/web/playwright.config.ts` (new), `apps/web/e2e/login.spec.ts`, `apps/web/e2e/dashboard.spec.ts`, `apps/web/package.json`

- [ ] **Step 1:** `pnpm --filter @elogbook/web add -D @playwright/test`.
- [ ] **Step 2:** Create `apps/web/playwright.config.ts` with `webServer: { command: 'pnpm dev', port: 3000, reuseExistingServer: true }`, `baseURL: 'http://localhost:3000'`, one chromium project.
- [ ] **Step 3:** Rewrite `e2e/login.spec.ts` to: navigate to `/login`, fill `resident@demo.com` / `password123!`, submit, assert URL becomes `/{slug}/dashboard`. (Requires `supabase db reset` for demo accounts.)
- [ ] **Step 4:** Rewrite `e2e/dashboard.spec.ts` to: log in, assert the KPI section renders with at least one ring, assert the recent-cases panel renders.
- [ ] **Step 5: DOUBLE-CHECK.** `pnpm --filter @elogbook/web exec playwright install chromium`. `pnpm --filter @elogbook/web test:e2e` — both specs pass. If they fail because the dev server didn't start in time, increase `webServer.timeout`.
- [ ] **Step 6:** Commit: `test(web): install Playwright, wire test:e2e, replace stub e2e specs with real flows`

### Task P1.7 — Set Vitest coverage thresholds; un-exclude `__tests__/` from typecheck

**Files:** `apps/web/tsconfig.json`, `apps/mobile/tsconfig.json`, `packages/shared/tsconfig.json`, `vitest.config.ts` (root)

- [ ] **Step 1:** Remove `__tests__/` (and `**/__tests__/**`) from `exclude` in all three `tsconfig.json` files.
- [ ] **Step 2:** Add thresholds to root `vitest.config.ts`:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  thresholds: { statements: 40, branches: 40, functions: 40, lines: 40 },
},
```

  Start at 40% — raise in P8.x once real tests land.
- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` — now type-checks test files too; fix any type errors in existing tests. `pnpm test:coverage` — exits 0 only if thresholds met. If thresholds fail, that's expected at this point — do NOT lower thresholds; note in the commit body that thresholds will be met by end of Phase 2.
- [ ] **Step 4:** Commit: `test: un-exclude __tests__ from typecheck, set vitest coverage thresholds at 40%`

### Task P1.8 — Replace all `expect(true).toBe(true)` stubs with real tests or delete them

**Files:** `apps/web/components/__tests__/ErrorBoundary.test.tsx`, `apps/web/app/api/__tests__/health.test.ts`, `apps/mobile/__tests__/app.test.ts`, `apps/mobile/components/__tests__/GlassPanel.test.tsx`, `apps/mobile/components/__tests__/StatusBadge.test.tsx`, `supabase/functions/_shared/__tests__/auth.test.ts`

- [ ] **Step 1:** For each stub: either rewrite as a real test, or delete the file. Prefer real tests:
  - `ErrorBoundary.test.tsx` — render with a child that throws, assert error UI shows.
  - `health.test.ts` — assert the actual response shape `{ status: 'ok' }`.
  - `app.test.ts` — render `<App />` with mocked providers, assert it renders without crash.
  - `GlassPanel.test.tsx` — render with children, assert the blur view wrapper exists.
  - `StatusBadge.test.tsx` — render each variant, assert the status text matches.
  - `auth.test.ts` (edge fn) — test `authenticate()` with a valid and an expired JWT.
- [ ] **Step 2: DOUBLE-CHECK.** `grep -r "expect(true).toBe(true)" --include="*.ts" --include="*.tsx" .` — zero matches. `pnpm test` — all pass.
- [ ] **Step 3:** Commit: `test: replace all expect(true).toBe(true) stubs with real assertions`

### Task P1.9 — Install Sentry in web and mobile

**Files:** `apps/web/sentry.client.config.ts`, `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts` (new), `apps/mobile/sentry.config.ts` (new), `apps/web/next.config.js`, `apps/mobile/app/_layout.tsx`, all `error.tsx` files, `apps/web/components/ErrorBoundary.tsx`, `.env.example`

- [ ] **Step 1:** `pnpm --filter @elogbook/web add @sentry/nextjs`. `pnpm --filter @elogbook/mobile add @sentry/react-native`.
- [ ] **Step 2:** Run `pnpm --filter @elogbook/web exec @sentry/wizard@latest -i nextjs` if available, else create the three config files manually with a DSN read from `process.env.NEXT_PUBLIC_SENTRY_DSN`. Disable in dev if DSN missing.
- [ ] **Step 3:** Wrap `next.config.js`: `module.exports = withSentryConfig(nextConfig, { silent: true, hideSourceMaps: true })`.
- [ ] **Step 4:** Mobile: `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN, enableInExpoDevelopment: false })` in `_layout.tsx` before `<ErrorBoundary>`.
- [ ] **Step 5:** Replace `console.error(error)` in every `error.tsx` with `Sentry.captureException(error, { extra: { route } })`.
- [ ] **Step 6:** In `ErrorBoundary.tsx`, add `componentDidCatch(error, info) { Sentry.captureException(error, { contexts: { react: info } }); }`.
- [ ] **Step 7: DOUBLE-CHECK.** Set a fake DSN, trigger an error in dev (throw in a component), confirm an event appears in Sentry's dev dashboard OR (if no Sentry account) confirm `Sentry.captureException` is called via a spy test. `pnpm --filter @elogbook/web typecheck` exit 0. `pnpm --filter @elogbook/mobile typecheck` exit 0.
- [ ] **Step 8:** Commit: `feat(observability): install Sentry in web + mobile, wire error boundaries and route errors`

### Task P1.10 — Add structured logger to web; replace raw `console` calls

**Files:** `apps/web/lib/logger.ts` (new), `apps/web/lib/__tests__/logger.test.ts` (new), `apps/web/app/error.tsx`, `apps/web/lib/performance.ts`

- [ ] **Step 1:** Create `apps/web/lib/logger.ts` exporting `logger` with `info/warn/error/debug` methods that emit structured JSON `{ level, msg, route, requestId, timestamp }` via `console` (server) or `navigator.sendBeacon('/api/log', ...)` (client, in prod only).
- [ ] **Step 2:** Test it: assert JSON shape, assert PHI keys (`patient_mrn`/`patient_dob`) are redacted if present in the payload.
- [ ] **Step 3:** Replace `console.error` in `apps/web/app/error.tsx` with `logger.error(error, { route })`.
- [ ] **Step 4:** Replace `console.warn` in `apps/web/lib/performance.ts` with `logger.warn`.
- [ ] **Step 5: DOUBLE-CHECK.** `grep -n "console\.\(log\|error\|warn\|debug\)" apps/web/app apps/web/lib apps/web/components` — only acceptable sites remain (logger internals). `pnpm --filter @elogbook/web test -- logger` passes.
- [ ] **Step 6:** Commit: `feat(observability): add structured logger with PHI redaction; replace raw console calls`

### Task P1.11 — Add request ID propagation + X-Request-Id on all API routes

**Files:** `apps/web/lib/api-middleware.ts:46`, `apps/web/lib/logger.ts`, `apps/web/lib/request-context.ts` (new)

- [ ] **Step 1:** Create `apps/web/lib/request-context.ts` using `AsyncLocalStorage` to hold the current `requestId`.
- [ ] **Step 2:** In `withTenantAuth`, set the request context at the start: `requestContext.run({ requestId }, () => handler(...))`.
- [ ] **Step 3:** Logger reads `requestContext.getStore()?.requestId` and includes it in every log line.
- [ ] **Step 4:** Non-`withTenantAuth` routes (e.g. `/api/health`) — wrap them in `withRequestContext` (a thinner middleware that just sets the ID and forwards).
- [ ] **Step 5: DOUBLE-CHECK.** Hit `/api/health` with `curl -v http://localhost:3000/api/health` — response has `X-Request-Id` header. Hit it with `curl -H "X-Request-Id: test-123" http://localhost:3000/api/health` — response has `X-Request-Id: test-123` (echoed).
- [ ] **Step 6:** Commit: `feat(observability): propagate X-Request-Id across all API routes via AsyncLocalStorage`

### Task P1.12 — Generate Supabase TypeScript types and consume them

**Files:** `apps/web/lib/supabase/database.types.ts` (new), `apps/mobile/lib/supabase/database.types.ts` (new), `apps/web/lib/supabase/{client,server,admin}.ts`, `apps/mobile/lib/supabase.ts`

- [ ] **Step 1:** Run `supabase gen types typescript --local > apps/web/lib/supabase/database.types.ts`.
- [ ] **Step 2:** Copy the same file to `apps/mobile/lib/supabase/database.types.ts` (or symlink via workspace).
- [ ] **Step 3:** Update `createClient` calls to `createClient<Database>(...)` so all queries are typed.
- [ ] **Step 4:** Fix the `((caseRows ?? []) as unknown) as CaseRow[]` double-casts (per web audit D2) — they should now be unnecessary.
- [ ] **Step 5: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` — exit 0. Grep for `as unknown as` in `apps/web/app` — should be zero or greatly reduced.
- [ ] **Step 6:** Commit: `types: generate Supabase Database types and consume them in web + mobile clients`

### Task P1.13 — Add Dependabot + CodeQL + `pnpm audit` to CI

**Files:** `.github/dependabot.yml` (new), `.github/workflows/codeql.yml` (new), `.github/workflows/ci.yml`

- [ ] **Step 1:** `.github/dependabot.yml` — `npm` ecosystem for `/`, `github-actions` ecosystem for `/`, schedule `weekly`, open `10` limit.
- [ ] **Step 2:** `.github/workflows/codeql.yml` — CodeQL workflow for `javascript-typescript` + `actions`, on `push`/`pull_request` to `main`, weekly cron.
- [ ] **Step 3:** In `ci.yml`, add a `security` job: `pnpm audit --prod --audit-level=high || true` (allow failures for now; flip to blocking in Phase 7).
- [ ] **Step 4: DOUBLE-CHECK.** Push a commit — Dependabot creates a PR within a day (verify in GitHub UI). CodeQL workflow appears in Actions tab.
- [ ] **Step 5:** Commit: `ci: add Dependabot, CodeQL, pnpm audit step`

### Task P1.14 — Add `.github/CODEOWNERS` + document required branch checks

**Files:** `.github/CODEOWNERS` (new), `docs/operations.md`

- [ ] **Step 1:** `.github/CODEOWNERS`:

```
* @mahmo
apps/web/ @mahmo
apps/mobile/ @mahmo
supabase/ @mahmo
packages/shared/ @mahmo
```

  (Replace with real team handles when known.)
- [ ] **Step 2:** Add a `docs/operations.md` section: "Branch Protection — `main` requires: (1) PR with 1 review, (2) status checks `typecheck`, `lint`, `test`, `build`, `codeql`, `supabase-check` pass, (3) conversation tasks resolved, (4) linear history. Configure in GitHub Settings → Branches."
- [ ] **Step 3: DOUBLE-CHECK.** `Get-Content .github/CODEOWNERS` — exists, non-empty. Apply the documented settings in GitHub UI.
- [ ] **Step 4:** Commit: `docs: add CODEOWNERS and branch-protection runbook`

### Task P1.15 — Add `.env.example` parity with `docs/env-reference.md`

**Files:** `.env.example` (root), `apps/web/.env.local.example`, `apps/mobile/.env.example`, `scripts/check-env.mjs` (new)

- [ ] **Step 1:** Read `docs/env-reference.md` — enumerate all 11+ vars.
- [ ] **Step 2:** Write each `.env.example` with placeholder values (`<set-me>`) and a one-line comment per var.
- [ ] **Step 3:** Create `scripts/check-env.mjs` that reads required vars from `process.env` and exits 1 with a clear message if any are missing. Call it at the top of `apps/web/next.config.js` and `supabase/functions/_shared/auth.ts`.
- [ ] **Step 4: DOUBLE-CHECK.** Delete one var from `.env.local`, run `pnpm --filter @elogbook/web build` — `check-env` fails with a clear message naming the missing var.
- [ ] **Step 5:** Commit: `chore: complete .env.example parity; add boot-time env check`

### Task P1.16 — Fix migration numbering collision (two `00046_` files)

**Files:** `git mv supabase/migrations/00046_add_payment_mode.sql supabase/migrations/00052_add_payment_mode.sql`

- [ ] **Step 1:** `git mv supabase/migrations/00046_add_payment_mode.sql supabase/migrations/00052_add_payment_mode.sql` (numbered to come after the P0 migrations 00048-00051).
- [ ] **Step 2:** Search for any reference to `00046` in comments or other migrations — update the comment to `00052`.
- [ ] **Step 3: DOUBLE-CHECK.** `Get-ChildItem supabase/migrations -Filter "0004*" | Select-Object Name` — exactly one file per number. `supabase db reset` — succeeds with the new ordering.
- [ ] **Step 4:** Commit: `chore(supabase): renumber 00046_add_payment_mode to 00052 to fix prefix collision`

### Task P1.17 — Fix `pnpm test` to actually use the workspace vitest config

**Files:** root `package.json` `test` script, root `vitest.config.ts`, root `vitest.workspace.ts`

- [ ] **Step 1:** Read both root vitest configs. Decide `vitest.workspace.ts` is canonical.
- [ ] **Step 2:** Delete or gut `vitest.config.ts` to avoid ambiguity.
- [ ] **Step 3:** Change root `test` script to `vitest run --workspace vitest.workspace.ts`.
- [ ] **Step 4: DOUBLE-CHECK.** `pnpm test` — runs tests across all three projects with correct environments (web tests get jsdom, mobile tests get node). A web component test that uses `document` passes.
- [ ] **Step 5:** Commit: `test: make pnpm test use vitest.workspace.ts (jsdom for web)`

### Task P1.18 — Phase 1 gate verification

- [ ] **Step 1:** `pnpm install --frozen-lockfile` — succeeds.
- [ ] **Step 2:** `pnpm -r typecheck` — exit 0 across all 3 packages.
- [ ] **Step 3:** `pnpm -r lint` — exit 0 across all 3 packages.
- [ ] **Step 4:** `pnpm test` — all pass, coverage ≥40% on `@elogbook/shared`.
- [ ] **Step 5:** `pnpm --filter @elogbook/web test:e2e` — both specs pass.
- [ ] **Step 6:** `supabase db reset && supabase test db` — all `ok` (Phase 0 RLS tests pass).
- [ ] **Step 7:** `docker compose up -d web` — healthy within 60s.
- [ ] **Step 8:** Verify in GitHub: Dependabot enabled, CodeQL workflow runs, branch protection documented.
- [ ] **Step 9: DOUBLE-CHECK.** `git log --oneline -30` — shows all Phase 0 + Phase 1 commits in order. `git status --porcelain` — empty.

---

## 5. PHASE 2 — BACKEND: RLS, TRIGGERS, EDGE FUNCTIONS, PHI

> **Sequential. Depends on Phase 1 (test scaffold, generated types).**

### Task P2.0 — Convention: all SECURITY DEFINER functions get `SET search_path = public`

**Files:** `supabase/migrations/00053_normalize_search_path.sql` (new)

> The `00020` migration set `search_path = ''` which likely breaks unqualified `public.table` references. Normalize to `public`.

- [ ] **Step 1:** Grep `supabase/migrations/*.sql` for `SECURITY DEFINER` — enumerate every function.
- [ ] **Step 2:** Write `00053` that for each SECURITY DEFINER function runs `ALTER FUNCTION public.<name>(<args>) SET search_path = public`. (Use a DO block with `format` to iterate over `pg_proc`.)
- [ ] **Step 3:** Also fix the regressions in `00044` (`update_updated_at`) and `00052` (renamed from 00046_add_payment_mode) (`block_lapsed_tenant_submit`) that re-declared without `search_path`.
- [ ] **Step 4: DOUBLE-CHECK.** `supabase db reset` — no errors. Manually call `approve_case`, `get_case_stats`, `enforce_data_retention`, `audit_case_entry` (via a case insert) — all succeed. If any errors with "relation does not exist", the search_path was the cause and is now fixed.
- [ ] **Step 5:** Commit: `fix(supabase): normalize search_path to public on all SECURITY DEFINER functions`

### Task P2.1 — Rewrite the encryption migration (S5)

**Files:** `supabase/migrations/00054_rewrite_secret_encryption.sql` (new), `packages/shared/src/types/database.server.ts`

> This is the fix for S5. Migration `00037` is broken in sequence (references `mode` added in 00046/00052; `SET NOT NULL` fails without `app.encryption_key`; `REVOKE/GRANT` commented out; `store_*` functions omit legacy NOT NULL plaintext columns). Write a new migration that completes the encryption rollout idempotently.

- [ ] **Step 1:** Read `00037` and `00052` fully. Understand the current state.
- [ ] **Step 2:** Write `00054` to:
  (a) Add `mode` to `payment_gateway_config` if missing (idempotent `DO $$ ... IF NOT EXISTS ... END $$;`).
  (b) Ensure `*_enc BYTEA` columns exist on both `ai_config` and `payment_gateway_config`.
  (c) Backfill `*_enc` from the plaintext columns using `pgp_sym_encrypt(plaintext, current_setting('app.encryption_key'))` if `app.encryption_key` is set; skip silently if not.
  (d) Drop the deprecated plaintext columns (`encrypted_api_key`, `encrypted_secret_key`, `encrypted_webhook_secret`) — they are no longer needed once `*_enc` is backfilled. (Also fixes the audit-leak at the source.)
  (e) Recreate `secret_ai_config` and `secret_payment_gateway_config` views over `*_enc` using `pgp_sym_decrypt`.
  (f) `REVOKE SELECT ON ai_config, payment_gateway_config FROM authenticated, anon;` — force access through the views.
  (g) `GRANT SELECT ON secret_ai_config, secret_payment_gateway_config TO authenticated;` with RLS policies scoped to `tenant_id = get_tenant_id()` AND role restrictions (only edge-function service role + institution_admin can read `payment_gateway_config`; only institution_admin can read `ai_config`). Apply FORCE RLS on the views via `ALTER VIEW ... SET (security_barrier = true)` and a policy.
  (h) Recreate `store_ai_config` and `store_payment_gateway_secret` to write only `*_enc` columns.
- [ ] **Step 3:** Update `packages/shared/src/types/database.server.ts`: `AIConfigServer.api_key_enc: string` (hex), `PaymentGatewayConfigServer.secret_key_enc: string`, `webhook_secret_enc: string`, `mode: 'test' | 'live'`.
- [ ] **Step 4: Write a test** `supabase/tests/secret_encryption.test.sql` that: sets `app.encryption_key`, stores an AI config, verifies the plaintext column is gone, verifies `secret_ai_config` decrypts correctly, verifies a resident user CANNOT select from `ai_config` directly, verifies an institution_admin CAN select from `secret_ai_config` for their tenant only.
- [ ] **Step 5:** Run `supabase db reset && supabase test db secret_encryption`. Expected: PASS.
- [ ] **Step 6: DOUBLE-CHECK.** `psql -c "\d ai_config"` — no `encrypted_api_key` column. `psql -c "SELECT * FROM ai_config"` as `authenticated` — permission denied. `psql -c "SELECT * FROM secret_ai_config"` as `authenticated` with tenant-scoped JWT — returns only own tenant row.
- [ ] **Step 7:** Commit: `security(supabase): complete secret-column encryption rollout; drop plaintext columns; restrict views`

### Task P2.2 — Fix `ai-insights` resident_id verification + quota increment (S9)

**Files:** `supabase/functions/ai-insights/index.ts:214,245-250`, `supabase/migrations/00055_ai_quota_atomic_increment.sql` (new), `supabase/functions/ai-insights/index.test.ts` (new)

> This is S9.

- [ ] **Step 1:** In `ai-insights/index.ts`, after extracting `resident_id` from the body, verify it belongs to the caller: `const { data: profile } = await supabaseClient.from('profiles').select('id, role').eq('user_id', userId).eq('id', bodyResidentId).maybeSingle();` — if not found AND the caller is not `supervisor+`, return 403.
- [ ] **Step 2:** Create `00055` with a `consume_ai_quota(p_resident_id uuid, p_count int default 1)` SECURITY DEFINER function that does `UPDATE resident_ai_toggle SET quota_used = quota_used + p_count WHERE resident_id = p_resident_id AND enabled = true AND (quota_limit = 0 OR quota_used + p_count <= quota_limit) RETURNING quota_used;` — atomic, returns the new total or NULL if over quota. REVOKE EXECUTE from public; GRANT to `authenticated`.
- [ ] **Step 3:** In `ai-insights/index.ts`, replace the non-functional quota check with `const { data: newQuota } = await supabaseClient.rpc('consume_ai_quota', { p_resident_id: residentId, p_count: 1 }); if (!newQuota) return quotaExceededResponse();`.
- [ ] **Step 4:** Test: `ai-insights/index.test.ts` — assert (a) caller passing another resident's id → 403; (b) quota exceeded → 429; (c) quota consumed → response succeeds and `quota_used` incremented in DB.
- [ ] **Step 5: DOUBLE-CHECK.** Manually invoke the edge function with two different `resident_id` values from one account — confirm only the caller's own `resident_id` succeeds. `supabase test db` passes.
- [ ] **Step 6:** Commit: `security(supabase): verify resident_id ownership and atomically consume AI quota in ai-insights`

### Task P2.3 — Fix streaming-mode disclaimer + safety order in `ai-insights` (S9)

**Files:** `supabase/functions/ai-insights/index.ts:563-630`, `apps/mobile/app/(tabs)/ai-insights.tsx`

> Part of S9. Currently the disclaimer is computed but never enqueued to the SSE stream, and unsafe content is streamed before `checkSafety` runs.

- [ ] **Step 1:** Read the streaming branch fully.
- [ ] **Step 2:** Restructure: buffer the AI provider's streaming chunks server-side; run `checkSafety` on the accumulated text BEFORE enqueueing each chunk (or enqueue chunks as they arrive but enqueue the disclaimer FIRST, before any content, and run a final safety pass on the full text — if safety flags, abort the stream with a final `event: safety` message).
- [ ] **Step 3:** Always enqueue the disclaimer as the first `event: disclaimer` message in the stream.
- [ ] **Step 4:** Update the mobile `ai-insights.tsx` screen to render the disclaimer from the SSE `disclaimer` event before showing any AI content.
- [ ] **Step 5: Write a test** that streams a response containing a blocked phrase ("diagnosis is...") and asserts the stream aborts with a safety event and no diagnosis content reaches the client.
- [ ] **Step 6: DOUBLE-CHECK.** Manual: call the edge function with `stream: true` and a query — confirm the first SSE event is `disclaimer`, and that a query containing "diagnosis" aborts with `event: safety`.
- [ ] **Step 7:** Commit: `security(supabase): stream disclaimer first, run safety check before enqueuing AI chunks`

### Task P2.4 — Add RLS tests for every policy (replace the comment-only stub)

**Files:** `supabase/tests/rls-policies.sql` (rewrite), `supabase/tests/rls/` (new directory, per-table files)

- [ ] **Step 1:** Read the current `supabase/tests/rls-policies.sql` — confirm every block is `BEGIN … ROLLBACK;` with no assertions.
- [ ] **Step 2:** For each tenant-scoped table, write at minimum:
  - Resident can SELECT own row, cannot SELECT other resident's row.
  - Supervisor can SELECT all tenant rows, cannot SELECT other tenant's rows.
  - Director can INSERT/UPDATE/DELETE per policy, cannot touch other tenants.
  - Anonymous (no JWT) — SELECT returns zero rows.
  - FORCE RLS — owner-bypass test: `SET ROLE postgres; SELECT ...` — should still be restricted (or return only what policy allows).
- [ ] **Step 3:** Run `supabase test db` — all pass.
- [ ] **Step 4: DOUBLE-CHECK.** `grep -c "SELECT is_" supabase/tests/rls/*.sql` — at least 80 assertions (one per policy). `supabase test db` — `ok` for all.
- [ ] **Step 5:** Commit: `test(supabase): replace comment-only RLS stub with 80+ real policy assertions`

### Task P2.5 — Add RLS to `rate_limits` + scope `check_rate_limit` keys; move web rate-limit to DB RPC

**Files:** `supabase/migrations/00056_rate_limits_rls_and_scope.sql` (new), `supabase/functions/_shared/auth.ts`, `apps/web/lib/rate-limit.ts`, `apps/web/lib/api-middleware.ts:23`

- [ ] **Step 1:** `00056` — `ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY; ALTER TABLE rate_limits FORCE ROW LEVEL SECURITY; REVOKE ALL ON rate_limits FROM authenticated, anon; GRANT SELECT, INSERT, UPDATE ON rate_limits TO authenticated;` — access only through `check_rate_limit` SECURITY DEFINER. Add a policy `FOR SELECT TO authenticated USING (false)` (deny direct SELECT).
- [ ] **Step 2:** Replace the in-memory `Map` in `apps/web/lib/rate-limit.ts` with a call to `supabase.rpc('check_rate_limit', { p_key: ... })`. Make it async; update `withTenantAuth` to await.
- [ ] **Step 3:** In `apps/web/lib/api-middleware.ts:23`, change the key from `api:${tenantSlug}:${method}` to `api:${userId}:${method}:${route}` — per-user, per-route.
- [ ] **Step 4:** In `ai-insights/index.ts:32-51`, change `checkRateLimitDb` to fail-CLOSED on DB error (return `false` instead of `true`). Document the rationale: for a PHI AI feature, fail-closed > fail-open.
- [ ] **Step 5: Write a test** that hammers an endpoint 31 times as the same user — the 31st returns 429. Reset and hammer as a different user — succeeds (proves per-user scoping).
- [ ] **Step 6: DOUBLE-CHECK.** Read `apps/web/lib/rate-limit.ts` — no `Map` left. `grep -n "Map<\|new Map" apps/web/lib` — zero in rate-limit. `pnpm --filter @elogbook/web typecheck` exit 0.
- [ ] **Step 7:** Commit: `security(supabase+web): move rate-limit to DB RPC with per-user keys and fail-closed errors`

### Task P2.6 — Fix `profiles` INSERT policy (no tenant_id check)

**Files:** `supabase/migrations/00057_fix_profile_insert_tenant.sql` (new)

- [ ] **Step 1:** Read `00012:24-30` — current policy allows inserting a profile into any tenant.
- [ ] **Step 2:** `00057` — drop and recreate the policy with `WITH CHECK (user_id = auth.uid() AND tenant_id = get_tenant_id() AND role IN ('resident','supervisor'))`.
- [ ] **Step 3:** Add an RLS test asserting a user cannot insert a profile into a tenant they don't belong to.
- [ ] **Step 4: DOUBLE-CHECK.** `supabase test db` — new test passes. Manual: sign up as a new user, try to insert a profile with a different `tenant_id` — denied.
- [ ] **Step 5:** Commit: `security(supabase): require tenant_id match on profiles INSERT policy`

### Task P2.7 — Add `resident_id` ownership to `ai_query_logs` INSERT policy

**Files:** `supabase/migrations/00058_fix_ai_query_logs_insert.sql` (new)

- [ ] **Step 1:** Read `00002:568-571` — current policy allows inserting logs for any resident in the tenant.
- [ ] **Step 2:** `00058` — drop and recreate the INSERT policy: `WITH CHECK (tenant_id = get_tenant_id() AND resident_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())) OR get_user_role() IN ('supervisor','director','institution_admin','admin')`. (Supervisors+ can write logs on behalf, but only for their tenant.)
- [ ] **Step 3:** Add an RLS test: resident A cannot insert a log row with `resident_id = B`.
- [ ] **Step 4: DOUBLE-CHECK.** `supabase test db` — passes.
- [ ] **Step 5:** Commit: `security(supabase): require resident_id ownership on ai_query_logs INSERT`

### Task P2.8 — Restrict `institutions` SELECT (was `USING (true)`)

**Files:** `supabase/migrations/00059_restrict_institutions_select.sql` (new)

- [ ] **Step 1:** `00059` — drop the `USING (true)` policy. Recreate: `USING (id IN (SELECT institution_id FROM public.tenants WHERE id = get_tenant_id()) OR get_user_role() = 'admin')`.
- [ ] **Step 2:** Test: resident of tenant A cannot select institution B's row; admin can.
- [ ] **Step 3: DOUBLE-CHECK.** `supabase test db` passes. Manual: `select * from institutions` as a resident — returns only their institution.
- [ ] **Step 4:** Commit: `security(supabase): restrict institutions SELECT to own institution or admin`

### Task P2.9 — Add audit triggers for `profiles`, `tenants`, `subscriptions`, `payments`, `consent_records`, `approval_requests`, `case_attachments`, `stripe_events`, `resident_ai_toggle`

**Files:** `supabase/migrations/00060_audit_missing_tables.sql` (new), `supabase/tests/audit_triggers.test.sql` (new)

- [ ] **Step 1:** Generalize `audit_case_entry` into a generic `audit_table_change()` that takes the table name from `TG_TABLE_NAME` and writes to `audit_logs` with PHI-redacted `changes` JSON. Or create per-table trigger functions. Prefer generic for maintainability.
- [ ] **Step 2:** Attach triggers to every auditable table not yet covered. For `profiles`, log role changes specifically (capture `OLD.role` vs `NEW.role`).
- [ ] **Step 3:** Test: insert/update/delete on each table, assert an `audit_logs` row exists with the correct `action` and `table_name`.
- [ ] **Step 4: DOUBLE-CHECK.** `supabase test db audit_triggers` — all pass.
- [ ] **Step 5:** Commit: `security(supabase): add audit triggers for profiles, tenants, subscriptions, payments, consent, approvals, attachments, stripe_events, resident_ai_toggle`

### Task P2.10 — Audit PDF export + rate-limit + scope supervisors by resident

**Files:** `supabase/functions/generate-pdf/index.ts`, `supabase/migrations/00061_audit_pdf_export.sql` (new)

- [ ] **Step 1:** In `generate-pdf/index.ts`, after generating the PDF, call `supabaseClient.rpc('log_pdf_export', { p_case_ids: [...], p_resident_filter: ... })` to write an `audit_logs` entry.
- [ ] **Step 2:** Add per-user rate limiting (use `check_rate_limit` RPC from P2.5) with key `pdf:${userId}` and a limit of 10/minute.
- [ ] **Step 3:** For supervisors requesting bulk export, restrict to a single `resident_id` filter (no "all residents" bulk export without director+ role).
- [ ] **Step 4: DOUBLE-CHECK.** Trigger a PDF export, then `SELECT * FROM audit_logs WHERE action = 'pdf_export' ORDER BY created_at DESC LIMIT 1;` — row exists. Hammer the endpoint 11 times — 11th returns 429.
- [ ] **Step 5:** Commit: `security(supabase): audit PDF export, rate-limit per user, restrict supervisor bulk export`

### Task P2.11 — Fix `payment-webhook`: record failures in `stripe_events` instead of non-existent `webhook_failures`

**Files:** `supabase/migrations/00062_webhook_failures_table.sql` (new), `supabase/functions/payment-webhook/index.ts:345-355`

- [ ] **Step 1:** Prefer adding a `status` and `failure_reason` column to `stripe_events` (already exists). Create `00062` to add those columns + an index on `status='failed'`.
- [ ] **Step 2:** Update `payment-webhook/index.ts:345-355` to INSERT into `stripe_events` with `status='failed'` and `failure_reason` instead of the non-existent `webhook_failures`.
- [ ] **Step 3: DOUBLE-CHECK.** Send a forged webhook (wrong signature) to the function — `SELECT * FROM stripe_events WHERE status='failed' ORDER BY created_at DESC LIMIT 1;` — row exists.
- [ ] **Step 4:** Commit: `fix(supabase): record webhook failures in stripe_events instead of non-existent webhook_failures table`

### Task P2.12 — Stop caching all tenants' decrypted Stripe secrets in `payment-webhook`

**Files:** `supabase/functions/payment-webhook/index.ts:8-30`

- [ ] **Step 1:** Read `getGatewayConfigs` — confirm it caches ALL tenants' secrets for 5 min.
- [ ] **Step 2:** Refactor: extract the Stripe account ID from the webhook's `account` field (Stripe Connect) or from the `Stripe-Account` header; fetch only that tenant's `secret_payment_gateway_config` row.
- [ ] **Step 3:** If the account can't be mapped to a tenant, reject with 401. Don't iterate all tenants.
- [ ] **Step 4: DOUBLE-CHECK.** Send a webhook with a valid signature for tenant A — only tenant A's secret is fetched (verify via function logs). Send a webhook with no recognizable account — 401.
- [ ] **Step 5:** Commit: `security(supabase): scope payment-webhook secret lookup to the webhook's tenant, not all tenants`

### Task P2.13 — Drop `subscriptions UNIQUE(tenant_id)`; preserve subscription history

**Files:** `supabase/migrations/00063_subscription_history.sql` (new), `supabase/functions/payment-webhook/index.ts:173-181`

- [ ] **Step 1:** `00063` — `ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_tenant_id_key;`. Add a partial unique index: `CREATE UNIQUE INDEX subscriptions_tenant_active_unique ON subscriptions(tenant_id) WHERE status IN ('active','trialing','past_due');`.
- [ ] **Step 2:** Update `payment-webhook/index.ts:173-181` to INSERT a new subscription row on `checkout.session.completed` (not upsert) and UPDATE the active row on subsequent events. Or upsert with `onConflict: 'tenant_id, status'` filtered to active.
- [ ] **Step 3:** Test: create subscription A (active), then a new checkout completes — subscription B is created (active), A is set to `canceled`. Both rows exist (history preserved).
- [ ] **Step 4: DOUBLE-CHECK.** `psql -c "\d subscriptions"` — no `subscriptions_tenant_id_key` constraint; partial unique index exists.
- [ ] **Step 5:** Commit: `fix(supabase): preserve subscription history; replace UNIQUE(tenant_id) with partial unique on active`

### Task P2.14 — Provision `pg_cron`; make cron schedules idempotent; remove stale MV refresh

**Files:** `supabase/migrations/00064_pg_cron_and_schedules.sql` (new)

- [ ] **Step 1:** `00064` — `CREATE EXTENSION IF NOT EXISTS pg_cron WITH schema public;` then `SELECT cron.unschedule('refresh-case-stats-mv')` (the stale job from `00039:3`). Schedule `enforce-data-retention` and `cleanup-ai-response-cache` idempotently: `SELECT cron.schedule(...)` guarded by `WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ...)`.
- [ ] **Step 2: DOUBLE-CHECK.** `SELECT * FROM cron.job;` — `enforce-data-retention` and `cleanup-ai-response-cache` exist; `refresh-case-stats-mv` does NOT.
- [ ] **Step 3:** Commit: `fix(supabase): provision pg_cron, unschedule stale MV refresh, make schedules idempotent`

### Task P2.15 — Gate demo accounts behind `app.enable_demo_migrations` GUC

**Files:** `supabase/migrations/00065_gate_demo_migrations.sql` (new), `supabase/seed.sql`

- [ ] **Step 1:** `00065` — wrap the demo-account creation in `DO $$ BEGIN IF current_setting('app.enable_demo_migrations', true) = 'true' THEN ... END IF; END $$;`. (If `00006` already ran, this migration DELETEs the demo accounts when the GUC is `false`.)
- [ ] **Step 2:** In `supabase/seed.sql`, set `set_config('app.enable_demo_migrations', 'true', false);` at the top so local dev still gets demo data.
- [ ] **Step 3: DOUBLE-CHECK.** `supabase db reset` (local, GUC true) — demo accounts exist. In a production-sim reset with GUC false — demo accounts absent.
- [ ] **Step 4:** Commit: `security(supabase): gate demo accounts behind app.enable_demo_migrations GUC`

### Task P2.16 — Enable email confirmation; restrict signup; cap sessions

**Files:** `supabase/config.toml:11,14-15,18`

- [ ] **Step 1:** `enable_confirmations = true`, `enable_autoconfirm = false`. Configure SMTP via `config.toml` `[auth.email]` section (placeholder `<SMTP_HOST>` env).
- [ ] **Step 2:** Either `enable_signup = false` (admin-invite-only) or add an allow-list `[auth.email.allowlist]`. Prefer admin-invite-only for an enterprise PHI SaaS: `enable_signup = false`.
- [ ] **Step 3:** `timebox = true` with `timebox_duration = 28800` (8h absolute session cap for PHI access). `inactivity_timeout = 1800` (30 min idle).
- [ ] **Step 4: DOUBLE-CHECK.** `supabase db reset` — try to sign up a new user via the API — should require email confirmation. After 8h (simulated), session expires.
- [ ] **Step 5:** Commit: `security(supabase): enable email confirmation, restrict signup, timebox sessions for PHI`

### Task P2.17 — Add `get_case_stats` resident_id role check

**Files:** `supabase/migrations/00066_case_stats_role_check.sql` (new)

- [ ] **Step 1:** `00066` — drop and recreate `get_case_stats` with a role check: if `p_resident_id` is provided AND `get_user_role() = 'resident'`, assert `p_resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())`; raise `insufficient_privilege` otherwise.
- [ ] **Step 2:** Test: resident A calls `get_case_stats(p_resident_id := B)` — raises. Resident A calls with own id — succeeds. Supervisor calls with any resident — succeeds.
- [ ] **Step 3: DOUBLE-CHECK.** `supabase test db` — passes.
- [ ] **Step 4:** Commit: `security(supabase): prevent cross-resident get_case_stats access`

### Task P2.18 — Fix `case_entries` UPDATE policy: allow `rejected → draft` for residents; add `deleted_at IS NULL`

**Files:** `supabase/migrations/00067_resubmit_policy_fix.sql` (new)

- [ ] **Step 1:** `00067` — drop the resident UPDATE policy (`00002:193-205`) and recreate with `USING (resident_id = auth.uid() AND tenant_id = get_tenant_id() AND status IN ('draft','rejected') AND deleted_at IS NULL) WITH CHECK (resident_id = auth.uid() AND tenant_id = get_tenant_id() AND status = 'draft')`.
- [ ] **Step 2:** Also add `deleted_at IS NULL` to all UPDATE policies that lack it (per supabase audit M11).
- [ ] **Step 3:** Test: resident with a rejected case can UPDATE it (transitioning to draft). Resident cannot UPDATE a soft-deleted draft.
- [ ] **Step 4: DOUBLE-CHECK.** `supabase test db` passes.
- [ ] **Step 5:** Commit: `fix(supabase): allow residents to resubmit rejected cases; add deleted_at IS NULL to UPDATE policies`

### Task P2.19 — Fix lapsed-tenant INSERT guard (dead code due to invalid enum values)

**Files:** `supabase/migrations/00068_fix_lapsed_tenant_guard.sql` (new)

- [ ] **Step 1:** `00068` — drop and recreate `block_lapsed_tenant_submit` and the INSERT policy to filter on `tenants.tenant_type` (valid enum `individual`/`institution`) joined with `subscription_plans.tenant_type`, OR drop the `subscription_plans.tenant_type` filter entirely and gate on `tenants.tenant_type IN ('institution')` (lapsed individual tenants auto-approve anyway, so the guard only matters for institutions). Read `00032:38` and the CHECK constraint on `subscription_plans.tenant_type` (`00001:138`) — they disagree.
- [ ] **Step 2:** Test: an institutional tenant with a lapsed subscription cannot INSERT a case; an individual tenant with a lapsed subscription can (auto-approve path). An institutional tenant with an active subscription can.
- [ ] **Step 3: DOUBLE-CHECK.** `supabase test db` passes.
- [ ] **Step 4:** Commit: `fix(supabase): lapsed-tenant INSERT guard uses valid tenant_type enum values`

### Task P2.20 — Make `hash_patient_mrn` non-public; add per-tenant salt

**Files:** `supabase/migrations/00069_hash_patient_mrn_private.sql` (new)

- [ ] **Step 1:** `00069` — `REVOKE EXECUTE ON FUNCTION hash_patient_mrn(text, uuid) FROM PUBLIC, authenticated, anon; GRANT EXECUTE ... TO authenticated;` (only authenticated). Better: rename the public function to `hash_patient_mrn_internal` (private) and expose a `hash_patient_mrn_for_tenant` that requires the caller's `tenant_id` to match the argument.
- [ ] **Step 2:** Add per-tenant salt: a `mrn_hash_salt` column on `tenants` (per-tenant random 32-byte hex). `hash_patient_mrn` reads `tenants.mrn_hash_salt` instead of the global GUC. Drop the global GUC.
- [ ] **Step 3:** Test: a resident can compute their own tenant's hash but not another tenant's. Same MRN+DOB hashes differently across tenants.
- [ ] **Step 4: DOUBLE-CHECK.** `psql -c "\df+ hash_patient_mrn"` — access is `authenticated` only, not `public`.
- [ ] **Step 5:** Commit: `security(supabase): make hash_patient_mrn tenant-scoped and non-public; per-tenant salt`

### Task P2.21 — Restrict `enforce_data_retention` EXECUTE; expand purge scope

**Files:** `supabase/migrations/00070_retention_hardening.sql` (new)

- [ ] **Step 1:** `00070` — `REVOKE EXECUTE ON enforce_data_retention() FROM PUBLIC, authenticated, anon;` — only `postgres`/cron can call it.
- [ ] **Step 2:** Extend the function to also purge `ai_query_logs` older than retention, `ai_response_cache` past `expires_at`, `consent_records` past their retention, and hard-delete `case_attachments` whose parent case is past retention (after soft-delete window).
- [ ] **Step 3:** Test: insert old rows, call `enforce_data_retention()`, assert they're gone.
- [ ] **Step 4: DOUBLE-CHECK.** `psql -c "SELECT has_function_privilege('authenticated','enforce_data_retention()','EXECUTE')"` — `false`.
- [ ] **Step 5:** Commit: `security(supabase): restrict enforce_data_retention to cron; expand purge to ai_query_logs, cache, consent`

### Task P2.22 — Phase 2 gate verification

- [ ] **Step 1:** `supabase db reset` — succeeds with all migrations 00001-00070 applied.
- [ ] **Step 2:** `supabase test db` — all RLS, RPC, trigger, retention tests pass.
- [ ] **Step 3:** `supabase functions test ai-insights` — passes (resident_id verification, quota, streaming safety).
- [ ] **Step 4:** Manual end-to-end: sign in as supervisor, approve a pending case — succeeds (no tenant_id error). Sign in as resident, submit a case — succeeds. Sign in as resident A, call AI insights with resident B's id — 403.
- [ ] **Step 5:** `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — exit 0 (generated types reflect new schema).
- [ ] **Step 6: DOUBLE-CHECK.** `git log --oneline supabase/ | head -30` — all Phase 2 commits present.

---

## 6. PHASE 3 — SHARED PACKAGE: TYPES, SCHEMAS, COMPONENTS, TOKENS

> **Sequential. Depends on Phase 1 (test scaffold) and Phase 2 (DB schema final).**

### Task P3.0 — Make `database.ts` types match the generated Supabase types

**Files:** `packages/shared/src/types/database.ts`, `packages/shared/src/types/__tests__/type-parity.test.ts` (new)

- [ ] **Step 1:** Read both `packages/shared/src/types/database.ts` and `apps/web/lib/supabase/database.types.ts` (from P1.12). Diff them. The generated file is the source of truth.
- [ ] **Step 2:** Replace the hand-written interfaces with re-exports of the generated types: `export type CaseEntry = Database['public']['Tables']['case_entries']['Row'];` etc.
- [ ] **Step 3:** Add a `type-parity.test.ts` using `expectTypeOf` (from `vitest`) asserting key fields exist with the right types.
- [ ] **Step 4: DOUBLE-CHECK.** `pnpm --filter @elogbook/shared typecheck` exit 0. `pnpm --filter @elogbook/shared test` passes.
- [ ] **Step 5:** Commit: `types: derive shared DB types from generated Supabase types (single source of truth)`

### Task P3.1 — Add branded types: `UUID`, `IsoDateString`, `DateOnlyString`, `PHIString`, `TenantId`

**Files:** `packages/shared/src/types/branded.ts` (new), `packages/shared/src/types/database.ts`, `packages/shared/src/schemas/*.ts`

- [ ] **Step 1:** Create `branded.ts`:

```typescript
export type UUID = string & { readonly __brand: 'UUID' };
export type IsoDateString = string & { readonly __brand: 'IsoDateString' };
export type DateOnlyString = string & { readonly __brand: 'DateOnlyString' };
export type PHIString = string & { readonly __brand: 'PHIString' };
export type TenantId = UUID & { readonly __tenant: true };
```

- [ ] **Step 2:** Apply: `CaseEntry.id: UUID`, `CaseEntry.tenant_id: TenantId`, `CaseEntry.patient_mrn: PHIString | null`, `CaseEntry.patient_dob: PHIString | null` (DateOnly), `CaseEntry.case_date: DateOnlyString`, `CaseEntry.created_at: IsoDateString`, etc.
- [ ] **Step 3:** Update Zod schemas to `.transform()` raw strings into branded types.
- [ ] **Step 4:** Add JSDoc `@PHI` tags to PHI fields (the lint rule comes in P3.12).
- [ ] **Step 5: DOUBLE-CHECK.** `pnpm --filter @elogbook/shared typecheck` exit 0. Web/mobile typecheck still pass (the brands are structurally strings, so assignment from raw strings works).
- [ ] **Step 6:** Commit: `types: add branded UUID/IsoDate/DateOnly/PHI/TenantId types and apply to database.ts`

### Task P3.2 — Fix server types to reference encrypted bytea columns

**Files:** `packages/shared/src/types/database.server.ts`

- [ ] **Step 1:** Per P2.1, the active columns are `api_key_enc`, `secret_key_enc`, `webhook_secret_enc` (bytea, hex-encoded after decrypt in the view). Update `AIConfigServer` and `PaymentGatewayConfigServer` to match. Add `mode: 'test' | 'live'` and `created_at`/`updated_at`.
- [ ] **Step 2: DOUBLE-CHECK.** Read the file — no `encrypted_api_key` / `encrypted_secret_key` / `encrypted_webhook_secret` references (the dropped plaintext columns).
- [ ] **Step 3:** Commit: `types: align server types with encrypted bytea columns + mode + timestamps`

### Task P3.3 — Add Zod schemas for every missing DB-backed payload

**Files:** `packages/shared/src/schemas/payments.ts`, `subscriptions-record.ts`, `consent.ts`, `audit.ts`, `ai.ts`, `attachments.ts`, `stripe-events.ts`, `rate-limits.ts` (all new)

- [ ] **Step 1:** For each, write a Zod schema mirroring the DB row + a "create" input variant + a "read" row variant. Use branded types from P3.1.
- [ ] **Step 2:** Add `field_values` sanitization to `caseEntrySchema`: a `z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))` — no nested objects, no script-tag content (refine: `!/<script/i.test(String(value))`).
- [ ] **Step 3:** Add `patient_mrn` regex `^[A-Za-z0-9-]{1,50}$`; `patient_hash` regex `^[a-f0-9]{64}$`.
- [ ] **Step 4:** Validate `case_date` and `deadline` as real calendar dates (refine `!isNaN(Date.parse(val))`).
- [ ] **Step 5:** Write tests for each new schema (valid + invalid cases). Fix the contradictory `cases.test.ts` assertions from shared audit C7 (arrays → records, add `case_date`, remove `status` assertion).
- [ ] **Step 6: DOUBLE-CHECK.** `pnpm --filter @elogbook/shared test` — all pass. `grep -c "z\.\|zod" packages/shared/src/schemas/*.ts` — at least 20 schemas.
- [ ] **Step 7:** Commit: `feat(shared): add Zod schemas for payments, subscriptions, consent, audit, ai, attachments, stripe_events, rate_limits; fix caseEntry tests`

### Task P3.4 — Add i18n-ready Zod error messages

**Files:** `packages/shared/src/schemas/error-map.ts` (new), all schemas, `packages/shared/src/index.ts`

- [ ] **Step 1:** Create `error-map.ts` exporting a `makeErrorMap(locale: 'en' | 'ar' | ...) => ZodErrorMap` with per-code messages: `invalid_type`, `too_small`, `too_big`, `invalid_string` (regex), `custom`. English + Arabic (SCFHS) initial.
- [ ] **Step 2:** Add `setSchemaLocale(locale)` that swaps the active error map.
- [ ] **Step 3:** Wire all schemas to use the active error map.
- [ ] **Step 4:** Test: parse an invalid case with `locale='ar'` — assert the error message is Arabic.
- [ ] **Step 5: DOUBLE-CHECK.** `pnpm --filter @elogbook/shared test` passes with new i18n tests.
- [ ] **Step 6:** Commit: `feat(shared): i18n-ready Zod error map (en + ar)`

### Task P3.5 — Fix light theme: add light variants for every color; verify contrast ≥4.5:1

**Files:** `packages/shared/src/constants/design-tokens.ts:3-15`, `apps/web/tailwind.config.ts:10`, `apps/web/app/layout.tsx:29`, `packages/shared/src/constants/__tests__/contrast.test.ts` (new)

> This is shared priority #1. Light theme is unusable (contrast 1.05:1 on text).

- [ ] **Step 1:** For every color in `design-tokens.ts`, add a `light` variant that meets WCAG AA (4.5:1 for text, 3:1 for large text/UI) on the light backdrop `#F8FAFC`. Example: `text.primary.light: '#0F172A'` (15:1 on light), `primary.light: '#0D9488'` (4.6:1 on white — verify), `pending.light: '#B45309'` (4.6:1), `approved.light: '#15803D'`, `rejected.light: '#B91C1C'`.
- [ ] **Step 2:** Write a contrast test that computes the ratio for each status color on its backdrop and asserts ≥4.5:1 for text colors and ≥3:1 for status indicators.
- [ ] **Step 3:** Restructure the web Tailwind config to support both themes via the `dark:` variant (Tailwind v4 standard) — remove the `@media (prefers-color-scheme: light)` block in `globals.css` and use explicit `.dark` / `.light` classes on `<html>`.
- [ ] **Step 4:** Update `app/layout.tsx` to default to `dark` but respect a `theme` cookie / `localStorage` toggle. Add a theme toggle in the Sidebar.
- [ ] **Step 5: DOUBLE-CHECK.** Open the web app in light mode — every status badge, text color, and KPI ring meets contrast. Run axe DevTools — zero color-contrast violations.
- [ ] **Step 6:** Commit: `feat(shared): add light theme variants meeting WCAG AA; wire theme switching on web`

### Task P3.6 — Add reduced-motion support to animations and ProgressRing

**Files:** `packages/shared/src/constants/animations.ts`, `packages/shared/src/components/ProgressRing.web.tsx:34-50`, `packages/shared/src/components/ProgressRing.native.tsx`

- [ ] **Step 1:** Add `REDUCED_DEFAULT_TRANSITION = { duration: 0 }`, `REDUCED_SPRING_SLIDE_UP = { duration: 0 }`, etc.
- [ ] **Step 2:** Web: `const reduce = useReducedMotion(); ... animate(..., reduce ? REDUCED_DEFAULT_TRANSITION : DEFAULT_TRANSITION)`.
- [ ] **Step 3:** Native: `AccessibilityInfo.isReduceMotionEnabled().then(setReduce)`.
- [ ] **Step 4: DOUBLE-CHECK.** Enable OS "Reduce Motion"; open the dashboard — KPI rings render at final value with no animation.
- [ ] **Step 5:** Commit: `a11y(shared): honor prefers-reduced-motion in animations and ProgressRing`

### Task P3.7 — Make shared components actually consumed by both apps (kill the duplication)

**Files:** Delete `apps/mobile/components/GlassPanel.tsx`, `StatusBadge.tsx`, `ProgressRing.tsx`. Delete `apps/web/components/ProgressRing.tsx` (dead per web audit D5). Modify every mobile screen that imports the local versions.

- [ ] **Step 1:** Grep `apps/mobile` for `from '../components/GlassPanel'`, `from '../components/StatusBadge'`, `from '../components/ProgressRing'` — enumerate every import site.
- [ ] **Step 2:** Change each to `from '@elogbook/shared'` and use the named export (`GlassPanel`, `StatusBadge`, `ProgressRing`).
- [ ] **Step 3:** Delete the three local mobile component files.
- [ ] **Step 4:** Update the mobile screens' props to match the shared API (`ProgressRing` uses `value/max/label` not `percentage/specialty` — adapt call sites).
- [ ] **Step 5: DOUBLE-CHECK.** `grep -r "from '../components/\(GlassPanel\|StatusBadge\|ProgressRing\)'" apps/mobile` — zero matches. `pnpm --filter @elogbook/mobile typecheck` exit 0. Visually verify the dashboard still renders the rings correctly.
- [ ] **Step 6:** Commit: `refactor(mobile): adopt shared GlassPanel/StatusBadge/ProgressRing; delete local duplicates`

### Task P3.8 — Verify `deidentified` StatusBadge variant renders on mobile

**Files:** Verification only — handled by P3.7.

- [ ] **Step 1:** After P3.7, Grep `apps/mobile` for `deidentified` — confirm at least one usage renders the deidentified badge (e.g. on the my-cases list when `is_deidentified === true`).
- [ ] **Step 2: DOUBLE-CHECK.** Open a deidentified case on mobile — the badge shows the deidentified variant (grey-ish, distinct from `draft`).
- [ ] **Step 3:** Commit: `fix(mobile): render deidentified status badge variant via shared StatusBadge`

### Task P3.9 — Resolve `as any` in shared native components (React 19 / RN type conflict)

**Files:** `packages/shared/src/components/GlassPanel.native.tsx:8`, `packages/shared/src/components/ProgressRing.native.tsx:7-12`, `packages/shared/src/types/react-native.d.ts` (new)

- [ ] **Step 1:** After P1.1 (real dep versions), the React 19 / RN 0.85 type alignment may be cleaner. Verify by reading the type errors.
- [ ] **Step 2:** Write proper module declarations in `react-native.d.ts` instead of `as any`.
- [ ] **Step 3:** Remove the `as any` casts.
- [ ] **Step 4: DOUBLE-CHECK.** `grep -n "as any" packages/shared/src/components/*.native.tsx` — zero. `pnpm --filter @elogbook/shared typecheck` exit 0.
- [ ] **Step 5:** Commit: `refactor(shared): replace as-any casts with proper module declarations for native deps`

### Task P3.10 — Add `Panel` keyboard handler + `ProgressRing` a11y attributes

**Files:** `packages/shared/src/components/Panel.web.tsx:12-32`, `packages/shared/src/components/ProgressRing.web.tsx:59-95`, `packages/shared/src/components/ProgressRing.native.tsx`, `packages/shared/src/components/StatusBadge.web.tsx:75-84`

- [ ] **Step 1:** `Panel.web.tsx` — when `onClick` is supplied, add `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space triggers click).
- [ ] **Step 2:** `ProgressRing.web.tsx` — add `role="img"`, `aria-label`, `<title>` to the SVG.
- [ ] **Step 3:** `ProgressRing.native.tsx` — add `accessibilityRole="image"`, `accessibilityLabel`.
- [ ] **Step 4:** `StatusBadge.web.tsx` — add `aria-hidden` on the decorative dot.
- [ ] **Step 5:** Write a test for `Panel` keyboard activation and `ProgressRing` a11y attributes.
- [ ] **Step 6: DOUBLE-CHECK.** Run axe on a web page using `Panel` and `ProgressRing` — zero violations on these elements. On mobile, VoiceOver announces the ProgressRing value via `accessibilityLabel`.
- [ ] **Step 7:** Commit: `a11y(shared): keyboard handler on Panel, role/label on ProgressRing, aria-hidden on StatusBadge dot`

### Task P3.11 — Add platform conditional exports to `packages/shared/package.json`

**Files:** `packages/shared/package.json:7-14`

- [ ] **Step 1:**

```json
"exports": {
  ".": {
    "react-native": "./src/index.ts",
    "browser": "./src/index.ts",
    "import": "./src/index.ts",
    "default": "./src/index.ts"
  },
  "./components": {
    "react-native": "./src/components/index.ts",
    "browser": "./src/components/index.ts",
    "import": "./src/components/index.ts"
  }
}
```

  Keep the per-file exports too if needed.
- [ ] **Step 2: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` succeeds. `pnpm --filter @elogbook/mobile build` (or `expo export`) succeeds.
- [ ] **Step 3:** Commit: `build(shared): add platform conditional exports for strict ESM resolvers`

### Task P3.12 — Add `no-restricted-imports` ESLint rule for `database.server.ts`

**Files:** `packages/shared/eslint.config.mjs` (new), `apps/web/eslint.config.mjs`, `apps/mobile/eslint.config.mjs`

- [ ] **Step 1:** Create the ESLint config for the shared package (it currently has none per shared audit F6). Extend the root config.
- [ ] **Step 2:** Add the `no-restricted-imports` rule blocking `@elogbook/shared/src/types/database.server` with message "Server-only types — never import in client code".
- [ ] **Step 3:** Run `pnpm --filter @elogbook/shared lint` — should pass.
- [ ] **Step 4:** Propagate the rule to `apps/web` and `apps/mobile` eslint configs.
- [ ] **Step 5: DOUBLE-CHECK.** Add a temp `import 'database.server'` in a web component — `pnpm --filter @elogbook/web lint` — error. Remove the temp import.
- [ ] **Step 6:** Commit: `lint(shared): add eslint config + no-restricted-imports for database.server`

### Task P3.13 — Add a build step producing `dist/` + `.d.ts` via tsup

**Files:** `packages/shared/package.json`, `packages/shared/tsconfig.build.json` (new)

- [ ] **Step 1:** `pnpm --filter @elogbook/shared add -D tsup`.
- [ ] **Step 2:** Add `build: "tsup src/index.ts --dts --format esm,cjs --out dist"` to `package.json`. Update `main`/`types`/`exports` to point at `dist`.
- [ ] **Step 3:** Create `tsconfig.build.json` with `outDir: dist`, `declaration: true`, `noEmit: false`.
- [ ] **Step 4:** Run `pnpm --filter @elogbook/shared build` — `dist/` populated.
- [ ] **Step 5: DOUBLE-CHECK.** `pnpm --filter @elogbook/web build` — succeeds consuming `dist`. `pnpm --filter @elogbook/mobile build` — succeeds.
- [ ] **Step 6:** Commit: `build(shared): produce dist + dts via tsup; update package exports`

### Task P3.14 — Phase 3 gate verification

- [ ] `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/shared lint && pnpm --filter @elogbook/shared test` — all pass.
- [ ] Coverage on `@elogbook/shared` ≥70% (per the plan target).
- [ ] `grep -r "as any" packages/shared/src` — zero.
- [ ] `grep -r "from '\.\./components/\(GlassPanel\|StatusBadge\|ProgressRing\)'" apps/mobile` — zero.
- [ ] Web + mobile typecheck exit 0 consuming the new `dist`.
- [ ] Contrast test passes for both themes.

---

## 7. PHASE 4 — WEB APP: SECURITY, PERFORMANCE, A11Y, DEAD CODE

> **Sequential. Depends on Phase 1 + Phase 3.**

### Task P4.0 — Delete the 15 dead-code files (~1,100 lines)

**Files:** `apps/web/components/DashboardContent.tsx`, `AIInsightsPanel.tsx`, `NetworkStatusProvider.tsx`, `OfflineBanner.tsx`, `ProgressRing.tsx`, `FormSkeleton.tsx`, `cases/CasePagination.tsx`, `icons.tsx`, `approvals/{useApprovalsData,PendingCaseCard,PendingCaseList,ApprovalsHeader,KPIStrip,animations,index}.ts`

- [ ] **Step 1:** For each, Grep the repo to confirm zero external importers (the web audit already verified this — re-verify, don't trust).
- [ ] **Step 2:** `git rm` each file.
- [ ] **Step 3: DOUBLE-CHECK.** `pnpm --filter @elogbook/web typecheck` exit 0. `pnpm --filter @elogbook/web lint` exit 0.
- [ ] **Step 4:** Commit: `chore(web): delete 15 dead-code files (~1100 lines)`

### Task P4.1 — Fix mojibake in `ApprovalsDashboard.tsx`

**Files:** `apps/web/components/approvals/ApprovalsDashboard.tsx:290`

- [ ] **Step 1:** Read line 290. Replace `ΓÇô` with `–` (en-dash, U+2013).
- [ ] **Step 2: DOUBLE-CHECK.** Open the approvals page — the case name renders as `– Surgery Template` not `Ã¢Â€Â" Surgery Template`.
- [ ] **Step 3:** Commit: `fix(web): replace mojibake en-dash in ApprovalsDashboard`

### Task P4.2 — Wrap `getAuthContext` in `React.cache()` to dedupe per-request DB calls

**Files:** `apps/web/lib/supabase/auth.ts:26`

- [ ] **Step 1:** `import { cache } from 'react'; export const getAuthContext = cache(async () => { ... });`
- [ ] **Step 2: DOUBLE-CHECK.** Add a `console.count('getAuthContext')` temporarily; load the dashboard (which calls it from layout + page); confirm the count is `1` per request, not 2-3. Remove the temp log.
- [ ] **Step 3:** Commit: `perf(web): wrap getAuthContext in React.cache to dedupe per-request DB calls`

### Task P4.3 — Bound dashboard / reports queries (replace unbounded JS aggregation)

**Files:** `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx:204-219`, `apps/web/app/(authenticated)/[tenant]/reports/page.tsx:27-36`, `apps/web/app/(authenticated)/[tenant]/admin/overview/page.tsx:45`, `supabase/migrations/00071_case_counts_rpc.sql` (new)

- [ ] **Step 1:** Create a `get_case_counts(tenant_id, group_by)` RPC (`00071`) that returns `{ status, count }[]` or `{ month, count }[]` server-side.
- [ ] **Step 2:** Replace the JS `for`-loop aggregation in the dashboard with a single `supabase.rpc('get_case_counts', ...)` call.
- [ ] **Step 3:** Same for reports (status + specialty) and admin overview (no more 50-row cap).
- [ ] **Step 4: DOUBLE-CHECK.** Seed 500 residents × 5 cases (per `scripts/seed-500-residents.sql`); load the dashboard — confirms counts match the seeded total, not just 50.
- [ ] **Step 5:** Commit: `perf(web): replace unbounded JS aggregation with get_case_counts RPC`

### Task P4.4 — Add per-segment `loading.tsx` and a global `not-found.tsx`

**Files:** 9 new `loading.tsx` files for `cases/new`, `cases/[id]`, `goals`, `reports`, `billing`, `admin`, `admin/overview`, `audit`, `(authenticated)/dashboard`. New `apps/web/app/not-found.tsx` and `apps/web/app/(authenticated)/[tenant]/not-found.tsx`. Modify `apps/web/app/(authenticated)/[tenant]/admin/page.tsx:11-14`.

- [ ] **Step 1:** Each `loading.tsx` is a thin skeleton (`<FormSkeleton/>` or `<TableSkeleton/>`).
- [ ] **Step 2:** `not-found.tsx` — branded, with a link to `/{tenant}/dashboard` (read from params) and `/login`.
- [ ] **Step 3:** Add `loading: () => <Skeleton/>` to each `dynamic()` in `apps/web/app/(authenticated)/[tenant]/admin/page.tsx:11-14`.
- [ ] **Step 4: DOUBLE-CHECK.** Navigate to a non-existent case id — branded 404 renders. Navigate to `/admin` — skeleton renders while the admin chunk loads.
- [ ] **Step 5:** Commit: `feat(web): add loading skeletons for 9 routes + branded not-found pages`

### Task P4.5 — Surface query errors on pages (destructure `error`)

**Files:** `apps/web/app/(authenticated)/[tenant]/goals/page.tsx:37`, `reports/page.tsx:27-36`, `billing/page.tsx:23-47`, `admin/page.tsx:39-65`

- [ ] **Step 1:** For each query, destructure `error` and render `<ErrorDisplay error={error} />` if present.
- [ ] **Step 2: DOUBLE-CHECK.** Break the Supabase URL temporarily; load each page — error UI shows, not blank.
- [ ] **Step 3:** Commit: `fix(web): surface query errors on goals/reports/billing/admin pages`

### Task P4.6 — Fix broken PDF binary response

**Files:** `apps/web/app/api/[tenant]/export-pdf/route.ts:72-77`

- [ ] **Step 1:** Per web audit C12, `supabase.functions.invoke` returns parsed JSON by default. Use `fetch(functionUrl, { headers: { Authorization: \`Bearer ${session.access_token}\` } })` directly and `new NextResponse(await res.blob(), { headers: { 'content-type': 'application/pdf' } })`.
- [ ] **Step 2: DOUBLE-CHECK.** Trigger a PDF export from the reports page — the downloaded file opens in a PDF viewer (not a JSON file). Verify the file starts with `%PDF-`.
- [ ] **Step 3:** Commit: `fix(web): stream PDF blob correctly from edge function to client`

### Task P4.7 — Drop `unsafe-inline` from CSP; add `frame-ancestors 'none'`; dev-only `unsafe-eval`

**Files:** `apps/web/middleware.ts:7`, `apps/web/next.config.js`

- [ ] **Step 1:** Change `script-src` to `'self' 'nonce-${nonce}' 'strict-dynamic'` — drop `'unsafe-inline'`.
- [ ] **Step 2:** Add `frame-ancestors 'none'` to the CSP.
- [ ] **Step 3:** Also ensure `unsafe-eval` is dev-only (per root audit I8): in `next.config.js`, branch on `process.env.NODE_ENV`.
- [ ] **Step 4: DOUBLE-CHECK.** Open the app, check response headers — no `unsafe-inline` in `script-src` in production. No CSP violations in console for normal app usage.
- [ ] **Step 5:** Commit: `security(web): drop unsafe-inline from CSP, add frame-ancestors none, dev-only unsafe-eval`

### Task P4.8 — Revoke global-admin cross-tenant PHI access

**Files:** `apps/web/lib/supabase/auth.ts:84-86`, `apps/mobile/lib/supabase/middleware.ts:81`

> Web audit B7. A global `admin` can browse any tenant's PHI today.

- [ ] **Step 1:** Remove the `admin` tenant bypass in `canAccessTenant`. Admins must be explicitly provisioned into a tenant (via a new `admin_tenants` join table OR an explicit `tenant_id` in their profile).
- [ ] **Step 2:** Add an admin-only "tenant switcher" UI that requires a fresh auth event (re-verify credentials) and writes an audit log entry before granting access to a different tenant.
- [ ] **Step 3:** Test: admin can list tenants; clicking one requires re-auth; after re-auth, admin accesses that tenant; an audit log row records the cross-tenant access.
- [ ] **Step 4: DOUBLE-CHECK.** Sign in as `platform@demo.com`, try to navigate to `/{other-tenant}/cases` directly — redirected to a "tenant switch" page requiring re-auth.
- [ ] **Step 5:** Commit: `security(web): require explicit tenant provisioning + re-auth + audit for admin cross-tenant access`

### Task P4.9 — Add focus trap to `ConfirmDialog` and `HelpPopover`

**Files:** `apps/web/components/case-form/ConfirmDialog.tsx:38-46`, `apps/web/components/HelpPopover.tsx:60-75`, add dep `react-focus-lock`

- [ ] **Step 1:** `pnpm --filter @elogbook/web add react-focus-lock`.
- [ ] **Step 2:** Wrap the modal content in `<FocusLock>`; restore focus to the trigger on close.
- [ ] **Step 3:** Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to both.
- [ ] **Step 4: DOUBLE-CHECK.** Tab through the confirm dialog — focus cycles within. Escape closes; focus returns to the trigger.
- [ ] **Step 5:** Commit: `a11y(web): focus trap + restore + dialog roles on ConfirmDialog and HelpPopover`

### Task P4.10 — Add `aria-hidden` to decorative SVGs; configure `next/image`

**Files:** `apps/web/next.config.js` (images.remotePatterns), every decorative `<svg>` in `apps/web/components` and `apps/web/app`

- [ ] **Step 1:** Grep `apps/web/components` and `apps/web/app` for `<svg` — add `aria-hidden="true" focusable="false"` to each decorative one.
- [ ] **Step 2:** Configure `images.remotePatterns` in `next.config.js` for any future image hosts.
- [ ] **Step 3: DOUBLE-CHECK.** Run axe — zero "decorative SVG not hidden" violations.
- [ ] **Step 4:** Commit: `a11y(web): aria-hidden decorative SVGs; configure next/image remotePatterns`

### Task P4.11 — Wrap login form in `<form>` element; Enter-to-submit

**Files:** `apps/web/app/login/page.tsx:85-123`

- [ ] **Step 1:** Wrap the inputs + button in `<form onSubmit={handleSubmit}>`. Button becomes `type="submit"`.
- [ ] **Step 2: DOUBLE-CHECK.** Focus the email field, type, press Tab to password, type, press Enter — submits (no need to click the button).
- [ ] **Step 3:** Commit: `a11y(web): wrap login form in <form>; Enter submits`

### Task P4.12 — Add audit log writes from web tier

**Files:** `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts`, `apps/web/app/auth/signout/route.ts`, `apps/web/app/api/[tenant]/admin/assign-role/route.ts`, `apps/web/app/api/[tenant]/admin/ai-config/route.ts`, `supabase/migrations/00072_log_audit_event_rpc.sql` (new)

- [ ] **Step 1:** `00072` — create `log_audit_event(p_action text, p_table text, p_resource_id uuid, p_changes jsonb)` SECURITY DEFINER RPC that inserts into `audit_logs` with the caller's `auth.uid()` and `get_tenant_id()`. REVOKE EXECUTE from public; GRANT to `authenticated`.
- [ ] **Step 2:** Call `log_audit_event` from each of the four web routes (submit, signout, assign-role, ai-config) with the appropriate action/table/changes.
- [ ] **Step 3:** Test: trigger each action; assert an `audit_logs` row exists.
- [ ] **Step 4: DOUBLE-CHECK.** Sign in, submit a case, sign out — `SELECT action FROM audit_logs ORDER BY created_at DESC LIMIT 3;` shows `case_submit`, `case_status_change` (from DB trigger), `signout`.
- [ ] **Step 5:** Commit: `feat(web): write audit events from web tier (submit, signout, role assign, config)`

### Task P4.13 — Add explicit cookie options to server Supabase client

**Files:** `apps/web/lib/supabase/server.ts:16-27`

- [ ] **Step 1:** Pass explicit `cookieOptions: { secure: true, httpOnly: true, sameSite: 'lax' }` (or `'strict'`) to `createServerClient`.
- [ ] **Step 2: DOUBLE-CHECK.** Inspect the `sb-*-auth-token` cookie in DevTools — `HttpOnly` and `Secure` flags present.
- [ ] **Step 3:** Commit: `security(web): explicit secure/httpOnly/sameSite cookie options on server client`

### Task P4.14 — Fix `UserManager` invite flow to create the profile row

**Files:** `apps/web/components/UserManager.tsx:84-92`, new server route `apps/web/app/api/[tenant]/admin/invite/route.ts`, `supabase/migrations/00073_invite_user_rpc.sql` (new)

- [ ] **Step 1:** `00073` — create `invite_user(p_email text, p_role text, p_full_name text)` SECURITY DEFINER RPC that: (a) calls `auth.admin.createUser` server-side with the email + the caller's `tenant_id` in `app_metadata`; (b) inserts a `profiles` row with the chosen role and tenant; (c) sends an invite email. REVOKE EXECUTE from public; GRANT to `director+`.
- [ ] **Step 2:** Create the server route `POST /api/[tenant]/admin/invite` going through `withTenantAuth` that calls `invite_user` RPC.
- [ ] **Step 3:** Update `UserManager.tsx` to call the new route instead of `supabase.auth.signInWithOtp` directly.
- [ ] **Step 4:** Test: invite a user — assert a `profiles` row exists with the chosen role and the caller's tenant_id.
- [ ] **Step 5: DOUBLE-CHECK.** Sign in as the invited user (via the invite email) — `getAuthContext` succeeds (no "Profile not found").
- [ ] **Step 6:** Commit: `fix(web): invite-user flow creates profile + tenant link via server RPC`

### Task P4.15 — Fix `Sidebar` hydration mismatch (localStorage-seeded state)

**Files:** `apps/web/components/Sidebar.tsx:22-27`

- [ ] **Step 1:** Initialize `collapsed` to `false`. Read `localStorage.getItem('sidebar-collapsed')` in a `useEffect` and `setCollapsed` after mount. Add `suppressHydrationWarning` to the `<aside>`.
- [ ] **Step 2: DOUBLE-CHECK.** View page source (SSR) and the rendered DOM — both render the same `collapsed` value initially. No React hydration warning in console.
- [ ] **Step 3:** Commit: `fix(web): read sidebar collapsed state post-mount to avoid hydration mismatch`

### Task P4.16 — Memoize `ApprovalsDashboard` derived counters; wrap `fetchPending` in `useCallback`

**Files:** `apps/web/components/approvals/ApprovalsDashboard.tsx:154-156,199-211`

- [ ] **Step 1:** Wrap "Today" / "This Week" inline IIFE counters in `useMemo` keyed on `pendingCases`.
- [ ] **Step 2:** Wrap `fetchPending` in `useCallback` (or define inside the effect).
- [ ] **Step 3:** Add `cancelAnimationFrame` cleanup to `SimpleCounter` (`components/approvals/SimpleCounter.tsx:18-27`).
- [ ] **Step 4: DOUBLE-CHECK.** React DevTools profiler — re-renders on approval action don't recompute the counters needlessly.
- [ ] **Step 5:** Commit: `perf(web): memoize approvals counters and fetchPending; cleanup SimpleCounter rAF`

### Task P4.17 — Switch `audit/page.tsx` from offset to cursor pagination

**Files:** `apps/web/app/(authenticated)/[tenant]/audit/page.tsx:51-56`

- [ ] **Step 1:** Replace `.range(offset, offset+PAGE_SIZE-1)` with cursor pagination (use the same pattern as `lib/supabase/pagination.ts` but on `audit_logs` ordered by `created_at DESC, id DESC`).
- [ ] **Step 2: DOUBLE-CHECK.** Seed 10k audit rows; load the audit page — first page renders in <200ms; "Load more" works.
- [ ] **Step 3:** Commit: `perf(web): cursor-paginate audit_logs (offset pagination degraded at scale)`

### Task P4.18 — Fix signout CSRF + logout `console` cleanup

**Files:** `apps/web/app/auth/signout/route.ts:5`, `apps/web/components/Sidebar.tsx:128,142`

- [ ] **Step 1:** In `/auth/signout` route, validate Origin (via `validateOrigin`) before signing out.
- [ ] **Step 2: DOUBLE-CHECK.** From a different origin, POST to `/auth/signout` — 403. From the app, sign out works.
- [ ] **Step 3:** Commit: `security(web): validate Origin on signout to prevent CSRF logout`

### Task P4.19 — Add `maxDuration` to long-running routes; runtime config

**Files:** `apps/web/app/api/[tenant]/export-pdf/route.ts`, `apps/web/app/api/health/route.ts`

- [ ] **Step 1:** Add `export const maxDuration = 30;` to `export-pdf` route (serverless timeout).
- [ ] **Step 2:** Add `export const runtime = 'nodejs'` where needed (verify Next 16 defaults).
- [ ] **Step 3: DOUBLE-CHECK.** Deploy preview; trigger a long PDF export — does not timeout at 10s (the default).
- [ ] **Step 4:** Commit: `perf(web): declare maxDuration on export-pdf route for serverless`

### Task P4.20 — Phase 4 gate verification

- [ ] `pnpm --filter @elogbook/web typecheck && lint && test` — all pass.
- [ ] `pnpm --filter @elogbook/web test:e2e` — login + dashboard specs pass.
- [ ] Lighthouse run (chrome): Performance ≥80, Accessibility ≥95, Best Practices ≥95, SEO ≥90 on `/login` and `/{tenant}/dashboard`.
- [ ] `grep -r "dangerouslySetInnerHTML" apps/web` — zero (verify).
- [ ] `grep -r "as any" apps/web/app apps/web/components apps/web/lib` — only the explicitly-allowed `export-pdf` catch (typed as `unknown` per P4 — verify zero).
- [ ] CSP audit: `curl -v https://localhost:3000/` — no `unsafe-inline`, `frame-ancestors 'none'` present.
- [ ] Rate-limit: hammer an endpoint 31× as one user → 429. 30× as another user → 200.

---

## 8. PHASE 5 — MOBILE APP: SYNC, ENCRYPTION, COMPILE, A11Y

> **Sequential. Depends on Phase 1 + Phase 3.**

### Task P5.0 — Add SQLCipher encryption-at-rest to WatermelonDB (S6)

**Files:** `apps/mobile/lib/db/database.ts:15-27`, add dep `expo-sqlite` with encryption or `react-native-quick-sqlite` + SQLCipher

> **This is S6.** PHI plaintext on device = HIPAA/GDPR breach risk.

- [ ] **Step 1:** Read `apps/mobile/lib/db/database.ts` — confirm no encryption.
- [ ] **Step 2:** Add `expo-secure-store` to generate and store a 256-bit DB encryption key per install (create on first launch, store in the keychain/keystore).
- [ ] **Step 3:** Switch the WatermelonDB adapter to use the encrypted SQLite variant (`expo-sqlite` with `openDatabaseAsync({ key })` or `react-native-quick-sqlite` SQLCipher). Pass the key from SecureStore.
- [ ] **Step 4:** Add a migration (`00073_mobile_db_encrypted.sql` equivalent for WatermelonDB schema bump) that re-encrypts existing data: read all rows with the old (unencrypted) DB, write to the new encrypted DB, delete the old file.
- [ ] **Step 5: Write a test** asserting the SQLite file on disk is not human-readable (open the `.db` file in a text editor — should be binary, not plaintext).
- [ ] **Step 6: DOUBLE-CHECK.** Run the app, log a case with an MRN, then `adb pull` / Xcode container download the SQLite file — `strings` on the file does NOT reveal the MRN.
- [ ] **Step 7:** Commit: `security(mobile): encrypt WatermelonDB SQLite at rest via SQLCipher + SecureStore key`

### Task P5.1 — Add biometric gate (`expo-local-authentication`)

**Files:** `apps/mobile/app/_layout.tsx`, add dep `expo-local-authentication`

- [ ] **Step 1:** `pnpm --filter @elogbook/mobile add expo-local-authentication`.
- [ ] **Step 2:** Add a `BiometricGate` component that wraps the authenticated layout: on app foreground, require FaceID/fingerprint before showing PHI. Cache the auth for 5 min (configurable).
- [ ] **Step 3:** Add `NSFaceIDUsageDescription` to `app.json` `infoPlist` (iOS) and `USE_BIOMETRIC` permission string to Android.
- [ ] **Step 4:** Add a settings toggle to disable biometrics (with a warning).
- [ ] **Step 5: DOUBLE-CHECK.** Background the app, foreground it — biometric prompt appears. Bypass with device PIN works.
- [ ] **Step 6:** Commit: `feat(mobile): biometric gate on app foreground via expo-local-authentication`

### Task P5.2 — Add screenshot prevention (`expo-screen-capture`)

**Files:** `apps/mobile/app/_layout.tsx`, add dep `expo-screen-capture`

- [ ] **Step 1:** `pnpm --filter @elogbook/mobile add expo-screen-capture`.
- [ ] **Step 2:** Add `usePreventScreenCapture()` hook at the root layout level.
- [ ] **Step 3:** On Android, set `FLAG_SECURE` via the plugin or a native module.
- [ ] **Step 4:** Add `addListener` for screenshot attempts — show a warning toast "Screenshots disabled for PHI protection".
- [ ] **Step 5: DOUBLE-CHECK.** Attempt a screenshot on iOS — the screenshot is blank/black. On Android — the OS blocks it.
- [ ] **Step 6:** Commit: `security(mobile): block screenshots via expo-screen-capture + FLAG_SECURE`

### Task P5.3 — Add certificate pinning for Supabase HTTPS

**Files:** `apps/mobile/app.json`, add dep `expo-build-properties`, create `network_security_config.xml` (Android)

- [ ] **Step 1:** Add `expo-build-properties` plugin to `app.json` plugins array.
- [ ] **Step 2:** Configure Android `networkSecurityConfig` with pin set for `*.supabase.co` (fetch the current cert chain and pin the SHA-256 of the intermediate + leaf).
- [ ] **Step 3:** iOS ATS is already strict by default; verify `NSAppTransportSecurity` doesn't have exceptions.
- [ ] **Step 4: DOUBLE-CHECK.** Use a MITM proxy (Charles) — confirm the app refuses to connect to Supabase through the proxy.
- [ ] **Step 5:** Commit: `security(mobile): certificate pinning for supabase.co on Android`

### Task P5.4 — Remove overbroad Android storage permissions

**Files:** `apps/mobile/app.json:29-33`

- [ ] **Step 1:** Remove `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` permissions. Use scoped photo picker (`expo-image-picker` already present) for any future attachment feature.
- [ ] **Step 2: DOUBLE-CHECK.** Build the app, inspect the manifest — no `EXTERNAL_STORAGE` permissions.
- [ ] **Step 3:** Commit: `security(mobile): remove overbroad Android storage permissions`

### Task P5.5 — Fix mobile auth guard (logged-out users can reach tabs)

**Files:** `apps/mobile/app/(tabs)/_layout.tsx:14-34`

- [ ] **Step 1:** Add a `useAuthGuard()` hook that returns `isAuthenticated` and `isLoading`. In `(tabs)/_layout.tsx`, if `!isLoading && !isAuthenticated`, redirect to `/login` and render null.
- [ ] **Step 2:** Test: sign out, deep-link to `elogbook://cases` — should redirect to `/login`.
- [ ] **Step 3: DOUBLE-CHECK.** Sign out, immediately try to navigate to a tab — login screen appears.
- [ ] **Step 4:** Commit: `security(mobile): auth guard on (tabs) layout prevents logged-out access`

### Task P5.6 — Implement edit-case path in `log-case.tsx` (currently broken)

**Files:** `apps/mobile/app/(tabs)/log-case.tsx`, `apps/mobile/app/case-detail.tsx:306,344`, `apps/mobile/app/(tabs)/my-cases.tsx:157`

- [ ] **Step 1:** In `log-case.tsx`, call `useLocalSearchParams()` to read `editCaseId`. If present, fetch the existing case from local DB (or Supabase if not cached), prefill the form, and on submit perform an UPDATE instead of INSERT.
- [ ] **Step 2:** Test: navigate to a rejected case, tap "Edit" — form opens prefilled. Submit — case transitions `rejected → draft → pending`.
- [ ] **Step 3: DOUBLE-CHECK.** Manual: create a case, get it rejected, tap Edit — form is prefilled. Submit — case is pending again.
- [ ] **Step 4:** Commit: `fix(mobile): implement edit-case path via editCaseId param in log-case`

### Task P5.7 — Produce `modified` / `conflict` states; wire conflict UI callback

**Files:** `apps/mobile/lib/db/storage.ts:56-79`, `apps/mobile/lib/sync.ts:87-92,205-234`, `apps/mobile/app/(tabs)/my-cases.tsx`

- [ ] **Step 1:** In `storage.ts`, when updating an existing synced record locally, set `localSyncStatus='modified'`.
- [ ] **Step 2:** In `sync.ts` `pushCases`, if the server returns 409 (conflict), set `localSyncStatus='conflict'` on the local row.
- [ ] **Step 3:** Register a `setConflictCallback` in `my-cases.tsx` that shows the conflict banner with a "Keep local" / "Keep server" choice.
- [ ] **Step 4:** Test: edit a case on two devices, sync — the later sync detects the conflict and shows the banner.
- [ ] **Step 5: DOUBLE-CHECK.** Manual: edit on web and mobile simultaneously, sync — banner appears, choice resolves it.
- [ ] **Step 6:** Commit: `fix(mobile): produce modified/conflict states; wire conflict resolution UI`

### Task P5.8 — Fix push id divergence: write server id back to local record after insert

**Files:** `apps/mobile/lib/sync.ts:177-189`

- [ ] **Step 1:** After `result.select('id')`, call `updateSyncStatus(draft, 'synced', serverId)` — extend the helper to accept and write the server id to the local record's `server_id` column (add this column to the model + schema bump).
- [ ] **Step 2:** On subsequent `modified` updates, use `.eq('id', serverId)` instead of the local UUID.
- [ ] **Step 3:** Test: insert a case, sync, edit it, sync — the update reaches the server (no 404).
- [ ] **Step 4: DOUBLE-CHECK.** Manual: insert + sync + edit + sync — the web shows the updated case.
- [ ] **Step 5:** Commit: `fix(mobile): write server id back to local record after insert; use it for updates`

### Task P5.9 — Fix incremental sync: use max server `updated_at`, not `Date.now()`

**Files:** `apps/mobile/lib/sync.ts:268`, `apps/mobile/lib/db/storage.ts:434-437`

- [ ] **Step 1:** In `pullCases`, track the max `updated_at` seen in the response; call `setLastSyncTimestamp(maxUpdatedAt)` instead of `Date.now()`.
- [ ] **Step 2:** Use `gt` (not `gte`) to avoid re-pulling the last row.
- [ ] **Step 3:** Test: with clock skew (device 1 min behind server), sync — no missed records, no duplicates.
- [ ] **Step 4: DOUBLE-CHECK.** Manual: change device clock to 5 min in the past, sync — still works.
- [ ] **Step 5:** Commit: `fix(mobile): incremental sync uses max server updated_at, not device wall-clock`

### Task P5.10 — Add atomic batch push; surface partial failures to user

**Files:** `apps/mobile/lib/sync.ts:149-203`

- [ ] **Step 1:** Replace the one-by-one push loop with a Supabase batch insert/update via `.upsert([...], { onConflict: 'id' })` for new drafts and a transaction-style sequence for updates.
- [ ] **Step 2:** If the batch partially fails, set `localSyncStatus='conflict'` on the failed rows and surface a toast "X of Y cases failed to sync".
- [ ] **Step 3:** Test: mock a 500 on one row — the others sync, the failed one is marked conflict, user is notified.
- [ ] **Step 4: DOUBLE-CHECK.** Manual: submit 3 drafts, kill network mid-sync, restore — all 3 eventually sync; the one that failed first is retried.
- [ ] **Step 5:** Commit: `fix(mobile): batch push with partial-failure surfacing`

### Task P5.11 — Add retry jitter; reset retry counter on reconnect

**Files:** `apps/mobile/lib/sync.ts:31,240-246,280-283`

- [ ] **Step 1:** Add `Math.random() * 30000` jitter to each retry delay.
- [ ] **Step 2:** On NetInfo reconnect, reset `retryCount = 0` and `lastSync = null` so the next sync starts fresh.
- [ ] **Step 3:** Cap retry at 5 min (already 300s — keep).
- [ ] **Step 4: DOUBLE-CHECK.** Simulate offline for 10 min, reconnect — sync starts immediately with jitter.
- [ ] **Step 5:** Commit: `fix(mobile): add retry jitter; reset retry counter on reconnect`

### Task P5.12 — Add WatermelonDB migrations (currently empty array)

**Files:** `apps/mobile/lib/db/migrations.ts:4-17`

- [ ] **Step 1:** Add migration steps for schema v2: add `server_id`, `local_sync_status` columns to `case_entries` (per P5.8/P5.7).
- [ ] **Step 2:** For users on schema v1, the migration writes default values and preserves existing data.
- [ ] **Step 3: DOUBLE-CHECK.** Install v1 of the app, log cases, upgrade to v2 — data preserved, new columns populated.
- [ ] **Step 4:** Commit: `fix(mobile): add WatermelonDB migration steps for schema v2`

### Task P5.13 — Remove `entry._raw` direct writes (T5.3 TODOs)

**Files:** `apps/mobile/lib/db/storage.ts` (33 sites)

- [ ] **Step 1:** Add `@json` model fields for `field_values`, `accreditation_mappings`, `fields`, `required_fields` to the WML models.
- [ ] **Step 2:** Replace every `entry._raw.foo = bar` with `await database.write(async () => { await entry.update(e => { e.foo = bar; }); });`.
- [ ] **Step 3:** Verify WatermelonDB reactivity now works — observers notify on changes.
- [ ] **Step 4: DOUBLE-CHECK.** `grep -n "_raw" apps/mobile/lib/db/storage.ts` — zero.
- [ ] **Step 5:** Commit: `fix(mobile): replace _raw direct writes with WML prepareCreate/Update (T5.3)`

### Task P5.14 — Add `DateTimePicker` for dates; add reject-comment input

**Files:** `apps/mobile/app/(tabs)/log-case.tsx:516,532,533`, `apps/mobile/app/(tabs)/approvals.tsx:180`, `apps/mobile/app/case-detail.tsx:163`, add dep `@react-native-community/datetimepicker`

- [ ] **Step 1:** `pnpm --filter @elogbook/mobile add @react-native-community/datetimepicker`.
- [ ] **Step 2:** Replace the free-text `YYYY-MM-DD` inputs for DOB and Case Date with the native picker.
- [ ] **Step 3:** In `approvals.tsx` and `case-detail.tsx`, add a comment input modal before reject — the RPC requires a non-empty comment.
- [ ] **Step 4:** Test: reject a case without a comment — UI blocks with "Please provide a reason".
- [ ] **Step 5: DOUBLE-CHECK.** Manual: pick a date — no typing errors. Reject with a comment — resident sees the reason.
- [ ] **Step 6:** Commit: `feat(mobile): native DateTimePicker; reject requires comment`

### Task P5.15 — Add VoiceOver/TalkBack labels; dynamic type; reduce-motion respect for haptics

**Files:** All mobile screens, `apps/mobile/lib/haptics.ts`

- [ ] **Step 1:** Add `accessibilityLabel` / `accessibilityRole` to every `<Text>` showing PHI, status, sync state, stats. Add `accessibilityValue` to `ProgressRing` (via shared component — already done in P3.10).
- [ ] **Step 2:** Add `allowFontScaling` and `maxFontSizeMultiplier` to all `<Text>` — honor Dynamic Type.
- [ ] **Step 3:** In `haptics.ts`, check `AccessibilityInfo.isReduceMotionEnabled()` and skip haptics if true.
- [ ] **Step 4: DOUBLE-CHECK.** Enable VoiceOver — every status, stat, sync banner is announced. Enable Dynamic Type — text scales. Enable Reduce Motion — haptics stop.
- [ ] **Step 5:** Commit: `a11y(mobile): VoiceOver labels, Dynamic Type, reduce-motion-aware haptics`

### Task P5.16 — Add per-screen ErrorBoundaries; route errors to Sentry

**Files:** `apps/mobile/app/(tabs)/_layout.tsx`, each tab screen, `apps/mobile/app/_layout.tsx`

- [ ] **Step 1:** Wrap each tab screen's content in a per-screen `<ErrorBoundary>` (from `@sentry/react-native` or a custom class component that calls `Sentry.captureException`).
- [ ] **Step 2:** Replace the root-only boundary with per-screen boundaries so a form crash doesn't unmount the app.
- [ ] **Step 3:** Test: throw in `log-case.tsx` — only that screen shows the error UI; the tab bar still works.
- [ ] **Step 4: DOUBLE-CHECK.** Trigger an error in one screen — other tabs still functional.
- [ ] **Step 5:** Commit: `feat(mobile): per-screen ErrorBoundaries routed to Sentry`

### Task P5.17 — Wire real push notifications (or remove the `expo-notifications` plugin)

**Files:** `apps/mobile/lib/notifications.ts`, `apps/mobile/app.json:50`

- [ ] **Step 1:** Either: (a) register an Expo push token at sign-in via `registerForPushNotificationsAsync()` and have the server send a push when an approval_request is resolved; or (b) remove the `expo-notifications` plugin from `app.json` and keep polling.
- [ ] **Step 2:** Prefer (a) for enterprise. Create a `push_tokens` table (migration `00074_push_tokens.sql`) and an `notify_resident` RPC.
- [ ] **Step 3:** Stop the 60s polling loop when push is enabled.
- [ ] **Step 4: DOUBLE-CHECK.** Submit a case as resident, approve as supervisor — resident receives a push notification (with the app in background).
- [ ] **Step 5:** Commit: `feat(mobile): real push notifications via expo-notifications + push_tokens table`

### Task P5.18 — Phase 5 gate verification

- [ ] `pnpm --filter @elogbook/mobile typecheck && lint && test` — all pass.
- [ ] Detox or Maestro E2E: login → log case offline → go online → sync → case appears on web.
- [ ] SQLCipher on — `strings` on the DB file reveals no PHI.
- [ ] Biometric gate — app foreground requires FaceID.
- [ ] Screenshot blocked on both platforms.
- [ ] Certificate pinning — MITM proxy fails.
- [ ] 100 offline-online cycles (per SC-006) — no data loss, no duplicate cases.

---

## 9. PHASE 6 — ENTERPRISE FEATURES: SSO, MFA, I18N, AUDIT, MONITORING

> **Sequential. Depends on Phase 2 + Phase 4 + Phase 5.**

### Task P6.0 — Add SSO/SAML/OIDC for enterprise tenants

**Files:** `supabase/config.toml` `[auth.sso]`, new `apps/web/app/login/sso/page.tsx`, new edge function `supabase/functions/sso-callback/index.ts`

- [ ] **Step 1:** Configure Supabase Auth SSO per-tenant: each institution can register a SAML metadata URL or OIDC discovery URL via an admin UI.
- [ ] **Step 2:** Add a "Sign in with SSO" button on `/login` that prompts for the tenant slug, then redirects to the IdP.
- [ ] **Step 3:** On successful SSO, `handle_new_user` links the SSO identity to the existing profile (matched by email) or creates a new profile tied to the tenant.
- [ ] **Step 4:** Test: configure a mock IdP (e.g. SimpleSAMLphp or Auth0 test tenant), sign in via SSO — assert the user lands on their tenant dashboard.
- [ ] **Step 5: DOUBLE-CHECK.** Sign in via SSO as an enterprise user — dashboard loads with the correct tenant.
- [ ] **Step 6:** Commit: `feat(auth): SSO/SAML/OIDC for enterprise tenants`

### Task P6.1 — Enforce MFA (TOTP) for director + institution_admin + admin roles

**Files:** `supabase/config.toml` `[auth.mfa]`, new `apps/web/app/(authenticated)/[tenant]/mfa/enroll/page.tsx`, new `apps/web/app/(authenticated)/[tenant]/mfa/verify/page.tsx`, `apps/web/lib/supabase/auth.ts`

- [ ] **Step 1:** Enable TOTP MFA in `config.toml`: `mfa.totp.enabled = true`.
- [ ] **Step 2:** In `getAuthContext`, after fetching the user, check `user.aal_level` (authenticators assurance level). If the user's role is `director`/`institution_admin`/`admin` AND `aal_level !== 'aal2'`, redirect to `/mfa/verify`.
- [ ] **Step 3:** Add an enrollment page at `/mfa/enroll` that calls `supabase.auth.mfa.enroll('totp')`, shows the QR code, and verifies the code.
- [ ] **Step 4:** Add a verify page that calls `supabase.auth.mfa.challenge` + `verify`.
- [ ] **Step 5:** Test: sign in as director without MFA enrolled — forced to enroll. Sign in as resident — no MFA required.
- [ ] **Step 6: DOUBLE-CHECK.** Sign in as `director@demo.com` — forced to enroll MFA. After enrollment, sign out + sign in — forced to verify TOTP.
- [ ] **Step 7:** Commit: `feat(auth): enforce TOTP MFA for director/admin roles`

### Task P6.2 — Add i18n with `next-intl` (web) and `expo-localization` + `i18n-js` (mobile)

**Files:** `apps/web/i18n/request.ts` (new), `apps/web/messages/en.json`, `apps/web/messages/ar.json`, `apps/mobile/i18n/index.ts` (new), `apps/mobile/locales/en.json`, `apps/mobile/locales/ar.json`, every component with hardcoded strings

- [ ] **Step 1:** `pnpm --filter @elogbook/web add next-intl`. `pnpm --filter @elogbook/mobile add expo-localization i18n-js`.
- [ ] **Step 2:** Extract every hardcoded UI string into `messages/en.json` (web) / `locales/en.json` (mobile). Use nested keys by feature (`login.title`, `dashboard.kpi.totalCases`, etc.).
- [ ] **Step 3:** Translate to Arabic (`ar.json`) — at minimum the login, dashboard, and case form flows.
- [ ] **Step 4:** Add a locale switcher in the Sidebar (web) and Profile (mobile). Persist choice in a cookie / SecureStore.
- [ ] **Step 5:** Honor `Accept-Language` header on web first load.
- [ ] **Step 6:** Wire the Zod error map from P3.4 to the active locale.
- [ ] **Step 7: DOUBLE-CHECK.** Switch to Arabic — UI flips to RTL (web: `dir="rtl"` on `<html>`; mobile: I18nManager.forceRTL). All strings translated.
- [ ] **Step 8:** Commit: `feat(i18n): next-intl on web + expo-localization on mobile; en + ar locales`

### Task P6.3 — Wire Sentry performance monitoring + session replay (verified P1.9 install)

**Files:** `apps/web/sentry.client.config.ts`, `apps/mobile/sentry.config.ts`

- [ ] **Step 1:** Enable `tracesSampleRate: 0.1` (10% of transactions) for performance.
- [ ] **Step 2:** Enable Session Replay for error-only mode (`replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 1.0`).
- [ ] **Step 3:** Add custom spans around the case submit and AI insights flows.
- [ ] **Step 4: DOUBLE-CHECK.** Trigger an error — Sentry shows the replay. Load the dashboard — a transaction appears.
- [ ] **Step 5:** Commit: `feat(observability): Sentry performance + session replay`

### Task P6.4 — Add analytics (PostHog or self-hosted)

**Files:** `apps/web/app/layout.tsx`, `apps/mobile/app/_layout.tsx`, add dep `posthog-js` (web) + `posthog-react-native` (mobile)

- [ ] **Step 1:** `pnpm --filter @elogbook/web add posthog-js`. `pnpm --filter @elogbook/mobile add posthog-react-native`.
- [ ] **Step 2:** Initialize PostHog with `autocapture: true` (web) and identify by `user.id` + `tenant_id` as a super property.
- [ ] **Step 3:** Define key events: `case_logged`, `case_submitted`, `case_approved`, `case_rejected`, `ai_query`, `subscription_started`, `mfa_enrolled`.
- [ ] **Step 4:** Add a consent banner (cookie/privacy) before initializing — required for GDPR.
- [ ] **Step 5: DOUBLE-CHECK.** Sign in, log a case — `case_logged` appears in PostHog.
- [ ] **Step 6:** Commit: `feat(analytics): PostHog on web + mobile with consent banner`

### Task P6.5 — Add data retention admin UI

**Files:** `apps/web/app/(authenticated)/[tenant]/admin/retention/page.tsx` (new)

- [ ] **Step 1:** Build the admin panel that lets an institution_admin set `tenants.data_retention_days` (per `complianceConfigSchema` 365-3650).
- [ ] **Step 2:** Show a forecast: "X cases will be soft-deleted on YYYY-MM-DD based on current retention."
- [ ] **Step 3:** Add a "Purge now" button (calls `enforce_data_retention` — restricted to admin role) with a confirmation modal.
- [ ] **Step 4: DOUBLE-CHECK.** Set retention to 1 day, click "Purge now" — old cases are soft-deleted.
- [ ] **Step 5:** Commit: `feat(web): data retention admin UI with purge forecast`

### Task P6.6 — Add consent management UI (GDPR/HIPAA)

**Files:** `apps/web/app/(authenticated)/[tenant]/consent/page.tsx` (new), `apps/mobile/app/(tabs)/profile.tsx`

- [ ] **Step 1:** Build a consent dashboard showing the user's `consent_records` (per `consent_records` table).
- [ ] **Step 2:** Allow withdraw/re-grant of consent types: `research`, `analytics`, `data_sharing`.
- [ ] **Step 3:** On withdraw of `analytics`, stop PostHog. On withdraw of `data_sharing`, restrict the user's cases from aggregate reports.
- [ ] **Step 4: DOUBLE-CHECK.** Withdraw analytics consent — PostHog stops tracking this user.
- [ ] **Step 5:** Commit: `feat(consent): user consent dashboard with withdraw/re-grant`

### Task P6.7 — Add audit log dashboard with filtering + export

**Files:** `apps/web/app/(authenticated)/[tenant]/audit/page.tsx` (already exists — enhance)

- [ ] **Step 1:** Add filters: date range (validated as ISO), action type (validated against an enum), user, table.
- [ ] **Step 2:** Add CSV/JSON export of the filtered audit log (rate-limited, audited itself via `log_audit_event`).
- [ ] **Step 3:** Add a "suspicious activity" view: failed login attempts, role changes, cross-tenant access, bulk exports.
- [ ] **Step 4: DOUBLE-CHECK.** Export the audit log as CSV — opens in Excel, contains the filtered rows, and an `audit_export` row appears in the audit log itself.
- [ ] **Step 5:** Commit: `feat(web): audit dashboard with filters, export, and suspicious-activity view`

### Task P6.8 — Add Stripe webhooks test mode + sandbox

**Files:** `supabase/functions/payment-webhook/index.ts`, `supabase/config.toml`

- [ ] **Step 1:** Add a `mode` check: if `gwConfig.mode === 'test'`, only process `event.livemode === false` events, and write them with a `test` flag.
- [ ] **Step 2:** Add a `stripe listen` local dev workflow doc (`docs/stripe-local.md`).
- [ ] **Step 3: DOUBLE-CHECK.** Send a test event via `stripe trigger checkout.session.completed` — the webhook processes it; a `stripe_events` row with `mode='test'` appears.
- [ ] **Step 4:** Commit: `feat(billing): Stripe test mode isolation in payment-webhook`

### Task P6.9 — Add per-tenant storage quotas + antivirus scan for attachments

**Files:** `supabase/migrations/00075_storage_quotas.sql` (new), `supabase/config.toml` `[storage]`

- [ ] **Step 1:** `00075` — add a `storage_quota_mb` column to `subscription_plans` and a `storage_used_mb` view per tenant.
- [ ] **Step 2:** Configure Supabase Storage `file_size_limit` per bucket (e.g. 20MB for case attachments).
- [ ] **Step 3:** Add a ClamAV scan hook (or Supabase's built-in antivirus if available) on upload.
- [ ] **Step 4: DOUBLE-CHECK.** Upload a 25MB file — rejected. Upload an EICAR test file — rejected by AV.
- [ ] **Step 5:** Commit: `feat(storage): per-tenant quotas + AV scan on attachments`

### Task P6.10 — Add Webhooks for tenant events (extensions ecosystem)

**Files:** `supabase/migrations/00076_tenant_webhooks.sql` (new), `supabase/functions/dispatch-webhook/index.ts` (new)

- [ ] **Step 1:** `00076` — `tenant_webhooks` table (url, secret, events array).
- [ ] **Step 2:** `dispatch-webhook` edge function: subscribe to Postgres changes on `case_entries` / `approval_requests`, sign the payload with HMAC-SHA256 using the webhook secret, POST to the URL with retry.
- [ ] **Step 3:** Admin UI to register webhooks.
- [ ] **Step 4: DOUBLE-CHECK.** Register a webhook to a test endpoint, approve a case — the endpoint receives a signed POST.
- [ ] **Step 5:** Commit: `feat(integrations): tenant webhooks for case/approval events`

### Task P6.11 — Add SCIM endpoint for enterprise user provisioning

**Files:** `supabase/functions/scim/index.ts` (new), `supabase/migrations/00077_scim_tokens.sql` (new)

- [ ] **Step 1:** `00077` — `scim_tokens` table (tenant_id, token_hash, created_at).
- [ ] **Step 2:** `scim` edge function implementing `/Users` GET/POST/PATCH/DELETE per SCIM 2.0 spec, authenticated via a bearer token.
- [ ] **Step 3:** Wire to `invite_user` RPC for create and `profiles` updates for patch.
- [ ] **Step 4: DOUBLE-CHECK.** Configure a SCIM client (Okta or a test client) — provision a user — assert a `profiles` row is created.
- [ ] **Step 5:** Commit: `feat(enterprise): SCIM 2.0 endpoint for automated user provisioning`

### Task P6.12 — Phase 6 gate verification

- [ ] SSO login works for an enterprise tenant.
- [ ] MFA enforced for director/admin; resident exempt.
- [ ] Switch to Arabic — RTL rendering correct.
- [ ] Sentry capturing errors + performance + replay.
- [ ] PostHog receiving events with consent gating.
- [ ] Data retention admin UI works.
- [ ] Consent withdraw stops analytics.
- [ ] Audit export works and is itself audited.
- [ ] Stripe test mode isolated.
- [ ] Storage quota + AV enforcement.
- [ ] Webhook delivery signed.
- [ ] SCIM provisioning works.

---

## 10. PHASE 7 — HARDENING & COMPLIANCE: PEN-TEST, DPIA, SBOM, BAA

> **Sequential. Depends on Phase 6.**

### Task P7.0 — Add SBOM generation to CI

**Files:** `.github/workflows/sbom.yml` (new), add dep `@cyclonedx/cyclonedx-npm` or use Syft

- [ ] **Step 1:** Create `.github/workflows/sbom.yml` that runs `npx @cyclonedx/cyclonedx-npm --output-file sbom.json` on every release-tagged build.
- [ ] **Step 2:** Upload `sbom.json` as a workflow artifact and to GitHub Releases.
- [ ] **Step 3: DOUBLE-CHECK.** Trigger a release build — `sbom.json` is attached.
- [ ] **Step 4:** Commit: `ci: generate CycloneDX SBOM on releases`

### Task P7.1 — Make `pnpm audit` and CodeQL blocking

**Files:** `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`

- [ ] **Step 1:** Remove `|| true` from the `pnpm audit` step; flip to blocking.
- [ ] **Step 2:** Configure CodeQL to fail the build on `error` severity findings.
- [ ] **Step 3: DOUBLE-CHECK.** Introduce a deliberate vulnerable dep — CI fails.
- [ ] **Step 4:** Commit: `ci: make pnpm audit and CodeQL blocking`

### Task P7.2 — Add Semgrep SAST scanning

**Files:** `.github/workflows/semgrep.yml` (new), `.semgrep.yml` (new)

- [ ] **Step 1:** Create a Semgrep config with rules for: SQL injection patterns, `dangerouslySetInnerHTML`, `eval`, hard-coded secrets, `any` casts in shared, PHI in logs.
- [ ] **Step 2:** Wire to CI.
- [ ] **Step 3: DOUBLE-CHECK.** Introduce a `dangerouslySetInnerHTML` — Semgrep flags it.
- [ ] **Step 4:** Commit: `ci: add Semgrep SAST scanning`

### Task P7.3 — Add ZAP DAST scanning against the preview deployment

**Files:** `.github/workflows/dast.yml` (new)

- [ ] **Step 1:** Add a ZAP baseline scan against the Vercel preview URL on every PR.
- [ ] **Step 2:** Fail on `HIGH` alerts.
- [ ] **Step 3: DOUBLE-CHECK.** Preview deploy — ZAP runs and reports zero HIGH.
- [ ] **Step 4:** Commit: `ci: add ZAP DAST scan on preview`

### Task P7.4 — Add Trivy container scan

**Files:** `.github/workflows/container-scan.yml` (new)

- [ ] **Step 1:** Scan the `apps/web/Dockerfile` image with Trivy on every build.
- [ ] **Step 2:** Fail on `CRITICAL` CVEs.
- [ ] **Step 3: DOUBLE-CHECK.** Build the image — Trivy scan passes (or reports fixable CVEs).
- [ ] **Step 4:** Commit: `ci: add Trivy container scan`

### Task P7.5 — External penetration test + DPIA artifacts

**Files:** `docs/compliance/pen-test-report-template.md` (new), `docs/compliance/dpia-template.md` (new), `docs/compliance/hipaa-checklist.md` (new), `docs/compliance/gdpr-checklist.md` (new)

- [ ] **Step 1:** Create templates for each. The pen-test report should include: scope, findings by severity, remediation status, sign-offs.
- [ ] **Step 2:** The DPIA template should cover: data flows, lawful basis, risks, mitigations, residual risk, retention.
- [ ] **Step 3:** The HIPAA checklist should map each Technical Safeguard (§164.312) to a control in this plan.
- [ ] **Step 4:** The GDPR checklist should map each Article (5, 7, 9, 12-14, 17, 20, 25, 28, 30, 32, 33, 34) to a control.
- [ ] **Step 5:** Engage an external pen-test firm (out of scope for this plan, but track it as a follow-up).
- [ ] **Step 6: DOUBLE-CHECK.** All four templates exist and are linked from `SECURITY.md`.
- [ ] **Step 7:** Commit: `docs(compliance): pen-test, DPIA, HIPAA, GDPR templates`

### Task P7.6 — Add Supabase PITR + branching config

**Files:** `supabase/config.toml` `[db.backups]`, `supabase/config.toml` `[branches]`, `docs/operations.md`

- [ ] **Step 1:** Configure `[db.backups] enabled = true` and `schedule` per Supabase docs. PITR is a Supabase-project-level setting — document the enablement in `docs/operations.md`.
- [ ] **Step 2:** Configure `[branches]` for preview environments on every PR.
- [ ] **Step 3:** Document the restore procedure (RTO ≤ 4h per SC-013).
- [ ] **Step 4: DOUBLE-CHECK.** Trigger a branch via `supabase branches create` — a preview DB is created.
- [ ] **Step 5:** Commit: `docs(supabase): PITR + branching config and restore runbook`

### Task P7.7 — Add key rotation for `APP_ENCRYPTION_KEY` and per-tenant MRN salt

**Files:** `supabase/migrations/00078_key_rotation.sql` (new), `docs/operations.md`

- [ ] **Step 1:** `00078` — add a `key_version` column to `ai_config` and `payment_gateway_config` (the bytea columns are encrypted with a versioned key). The `app.encryption_key` GUC becomes `app.encryption_key_v1`; new GUCs `app.encryption_key_v2` etc. support rotation.
- [ ] **Step 2:** Add a `rotate_encryption_key(old_version, new_version)` RPC that decrypts with old, re-encrypts with new, updates `key_version`.
- [ ] **Step 3:** Same for `tenants.mrn_hash_salt` — add a `salt_version` and a re-hash path.
- [ ] **Step 4:** Document the rotation procedure in `docs/operations.md` (semi-annual rotation).
- [ ] **Step 5: DOUBLE-CHECK.** Run `rotate_encryption_key(1, 2)` — all secrets re-encrypted; old key no longer needed to decrypt.
- [ ] **Step 6:** Commit: `feat(supabase): versioned encryption keys + rotation RPC + per-tenant salt rotation`

### Task P7.8 — Phase 7 gate verification

- [ ] SBOM generated on release.
- [ ] `pnpm audit` blocking in CI.
- [ ] CodeQL + Semgrep + ZAP + Trivy all pass on a clean main.
- [ ] Compliance templates exist and are linked from SECURITY.md.
- [ ] PITR enabled (verify in Supabase dashboard).
- [ ] Branching works for previews.
- [ ] Key rotation RPC tested.

---

## 11. PHASE 8 — LAUNCH READINESS: LOAD, DR, RUNBOOKS, SIGN-OFF

> **Sequential. Depends on Phase 7.**

### Task P8.0 — Run k6 load test (SC-014) in CI

**Files:** `.github/workflows/load-test.yml` (new), `scripts/load-test.js` (exists), `scripts/seed-500-residents.sql` (exists)

- [ ] **Step 1:** Create a workflow that runs on a schedule (nightly) + on release candidates: seed 500 residents, run `k6 run scripts/load-test.js`.
- [ ] **Step 2:** Fail the workflow if `p(95) > 500ms` or error rate > 1%.
- [ ] **Step 3:** Upload the k6 summary to artifacts.
- [ ] **Step 4: DOUBLE-CHECK.** Trigger the workflow — passes with p(95) < 500ms at 5K users.
- [ ] **Step 5:** Commit: `ci: run k6 load test nightly and on RCs (SC-014)`

### Task P8.1 — Run 100 offline-online sync cycles (SC-006) in Maestro

**Files:** `.maestro/sync-cycle.yml` (new), `apps/mobile/__tests__/sync-stress.test.ts` (new)

- [ ] **Step 1:** Write a Maestro flow that: logs a case offline, goes online, asserts sync, repeats 100×.
- [ ] **Step 2:** Run it in CI on iOS simulator + Android emulator (limited frequency — nightly).
- [ ] **Step 3: DOUBLE-CHECK.** 100 cycles complete with no data loss, no duplicate cases.
- [ ] **Step 4:** Commit: `test(mobile): 100 offline-online sync cycles (SC-006) via Maestro`

### Task P8.2 — DR drill runbook + execution

**Files:** `docs/operations/dr-drill.md` (new)

- [ ] **Step 1:** Write the runbook: simulate DB loss, restore from PITR to a point 1h ago, verify the app recovers, verify audit logs are intact.
- [ ] **Step 2:** Execute the drill in a staging environment; record RTO.
- [ ] **Step 3: DOUBLE-CHECK.** RTO ≤ 4h (per SC-013). Document the actual time.
- [ ] **Step 4:** Commit: `docs(dr): DR drill runbook + first execution record`

### Task P8.3 — Final Lighthouse + axe pass

**Files:** None (verification only)

- [ ] **Step 1:** Run Lighthouse on `/login`, `/{tenant}/dashboard`, `/{tenant}/cases`, `/{tenant}/approvals`, `/{tenant}/admin` — record scores.
- [ ] **Step 2:** Run axe DevTools on the same pages — zero violations.
- [ ] **Step 3: DOUBLE-CHECK.** Lighthouse: Performance ≥80, Accessibility ≥95, Best Practices ≥95, SEO ≥90 on all pages. axe: zero.
- [ ] **Step 4:** Commit: `docs: final Lighthouse + axe scores recorded`

### Task P8.4 — Final coverage report + threshold bump

**Files:** `vitest.config.ts` (root), per-app configs

- [ ] **Step 1:** Run `pnpm test:coverage` — record the final numbers.
- [ ] **Step 2:** Bump thresholds to the achieved levels (target: shared ≥85%, web ≥70%, mobile ≥60%).
- [ ] **Step 3: DOUBLE-CHECK.** `pnpm test:coverage` exits 0 with the new thresholds.
- [ ] **Step 4:** Commit: `test: bump coverage thresholds to final achieved levels`

### Task P8.5 — Final production-readiness checklist sign-off

**Files:** `docs/compliance/production-readiness-checklist.md` (new)

- [ ] **Step 1:** Create the checklist mapping every SC (SC-001..SC-014) and every FR (FR-001..FR-025) to a verification artifact (test, screenshot, log, report).
- [ ] **Step 2:** Sign off each item with a date + responsible party.
- [ ] **Step 3: DOUBLE-CHECK.** Every item is signed; no item is unchecked.
- [ ] **Step 4:** Commit: `docs(compliance): production-readiness checklist signed off`

### Task P8.6 — Tag v1.0.0 release

**Files:** root `package.json` (version bump), all three packages, `CHANGELOG.md`

- [ ] **Step 1:** Bump `version` from `0.0.0` to `1.0.0` in all four `package.json` files.
- [ ] **Step 2:** Update `CHANGELOG.md` with the full list of changes since the last (non-existent) release.
- [ ] **Step 3:** `git tag -a v1.0.0 -m "E-Logbook Enterprise v1.0.0 — first production-ready release"`.
- [ ] **Step 4: DOUBLE-CHECK.** `git tag` shows `v1.0.0`. The release workflow (P7.0 SBOM) runs and attaches the SBOM.
- [ ] **Step 5:** Commit: `release: v1.0.0 — first production-ready release`

---

## 12. CROSS-CUTTING CONCERNS (APPLY THROUGHOUT)

These are not separate tasks but rules to apply in every task:

### 12.1 Testing rules
- Every code-touching task from Phase 2 onward includes a failing-test step (red), the implementation (green), and a refactor pass.
- Tests live next to the code: `foo.ts` → `__tests__/foo.test.ts`.
- Use the mock scaffold from P1.5 for any Supabase-touching test.
- E2E tests (Playwright web, Maestro mobile) cover the user-facing flows.
- Coverage thresholds rise with each phase; final targets in P8.4.

### 12.2 Accessibility rules
- Every interactive element is keyboard-operable.
- Every form field has a `<label>` (web) or `accessibilityLabel` (mobile).
- Color contrast ≥4.5:1 for text, ≥3:1 for UI components — verified by the contrast test from P3.5.
- `prefers-reduced-motion` is honored (P3.6).
- Decorative SVGs are `aria-hidden`.
- WCAG 2.1 AA is the floor; aim for AAA where feasible.

### 12.3 Security rules
- Never log PHI. The logger redacts `patient_mrn`/`patient_dob`/`patient_hash`/`field_values` automatically (P1.10).
- Every POST/PUT/DELETE route goes through `withTenantAuth` (CSRF + Origin + rate-limit + role gate).
- Every edge function verifies `resident_id` ownership before acting.
- Secrets are encrypted at rest (P2.1); never in plaintext columns; never in `audit_logs` (P0.7).
- `audit_logs` is append-only (P0.8).
- RLS is FORCED on every table (P0.6).

### 12.4 Performance rules
- `getAuthContext` is `React.cache`-wrapped (P4.2).
- No unbounded queries — use RPC aggregation (P4.3).
- Cursor pagination for large tables (P4.17).
- Mobile: no `console.log` in prod, no inline function props in lists, virtualized lists for >20 items.

### 12.5 Documentation rules
- Every new feature ships with a `docs/` update.
- ADRs live in `docs/adr/` (create in P6.x or as needed).
- `CHANGELOG.md` is updated in every PR that ships a user-facing change.
- `SECURITY.md` is the entry point for all security concerns.

### 12.6 Double-check mandate (for weak models)

**Every task ends with a DOUBLE-CHECK step.** That step is NOT optional. It requires:
1. Running the exact command listed.
2. Pasting the output.
3. Confirming the output matches the **Expected** line.
4. If it doesn't match, the task is NOT done — go back and fix it.

A weak model that says "I'm sure it works" without running the command has failed the task. A weak model that runs the command, sees a mismatch, and commits anyway has failed the task and broken the build. The double-check is the difference between "looks done" and "is done."

---

## 13. SUCCESS CRITERIA MAPPING

| Spec SC | Where addressed |
|---------|-----------------|
| SC-001: Mobile logbook parity with web | P3.7, P5.6, P5.13 |
| SC-002: Offline sync < 60s | P5.8-P5.11 |
| SC-003: Conflict resolution | P5.7 |
| SC-004: AI safety guardrails | P2.3 |
| SC-005: PDF export | P4.6, P2.10 |
| SC-006: 100 offline-online cycles | P5.0-P5.13, P8.1 |
| SC-007: WCAG AAA | P3.5, P3.6, P3.10, P4.9-P4.11, P5.15 |
| SC-008: Encryption at rest | P5.0, P2.1 |
| SC-009: Pen-test + DPIA | P7.5 |
| SC-010: Audit trail | P0.7, P0.8, P2.9, P4.12 |
| SC-011: Rate limiting | P2.5 |
| SC-012: 500 residents | P4.3, P8.0 |
| SC-013: 99.9% uptime + DR | P7.6, P8.2 |
| SC-014: 5K users p(95)<500ms | P4.3, P8.0 |

---

## 14. SELF-REVIEW NOTES

This plan was written by synthesizing five parallel senior-architect agent reports (web, mobile, shared, supabase, root-infra) totaling ~119 distinct findings (41 CRITICAL, 43 HIGH, 27 MEDIUM, 8 LOW). Cross-checks performed:

- **Spec coverage:** Every SC (1-14) is mapped to at least one task in §13. Every showstopper (S1-S12) is addressed by a Phase 0 or Phase 2 task.
- **Type consistency:** Task IDs follow `P<phase>.<n>` throughout. Verification commands are identical across tasks. Migration numbers are sequential 00048-00078 with no collisions (P1.16 fixes the existing 00046 collision).
- **Placeholder scan:** No "TBD" / "TODO later" / "implement appropriately" in the plan. Every step has a concrete action or a code snippet. Where a step references a helper from an earlier task (e.g. "use the mock scaffold from P1.5"), the dependency is explicit.
- **Dependency ordering:** Phase 0 ↔ Phase 1 parallel; Phase 2 needs Phase 1; Phase 3 needs Phase 2; Phase 4/5 need Phase 1+3; Phase 6 needs 2+4+5; Phase 7 needs 6; Phase 8 needs 7. No task references a helper that doesn't exist by then.
- **Brutal honesty:** The executive summary (§1) does not soften the audit findings. The plan explicitly states the repo "must not process real PHI in its current state."

If you find a gap while executing, do NOT silently fill it — add a task to this plan (in the right phase) with the same structure, then execute it. The plan is the source of truth.

---

## 15. EXECUTION HANDOFF

This plan is **ready to execute**. Two options:

**1. Subagent-Driven (recommended)** — Dispatch one fresh subagent per task using `superpowers:subagent-driven-development`. Review between tasks. Two-stage review: (a) executor self-verifies with the DOUBLE-CHECK step, (b) a separate reviewer subagent returns APPROVE or REQUEST_CHANGES. This catches weak-model mistakes.

**2. Inline Execution** — Run tasks in this session using `superpowers:executing-plans` with batch checkpoints. Faster but no independent review.

**Recommended starting point:** Phase 0 Task P0.5 (fix `approve_case` tenant_id — unbreaks supervisor approvals) and Task P0.9 (fix mobile compile errors — unbreaks the primary user flow). These two have the highest user-facing impact and should land first.

---

*End of plan. 133 tasks across 9 phases. Estimated ~140 commits. Every task is verifiable by a small or weak model that follows the DOUBLE-CHECK mandate.*
