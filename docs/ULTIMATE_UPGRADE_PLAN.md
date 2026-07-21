# E-Logbook Ultimate Production-Ready Upgrade Plan v2

> **For agentic workers:** This plan was synthesized from a 7-agent deep audit swarm. Each task is self-contained (2–10 min), written so a small free LLM can vibecode it in one shot. Run the verification command exactly as written. Commit after each task. Tasks are ordered by revenue impact (blockers first).

**Goal:** Get the elogbook SaaS to accept its first paying junior-doctor customer, with a fast 30-second case-logging experience, secure PHI handling, and a deployable CI/CD pipeline.

**Context:** A previous plan (`ANALYSIS_AND_UPGRADE_PLAN.md`) fixed 16 critical blockers (demo accounts, payment-webhook single-tenant, audit-export key leak, FORCE RLS, RLS tests, pricing page, login dark mode, mobile offline disable, env fail-fast, CSP hardening, compliance docs). This plan addresses **everything remaining**.

**Architecture:** pnpm monorepo. Next.js 16 web at `apps/web`. Expo 56 mobile at `apps/mobile`. Supabase Postgres 17 + Deno Edge Functions at `supabase/`. Shared packages at `packages/shared` and `packages/env`. Multi-tenant with role hierarchy `admin → institution_admin → director → supervisor → resident`. Handles PHI (HIPAA/GDPR).

**Primary user:** a tired junior doctor on call at 3am on hospital WiFi. They need to log a procedure in under 30 seconds and trust that the data is safe.

---

## Table of Contents

1. [Phase 1 — Revenue Path (Blockers)](#phase-1--revenue-path-blockers)
2. [Phase 2 — Security Blockers](#phase-2--security-blockers)
3. [Phase 3 — Performance (30-Second Goal)](#phase-3--performance-30-second-goal)
4. [Phase 4 — Web UI/UX & Conversion](#phase-4--web-uiux--conversion)
5. [Phase 5 — DevOps & Deployment](#phase-5--devops--deployment)
6. [Phase 6 — Mobile TestFlight Readiness](#phase-6--mobile-testflight-readiness)
7. [Phase 7 — Test Coverage & CI Gates](#phase-7--test-coverage--ci-gates)
8. [Phase 8 — Final Verification](#phase-8--final-verification)

---

## Phase 1 — Revenue Path (Blockers)

These tasks unblock the ability to accept a paying customer. Do these FIRST.

### Task 1 — Create `/signup` route (the missing conversion path)

**Goal:** Anonymous visitors can sign up. Currently `/signup` 404s despite being linked from landing + pricing pages.

**Files:**
- Create: `apps/web/app/signup/page.tsx`
- Create: `apps/web/app/signup/__tests__/page.test.tsx`

- [ ] **Step 1:** Create `apps/web/app/signup/page.tsx` as a server component that:
  - Reads `?plan=` query param
  - Renders email + password form (reuse shared `FormField` from `packages/shared/src/components/FormField.web.tsx`)
  - On submit, calls `supabase.auth.signUp({ email, password, options: { emailRedirectTo: '/auth/callback?next=/onboarding', data: { plan_slug } } })`
  - Shows "Check your email" success state after submit
  - Has a link to `/login` for existing users
  - Uses design tokens (`bg-backdrop`, `text-text-primary`, `panel`, etc.) — NO hardcoded colors
  - Includes a hidden input or query param carrying the `plan` slug

- [ ] **Step 2:** Create `apps/web/app/signup/__tests__/page.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// Mock supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { signUp: vi.fn(async () => ({ data: { user: null }, error: null })) },
  })),
}));
describe('signup page', () => {
  it('renders email and password fields', async () => {
    const { default: SignupPage } = await import('../page');
    render(await SignupPage());
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
  it('renders a link to login', async () => {
    const { default: SignupPage } = await import('../page');
    render(await SignupPage());
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });
});
```

- [ ] **Step 3:** Run: `pnpm --filter @elogbook/web test -- signup`
- [ ] **Step 4:** Run: `pnpm --filter @elogbook/web typecheck`
- [ ] **Step 5:** Commit: `git add apps/web/app/signup/ && git commit -m "feat(signup): create /signup route with email+password (UX2-001)"`

---

### Task 2 — Create `/contact` route (enterprise sales path)

**Goal:** Enterprise prospects (SSO/SCIM/BAA inquiries) don't hit a 404.

**Files:**
- Create: `apps/web/app/contact/page.tsx`

- [ ] **Step 1:** Create `apps/web/app/contact/page.tsx` — a simple server component with:
  - A heading "Contact Sales"
  - A `mailto:sales@elogbook.app` link
  - A short form (name, email, institution, message) that posts to `/api/contact` (create a stub route that just returns 200 for now)
  - Uses design tokens

- [ ] **Step 2:** Commit: `git add apps/web/app/contact/ && git commit -m "feat(contact): create /contact route for enterprise sales (UX2-002)"`

---

### Task 3 — Add platform-default Stripe gateway fallback

**Goal:** Individual Free users can upgrade to Premium. Currently `create-checkout` 400s with "Gateway not configured" because there's no platform-default gateway row.

**Files:**
- Modify: `supabase/functions/create-checkout/index.ts`
- Modify: `supabase/seed.sql` (add a platform gateway row)

- [ ] **Step 1:** Read `supabase/functions/create-checkout/index.ts`. Find the `.from('secret_payment_gateway_config').select().eq('tenant_id', tenantId).single()` call.
- [ ] **Step 2:** Change the query to fall back to a platform-default row when the per-tenant query returns null:
```ts
let { data: gwConfig, error } = await supabase
  .from('secret_payment_gateway_config')
  .select('id, tenant_id, secret_key, publishable_key, mode, webhook_secret')
  .eq('tenant_id', tenantId)
  .eq('provider', 'stripe')
  .eq('is_active', true)
  .maybeSingle();
// Fallback to platform-default gateway
if (!gwConfig) {
  ({ data: gwConfig, error } = await supabase
    .from('secret_payment_gateway_config')
    .select('id, tenant_id, secret_key, publishable_key, mode, webhook_secret')
    .eq('tenant_id', '00000000-0000-0000-0000-000000000000') // global platform tenant
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle());
}
if (!gwConfig) return new Response(JSON.stringify({ error: 'Gateway not configured' }), { status: 400, headers });
```
- [ ] **Step 3:** Add a platform gateway row to `supabase/seed.sql` (or a new migration `00097_platform_gateway.sql`) — but with placeholder values that operators must fill via env vars. Better: have the function read `STRIPE_SECRET_KEY` from Deno env as a final fallback.
- [ ] **Step 4:** Commit: `git add supabase/functions/create-checkout/index.ts && git commit -m "fix(checkout): platform-default Stripe gateway fallback (SUB1-001)"`

**Test:** `cd supabase/functions/create-checkout && deno test` (add a test mocking no per-tenant config → assert platform fallback used)

---

### Task 4 — Enforce Free plan 20-case limit + upgrade prompt

**Goal:** Free users hit a wall at case #20 and see an upgrade prompt at case #19.

**Files:**
- Create: `supabase/migrations/00098_case_quota_rpc.sql`
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/new/page.tsx`
- Modify: `apps/web/components/DashboardContent.tsx`

- [ ] **Step 1:** Create `supabase/migrations/00098_case_quota_rpc.sql`:
```sql
-- GATE2-001: Enforce Free plan 20-case limit at the DB level
CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE(allowed BOOLEAN, current_count BIGINT, max_cases INT, plan_slug TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan_id UUID; v_features JSONB;
BEGIN
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

-- Also add a BEFORE INSERT trigger that blocks over-quota case creation
CREATE OR REPLACE FUNCTION public.enforce_case_quota() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_allowed BOOLEAN; v_max INT;
BEGIN
  SELECT allowed, max_cases INTO v_allowed, v_max FROM public.check_case_quota(NEW.tenant_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Free plan limit reached (%)%. Upgrade to log more cases.', v_max;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_case_quota BEFORE INSERT ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_case_quota();
```

- [ ] **Step 2:** In `apps/web/app/(authenticated)/[tenant]/cases/new/page.tsx`, before rendering the form, call `supabase.rpc('check_case_quota', { p_tenant_id: tenantId })`. If `allowed=false`, render an upgrade card instead of the form.

- [ ] **Step 3:** In `apps/web/components/DashboardContent.tsx`, when `caseCount >= 18` and plan is Free, render a CTA card: "You're approaching your free limit — upgrade for unlimited cases."

- [ ] **Step 4:** Commit: `git add supabase/migrations/00098_case_quota_rpc.sql apps/web/app apps/web/components/DashboardContent.tsx && git commit -m "feat(billing): enforce Free 20-case limit + upgrade prompt (GATE2-001, GATE2-002)"`

**Test:** pgTAP test seeding 20 approved cases for a Free tenant → INSERT case #21 → assert RAISES EXCEPTION. `supabase db reset && supabase db test`.

---

### Task 5 — Add Stripe Customer Portal for cancel/manage

**Goal:** Users can cancel or manage their subscription (legally required in EU/UK/CA).

**Files:**
- Create: `supabase/functions/create-portal-session/index.ts`
- Modify: `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`

- [ ] **Step 1:** Create `supabase/functions/create-portal-session/index.ts` that:
  - Authenticates via `_shared/auth.ts`
  - Reads `return_url` from body
  - Looks up the tenant's `stripe_customer_id` from `subscriptions`
  - Calls `stripe.billingPortal.sessions.create({ customer, return_url })`
  - Returns `{ url: session.url }`
- [ ] **Step 2:** In `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`, when subscription is active, add a "Manage subscription" button that calls the edge function and redirects to the returned URL.
- [ ] **Step 3:** Commit: `git add supabase/functions/create-portal-session/ apps/web/app/(authenticated)/[tenant]/billing/page.tsx && git commit -m "feat(billing): Stripe Customer Portal for cancel/manage (SUB1-004)"`

---

### Task 6 — Handle missing Stripe webhook events

**Goal:** Webhook handles `subscription.updated`, `invoice.payment_failed`, `subscription.trial_will_end`.

**Files:**
- Modify: `supabase/functions/payment-webhook/index.ts`

- [ ] **Step 1:** Read `supabase/functions/payment-webhook/index.ts` switch statement (around line 190).
- [ ] **Step 2:** Add cases:
  - `customer.subscription.updated`: upsert subscription with new `plan_id` + `status` from `stripeSub.items.data[0].price` mapped to plan
  - `invoice.payment_failed`: set `subscriptions.status = 'past_due'` where `gateway_subscription_id = stripeSub.id`
  - `customer.subscription.trial_will_end`: log a notification (optional)
- [ ] **Step 3:** Commit: `git add supabase/functions/payment-webhook/index.ts && git commit -m "fix(webhook): handle subscription.updated, payment_failed, trial_will_end (SUB1-002)"`

---

### Task 7 — Persist `stripe_customer_id` + populate `payments` table

**Goal:** Invoice history works; `payments` table is populated on `invoice.paid`.

**Files:**
- Modify: `supabase/functions/payment-webhook/index.ts`

- [ ] **Step 1:** In `checkout.session.completed` handler, read `session.customer` and write `stripe_customer_id` to the `subscriptions` upsert.
- [ ] **Step 2:** In `invoice.paid` handler, after updating `subscriptions`, insert a row into `payments`:
```ts
await supabase.from('payments').insert({
  tenant_id, amount: invoice.amount_paid, currency: invoice.currency,
  gateway_payment_intent_id: invoice.payment_intent, status: 'succeeded',
});
```
- [ ] **Step 3:** Commit: `git add supabase/functions/payment-webhook/index.ts && git commit -m "fix(webhook): persist stripe_customer_id + populate payments (SUB1-003, SUB1-005)"`

---

### Task 8 — Add platform-default AI key fallback

**Goal:** Individual Premium's AI feature works out of the box.

**Files:**
- Modify: `supabase/functions/ai-insights/index.ts`
- Modify: `supabase/functions/manifest.json` (add `OPENAI_API_KEY` to required secrets)

- [ ] **Step 1:** Read `supabase/functions/ai-insights/index.ts` around line 269 where it queries `secret_ai_config` per tenant.
- [ ] **Step 2:** Add a fallback: if no per-tenant config, read `PLATFORM_OPENAI_KEY` from `Deno.env.get('PLATFORM_OPENAI_KEY')`. If present, use it with provider='openai', model='gpt-4o-mini'. Also verify the tenant's plan has `features.ai = true` (plan gating, GATE2-003).
- [ ] **Step 3:** Commit: `git add supabase/functions/ai-insights/index.ts supabase/functions/manifest.json && git commit -m "feat(ai): platform-default OpenAI key fallback + plan gating (AI5-001, GATE2-003)"`

---

### Task 9 — Fix institution invite flow (server-side, sets tenant+role)

**Goal:** Institution admins can invite residents/supervisors who land in the right tenant with the right role.

**Files:**
- Create: `apps/web/app/api/[tenant]/admin/invite/route.ts`
- Modify: `apps/web/components/UserManager.tsx`

- [ ] **Step 1:** Create `apps/web/app/api/[tenant]/admin/invite/route.ts` that:
  - Verifies caller is `institution_admin` or `admin` for the tenant
  - Uses the service-role client to `auth.admin.createUser({ email, user_metadata: { full_name, specialty, tenant_id, role: inviteRole } })`
  - Inserts a `profiles` row with the tenant_id and role
  - Sends a password setup / magic link email
- [ ] **Step 2:** In `apps/web/components/UserManager.tsx`, change `handleInvite` to POST to `/api/[tenant]/admin/invite` instead of calling `supabase.auth.signInWithOtp` directly.
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/admin/invite/ apps/web/components/UserManager.tsx && git commit -m "fix(invite): server-side invite that sets tenant+role (INST10-001)"`

---

### Task 10 — Gate SSO/SCIM/webhooks/AI-config routes behind plan

**Goal:** SSO, SCIM, webhooks, and AI-config are Enterprise-only and return 503 for non-Enterprise.

**Files:**
- Modify: `apps/web/app/api/[tenant]/admin/sso/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/scim/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/webhooks/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/ai-config/route.ts`
- Modify: `apps/web/components/AdminTabPanel.tsx` (remove webhooks + AI-config tabs for v1)

- [ ] **Step 1:** In each of the 4 admin route files, add an early check at the top of the handler:
```ts
const { data: sub } = await supabase.from('subscriptions').select('plan_id').eq('tenant_id', profile.tenant_id).single();
const { data: plan } = await supabase.from('subscription_plans').select('features').eq('id', sub.plan_id).single();
if (!(plan.features as Record<string, unknown>).sso) return NextResponse.json({ error: 'Not available on your plan' }, { status: 503 });
```
(Use the appropriate feature key: `sso`, `scim`, `webhooks`, `ai_config`.)
- [ ] **Step 2:** In `apps/web/components/AdminTabPanel.tsx`, remove `webhooks` and `ai-config` from the `TABS` array for v1.
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/admin/ apps/web/components/AdminTabPanel.tsx && git commit -m "fix(plan-gating): gate SSO/SCIM/webhooks/ai-config behind Enterprise (HIDE9-001..004)"`

---

## Phase 2 — Security Blockers

### Task 11 — Remove demo credentials banner from production login

**Goal:** Login page doesn't advertise `password123!` in production.

**Files:**
- Modify: `apps/web/app/login/page.tsx` (lines 190-200)

- [ ] **Step 1:** Read `apps/web/app/login/page.tsx` around line 189-200 (the demo banner block).
- [ ] **Step 2:** Wrap the entire banner in: `{process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_SHOW_DEMO_BANNER === 'true' && (<>...</>)}`
- [ ] **Step 3:** Commit: `git add apps/web/app/login/page.tsx && git commit -m "fix(login): hide demo credentials banner in production (SEC2-006, UX2-005)"`

---

### Task 12 — Fix `ai-quality` PHI leak (add de-identification guard)

**Goal:** `ai-quality` edge function doesn't send PHI to external AI providers.

**Files:**
- Modify: `supabase/functions/ai-quality/index.ts` (lines 222-240, 279-292)

- [ ] **Step 1:** Read `supabase/functions/ai-quality/index.ts`.
- [ ] **Step 2:** Add `.eq('is_deidentified', true)` to the case query at line 222.
- [ ] **Step 3:** After fetching the case, add a guard: `if (!caseEntry.is_deidentified) return new Response(JSON.stringify({ error: 'Case must be deidentified' }), { status: 403, headers });`
- [ ] **Step 4:** In `callAiProvider`, before building `userPrompt`, scan `fieldValues` text for PHI patterns (MRN-like 6+ digit numbers, DOB date patterns) and abort with 403 if found.
- [ ] **Step 5:** Commit: `git add supabase/functions/ai-quality/index.ts && git commit -m "fix(ai-quality): add is_deidentified guard + PHI scan (SEC2-004, AI5-002)"`

---

### Task 13 — Fix `ai-gap-analysis` cross-tenant data access

**Goal:** `ai-gap-analysis` uses JWT-derived tenant_id, not body-supplied, and doesn't use service-role key.

**Files:**
- Modify: `supabase/functions/ai-gap-analysis/index.ts`

- [ ] **Step 1:** Read `supabase/functions/ai-gap-analysis/index.ts`.
- [ ] **Step 2:** Replace the service-role client creation (lines 27-29) with the `_shared/auth.ts` `authenticate()` helper (which uses the user's JWT + anon key so RLS applies).
- [ ] **Step 3:** Remove `tenant_id` from the request body destructuring (line 39). Use `tenantId` from `authenticate()`.
- [ ] **Step 4:** Replace `select('*')` with explicit column lists (no `field_values`, no `patient_mrn`).
- [ ] **Step 5:** Add a role check: caller must be a supervisor+ in the same tenant to view `resident_id`'s data.
- [ ] **Step 6:** Commit: `git add supabase/functions/ai-gap-analysis/index.ts && git commit -m "fix(ai-gap-analysis): use JWT tenant_id, drop service role (SEC2-005, AI5-003)"`

---

### Task 14 — Add SSRF protection to `ai-quality` edge function

**Goal:** `ai-quality` blocks private IP ranges and doesn't leak error bodies.

**Files:**
- Modify: `supabase/functions/ai-quality/index.ts`

- [ ] **Step 1:** Read `supabase/functions/ai-quality/index.ts`.
- [ ] **Step 2:** Import `isValidEndpoint` from `../_shared/auth.ts` (or duplicate the logic from `ai-insights/index.ts:53-90`).
- [ ] **Step 3:** Call `isValidEndpoint(endpoint_url)` before fetching for `azure` and `custom` providers. Return 400 if invalid.
- [ ] **Step 4:** In the catch block (around line 321), do NOT return `msg` to the caller. Return generic `'AI provider error'` and log `msg` server-side only.
- [ ] **Step 5:** Commit: `git add supabase/functions/ai-quality/index.ts && git commit -m "fix(ai-quality): SSRF protection + scrub error messages (SEC2-009)"`

---

### Task 15 — Wire secrets encryption RPCs in admin routes

**Goal:** `ai-config`, `payment-gateway`, `webhooks`, `sso` route handlers use the `store_*` RPCs instead of writing plaintext to encrypted columns.

**Files:**
- Modify: `apps/web/app/api/[tenant]/admin/ai-config/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/payment-gateway/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/webhooks/route.ts`
- Modify: `apps/web/app/api/[tenant]/admin/sso/route.ts`

- [ ] **Step 1:** In each route, replace direct `.insert()` / `.update()` calls with `adminClient.rpc('store_ai_config', { ... })` / `store_payment_gateway_secret` / `store_tenant_webhook` / `store_sso_config` (the RPCs already exist in migrations 00053, 00074, 00058).
- [ ] **Step 2:** Pass the plaintext key/secret as a parameter; the RPC handles `pgp_sym_encrypt`.
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/admin/ && git commit -m "fix(secrets): wire encryption RPCs in admin routes (SEC2-001, SEC2-002, SEC2-003)"`

---

### Task 16 — Enforce MFA AAL2 in middleware + auth callback

**Goal:** Directors/admins must complete MFA verification at session start.

**Files:**
- Modify: `apps/web/lib/supabase/middleware.ts`
- Modify: `apps/web/app/auth/callback/route.ts`

- [ ] **Step 1:** In `apps/web/lib/supabase/middleware.ts`, after `getUser()` returns a user, call `supabase.auth.getMfaIdentities()` (or check `session.user.aal`). If the user has verified MFA factors AND the session AAL is not `aal2`, redirect to `/mfa/verify?next=<original-path>`. Apply to `/[tenant]/admin/*` and `/api/[tenant]/admin/*` routes at minimum.
- [ ] **Step 2:** In `apps/web/app/auth/callback/route.ts`, after `exchangeCodeForSession`, check if the user's profile role is director/admin and if they have MFA enrolled. If so, redirect to `/mfa/verify` instead of `/dashboard`.
- [ ] **Step 3:** Commit: `git add apps/web/lib/supabase/middleware.ts apps/web/app/auth/callback/route.ts && git commit -m "fix(mfa): enforce AAL2 in middleware + callback (SEC2-008, SEC2-010)"`

---

### Task 17 — Add `field_values` PHI scan trigger

**Goal:** DB trigger catches PHI in `field_values` even when `is_deidentified=true`.

**Files:**
- Create: `supabase/migrations/00099_field_values_phi_scan.sql`

- [ ] **Step 1:** Create `supabase/migrations/00099_field_values_phi_scan.sql`:
```sql
-- SEC2-007: Catch PHI in field_values even when is_deidentified=true
CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  -- Patterns: 6+ digit numbers (MRN-like), DOB date patterns
  IF NEW.is_deidentified = true AND (
    v_text ~ '\m\d{6,}\m' OR  -- 6+ digit MRN-like
    v_text ~ '\d{4}-\d{2}-\d{2}' OR  -- ISO date
    v_text ~ '\d{2}/\d{2}/\d{4}'  -- slash date
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_scan_field_values_phi BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
```
- [ ] **Step 2:** Commit: `git add supabase/migrations/00099_field_values_phi_scan.sql && git commit -m "fix(security): DB trigger scans field_values for PHI (SEC2-007)"`

**Test:** pgTAP: INSERT with `is_deidentified=true` and `field_values='{"notes":"MRN 123456"}'::jsonb` → assert RAISES EXCEPTION.

---

### Task 18 — Add body size limits + audit logging to admin routes

**Goal:** Admin POST routes reject >64KB bodies and write audit log entries.

**Files:**
- Modify all `apps/web/app/api/[tenant]/admin/*/route.ts` files

- [ ] **Step 1:** In each admin POST/PUT handler, add at the top:
```ts
const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
if (contentLength > 64 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });
```
- [ ] **Step 2:** After every successful mutation, insert an audit log row:
```ts
await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'sso_config_create', resource_type: 'sso_config', resource_id: newConfig.id, changes: { ...sanitizedChanges } });
```
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/admin/ && git commit -m "harden(admin): body size limits + audit logging (SEC2-012, SEC2-013)"`

---

## Phase 3 — Performance (30-Second Goal)

These tasks fix the slowest paths. The case-creation flow is the #1 priority.

### Task 19 — Fix CaseForm: search + limit templates + RPC for counts

**Goal:** CaseForm loads in <500ms instead of 3-5s.

**Files:**
- Modify: `apps/web/components/CaseForm.tsx` (lines 92-131)
- Modify: `apps/web/components/case-form/TemplateStep.tsx`
- Create: `supabase/migrations/00100_template_usage_rpc.sql`

- [ ] **Step 1:** Create `supabase/migrations/00100_template_usage_rpc.sql`:
```sql
CREATE OR REPLACE FUNCTION public.get_template_usage_counts(p_tenant_id UUID, p_resident_id UUID)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ct.id, COUNT(ce) FILTER (WHERE ce.resident_id = p_resident_id), COUNT(ce)
  FROM case_templates ct
  LEFT JOIN case_entries ce ON ce.template_id = ct.id AND ce.deleted_at IS NULL
  WHERE ct.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY ct.id;
$$;
```
- [ ] **Step 2:** In `CaseForm.tsx`, replace the 4 parallel queries (lines 92-131) with:
  - `supabase.rpc('get_template_usage_counts', { p_tenant_id, p_resident_id })` for counts
  - `supabase.from('case_templates').select('id, name, specialty').ilike('name', `%${q}%`).limit(30)` for templates (with search + limit)
- [ ] **Step 3:** In `TemplateStep.tsx`, add a search input at the top that updates `q` state on debounce (200ms). Re-query when `q` changes.
- [ ] **Step 4:** Commit: `git add supabase/migrations/00100_template_usage_rpc.sql apps/web/components/CaseForm.tsx apps/web/components/case-form/TemplateStep.tsx && git commit -m "perf(case-form): search+limit templates + RPC counts (PERF2-001, PERF2-002)"`

**Test:** Vitest mocking Supabase to return 100 templates, render `<TemplateStep>`, type "append", assert only matching templates render and `.limit(30)` was called.

---

### Task 20 — Fix load-all-then-count anti-patterns (5 pages)

**Goal:** Admin, compliance, analytics, dashboard, reports pages use SQL aggregation instead of loading all rows.

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/compliance/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/analytics/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`

- [ ] **Step 1:** In each file, replace `.select('status').eq(...)` followed by `.filter(...).length` with `head: true` count queries:
```ts
const [{ count: total }, { count: pending }] = await Promise.all([
  supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  supabase.from('case_entries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'pending'),
]);
```
- [ ] **Step 2:** For the compliance page audit aggregation, use the existing `get_case_stats` RPC (migration `00003_triggers.sql:185`) or add a `get_audit_summary` RPC.
- [ ] **Step 3:** Commit: `git add apps/web/app/ && git commit -m "perf: replace load-all-then-count with SQL aggregation (PERF2-003..007)"`

---

### Task 21 — Fix export-pdf unbounded query

**Goal:** PDF export doesn't load ALL approved case IDs.

**Files:**
- Modify: `apps/web/app/api/[tenant]/export-pdf/route.ts`

- [ ] **Step 1:** Read `apps/web/app/api/[tenant]/export-pdf/route.ts` line 39-45.
- [ ] **Step 2:** Add `.limit(100)` to the query (matching the edge function's `MAX_CASE_IDS`).
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/export-pdf/route.ts && git commit -m "perf(export-pdf): limit to 100 cases (PERF2-008)"`

---

### Task 22 — Fix `recalc_goal_progress` trigger (N+1 → set-based)

**Goal:** Case insert doesn't do 10 COUNT(*) per goal.

**Files:**
- Create: `supabase/migrations/00101_set_based_goal_recalc.sql`

- [ ] **Step 1:** Create `supabase/migrations/00101_set_based_goal_recalc.sql` that replaces the `recalc_goal_progress` function (migration `00003_triggers.sql:133-175`) with a single set-based upsert:
```sql
CREATE OR REPLACE FUNCTION public.recalc_goal_progress() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_resident_id UUID := NEW.resident_id; v_tenant_id UUID := NEW.tenant_id;
BEGIN
  INSERT INTO goal_progress (goal_id, resident_id, current_count, last_updated)
  SELECT pg.id, v_resident_id, COUNT(ce.id), NOW()
  FROM program_goals pg
  LEFT JOIN case_entries ce ON ce.resident_id = pg.resident_id
    AND ce.tenant_id = v_tenant_id
    AND ce.status = 'approved'
    AND (pg.specialty IS NULL OR ce.template_id IN (SELECT id FROM case_templates WHERE specialty = pg.specialty AND tenant_id = v_tenant_id))
  WHERE pg.resident_id = v_resident_id AND pg.tenant_id = v_tenant_id
  GROUP BY pg.id
  ON CONFLICT (goal_id) DO UPDATE SET current_count = EXCLUDED.current_count, last_updated = NOW();
  RETURN NEW;
END $$;
```
- [ ] **Step 2:** Commit: `git add supabase/migrations/00101_set_based_goal_recalc.sql && git commit -m "perf: set-based recalc_goal_progress trigger (PERF2-018)"`

---

### Task 23 — Fix billing page: parallelize + column lists

**Goal:** Billing page loads in 1 round-trip, not 6.

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/billing/page.tsx`

- [ ] **Step 1:** Read `apps/web/app/(authenticated)/[tenant]/billing/page.tsx` lines 20-69.
- [ ] **Step 2:** Wrap all 6 queries in `Promise.all([ ... ])`.
- [ ] **Step 3:** Replace `select('*')` with explicit column lists. For `payment_gateway_config`, select only `provider, publishable_key` (never `*`).
- [ ] **Step 4:** Commit: `git add apps/web/app/(authenticated)/[tenant]/billing/page.tsx && git commit -m "perf(billing): parallelize queries + explicit columns (PERF2-010)"`

---

### Task 24 — Fix ApprovalsDashboard: limit + drop field_values + embedded relation

**Goal:** Approvals list doesn't load ALL pending + heavy JSONB.

**Files:**
- Modify: `apps/web/components/approvals/ApprovalsDashboard.tsx`
- Delete: `apps/web/components/approvals/useApprovalsData.ts` (duplicate)

- [ ] **Step 1:** Add `.limit(50)` to the pending query.
- [ ] **Step 2:** Drop `field_values` from the select — fetch it lazily when an approval is expanded.
- [ ] **Step 3:** Use the embedded relation `approval_requests!inner(...)` to avoid the second round-trip.
- [ ] **Step 4:** Delete `useApprovalsData.ts` (it duplicates `ApprovalsDashboard` logic).
- [ ] **Step 5:** Commit: `git add apps/web/components/approvals/ && git commit -m "perf(approvals): limit 50 + drop field_values + embedded relation (PERF2-011)"`

---

### Task 25 — Add missing indexes

**Goal:** Critical queries are indexed.

**Files:**
- Create: `supabase/migrations/00102_missing_indexes.sql`

- [ ] **Step 1:** Create `supabase/migrations/00102_missing_indexes.sql`:
```sql
CREATE INDEX IF NOT EXISTS idx_case_entries_deidentified ON case_entries(tenant_id) WHERE is_deidentified = true;
CREATE INDEX IF NOT EXISTS idx_case_entries_resident_status_active ON case_entries(resident_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_case_templates_tenant_specialty ON case_templates(tenant_id, specialty);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action);
```
- [ ] **Step 2:** Commit: `git add supabase/migrations/00102_missing_indexes.sql && git commit -m "perf: add missing indexes (PERF2-025, PERF2-026, PERF2-030)"`

---

### Task 26 — Stream CSV export (don't build 5MB string in memory)

**Goal:** CSV exports stream row-by-row instead of building a giant string.

**Files:**
- Modify: `apps/web/app/api/[tenant]/audit/export/route.ts` (`toCsv` function)
- Modify: `apps/web/app/(authenticated)/[tenant]/audit/csv/route.ts` (if exists)

- [ ] **Step 1:** Replace `toCsv(rows)` with a `ReadableStream` that emits CSV chunks:
```ts
return new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(headers.join(',') + '\n'));
    for (const r of rows) {
      controller.enqueue(encoder.encode(rowToCsv(r) + '\n'));
    }
    controller.close();
  }
}), { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` } });
```
- [ ] **Step 2:** Commit: `git add apps/web/app/api/[tenant]/audit/export/route.ts && git commit -m "perf(csv): stream export instead of building in memory (PERF2-015)"`

---

## Phase 4 — Web UI/UX & Conversion

### Task 27 — Fix EmptyState invisible text (1.04:1 contrast)

**Goal:** Empty state titles are readable.

**Files:**
- Modify: `apps/web/components/EmptyState.tsx`

- [ ] **Step 1:** Read `apps/web/components/EmptyState.tsx` lines 27, 29.
- [ ] **Step 2:** Replace `text-neutral-light/70` → `text-text-primary`, `text-neutral-light/50` → `text-text-secondary`.
- [ ] **Step 3:** Replace `hover:bg-primary/90` → `hover:bg-primary-hover`.
- [ ] **Step 4:** Commit: `git add apps/web/components/EmptyState.tsx && git commit -m "fix(empty-state): use readable text tokens (UX2-022)"`

---

### Task 28 — Make de-identification the default in CaseForm

**Goal:** `isDeidentified` defaults to `true` (HIPAA-safe default).

**Files:**
- Modify: `apps/web/components/CaseForm.tsx` (line 66)

- [ ] **Step 1:** Change `const [isDeidentified, setIsDeidentified] = useState(false);` → `useState(true);`
- [ ] **Step 2:** Add a confirmation prompt when switching from de-identified → PII: "You're about to store patient PHI. Continue?"
- [ ] **Step 3:** Commit: `git add apps/web/components/CaseForm.tsx && git commit -m "fix(case-form): default to de-identified mode (UX2-009)"`

---

### Task 29 — Replace emoji specialty icons with SVG

**Goal:** No 🔪🔬⚡ in the medical UI.

**Files:**
- Modify: `apps/web/components/case-form/TemplateStep.tsx` (lines 13-24)

- [ ] **Step 1:** Replace the `SPECIALTY_ICONS` emoji map with a uniform clipboard SVG icon (or two-letter monograms: SU, RA, EM, etc.).
- [ ] **Step 2:** Add `aria-hidden="true"` to any decorative SVG.
- [ ] **Step 3:** Commit: `git add apps/web/components/case-form/TemplateStep.tsx && git commit -m "fix(ui): replace emoji icons with SVG (UX2-010)"`

---

### Task 30 — Add case list search + filter

**Goal:** Users can search and filter the case list.

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/page.tsx`

- [ ] **Step 1:** Add a filter bar above the case table:
  - Search input (filters by `case_templates.name` ilike)
  - Status filter (multi-select: draft/pending/approved/rejected)
  - Sort dropdown (date / template / status)
- [ ] **Step 2:** Use URL search params (`?search=&status=&sort=`) so filters are shareable and back-button friendly.
- [ ] **Step 3:** Commit: `git add apps/web/app/(authenticated)/[tenant]/cases/page.tsx && git commit -m "feat(cases): search + filter + sort (UX2-017)"`

---

### Task 31 — Mask PHI on case detail + add "Reveal" button

**Goal:** MRN/DOB are masked by default; revealing is audit-logged.

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`

- [ ] **Step 1:** Mask `patient_mrn` and `patient_dob` by default (show last 4 digits only: `***-**-1234`).
- [ ] **Step 2:** Add a "Reveal" button that requires an explicit click.
- [ ] **Step 3:** On reveal, insert an audit log entry: `{ action: 'phi_view', resource_type: 'case_entry', resource_id: entryId }`.
- [ ] **Step 4:** Commit: `git add apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx && git commit -m "fix(case-detail): mask PHI + audit-logged reveal (UX2-018)"`

---

### Task 32 — Fix ErrorBoundary colors + deduplicate error.tsx files

**Goal:** Error states are readable in both light and dark mode.

**Files:**
- Modify: `apps/web/components/ErrorBoundary.tsx`
- Create: `apps/web/components/ErrorFallback.tsx` (shared)
- Modify: all `error.tsx` files to use the shared component

- [ ] **Step 1:** Replace all inline styles in `ErrorBoundary.tsx` with Tailwind classes using tokens (`bg-surface-solid`, `text-text-primary`, `text-danger`).
- [ ] **Step 2:** Create `apps/web/components/ErrorFallback.tsx` accepting `{ title, description }` props, using tokens throughout.
- [ ] **Step 3:** Replace each `error.tsx` file (10+ files) with a 5-line wrapper that calls `<ErrorFallback title="..." description="..." />`.
- [ ] **Step 4:** Commit: `git add apps/web/components/ErrorBoundary.tsx apps/web/components/ErrorFallback.tsx apps/web/app/ && git commit -m "fix(error-states): use tokens + deduplicate (UX2-026, UX2-027)"`

---

### Task 33 — Fix loading skeletons hardcoded colors

**Goal:** Loading states use tokens, work in dark mode.

**Files:**
- Modify: all `loading.tsx` files in `apps/web/app/`

- [ ] **Step 1:** Run: `rg "rgba\(60, 60, 67|rgba\(255, 255, 255" apps/web/app/` to find all hardcoded loading colors.
- [ ] **Step 2:** Replace `style={{ backgroundColor: 'rgba(60, 60, 67, 0.08)' }}` with `className="bg-default-200 animate-pulse"`.
- [ ] **Step 3:** Replace `style={{ backgroundColor: 'rgba(255, 255, 255, 0.72)' }}` with `className="bg-surface border border-border"`.
- [ ] **Step 4:** Commit: `git add apps/web/app/ && git commit -m "fix(loading): use tokens for dark mode (UX2-028)"`

---

### Task 34 — Replace hardcoded colors across 30 files (codemod)

**Goal:** All authenticated pages use design tokens.

**Files:**
- Modify: ~30 files in `apps/web/app/` and `apps/web/components/`

- [ ] **Step 1:** Run to find all hardcoded colors: `rg "text-black|bg-white|text-\[#|bg-\[#|border-black|bg-black" apps/web/app apps/web/components`
- [ ] **Step 2:** For each file, use `replaceAll: true` in the Edit tool:
  - `text-black` → `text-text-primary`
  - `bg-white` → `bg-surface-solid`
  - `bg-[#F2F2F7]` → `bg-backdrop`
  - `text-[#3C3C43]` → `text-text-secondary`
  - `text-[#8E8E93]` → `text-text-muted`
  - `border-black/5` → `border-border`
  - `bg-black/5 dark:bg-white/5` → `bg-surface-raised`
- [ ] **Step 3:** Commit per-file or in batches: `git add -A && git commit -m "fix(theme): replace hardcoded colors with tokens (UX2-031)"`

---

### Task 35 — Fix login password toggle `tabIndex={-1}`

**Goal:** Keyboard users can toggle password visibility.

**Files:**
- Modify: `apps/web/app/login/page.tsx` (line 234)

- [ ] **Step 1:** Remove `tabIndex={-1}` from the password visibility toggle button.
- [ ] **Step 2:** Commit: `git add apps/web/app/login/page.tsx && git commit -m "fix(a11y): remove tabIndex=-1 from password toggle (UX2-033)"`

---

### Task 36 — Replace `<div onClick>` with `<button>`

**Goal:** All interactive elements are keyboard-focusable.

**Files:**
- Modify: `apps/web/components/GoalForm.tsx` (2 instances)
- Modify: `apps/web/components/TemplateEditor.tsx` (2 instances)
- Modify: `apps/web/components/UserManager.tsx` (2 instances)

- [ ] **Step 1:** Replace each `<div onClick={...}>` with `<button type="button" onClick={...}>`.
- [ ] **Step 2:** Commit: `git add apps/web/components/GoalForm.tsx apps/web/components/TemplateEditor.tsx apps/web/components/UserManager.tsx && git commit -m "fix(a11y): replace div onClick with button (UX2-034)"`

---

### Task 37 — Add `<label htmlFor>` associations

**Goal:** 78% of labels lack `htmlFor` — fix to `<dl><dt><dd>` or add `htmlFor`.

**Files:**
- Modify: all files with `<label>` elements lacking `htmlFor` (run `rg "<label" apps/web/`)

- [ ] **Step 1:** For label/value pairs (read-only displays like case detail), replace `<label>...<p>` with `<dl><dt>...</dt><dd>...</dd></dl>`.
- [ ] **Step 2:** For actual form labels, add `htmlFor="inputId"` and `id="inputId"` to the input.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "fix(a11y): label associations (UX2-035)"`

---

### Task 38 — Wire notifications end-to-end (or hide the bell)

**Goal:** Either notifications work, or the bell is hidden for v1.

**Files:**
- Modify: `apps/web/app/api/[tenant]/approvals/action/route.ts`
- Modify: `apps/web/components/NotificationBell.tsx`
- OR: Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx` (hide the bell)

- [ ] **Step 1:** Fix the schema mismatch in `NotificationBell.tsx`: change `read` → `read_at IS NULL` for unread, `data` → `link` for the URL.
- [ ] **Step 2:** In `approvals/action/route.ts`, after approving/rejecting, insert a notification:
```ts
await adminClient.from('notifications').insert({ tenant_id, user_id: caseEntry.resident_id, type: 'approval', title: `Case ${approved ? 'approved' : 'rejected'}`, body: comment, link: `/${tenantSlug}/cases/${caseEntryId}` });
```
- [ ] **Step 3:** If you can't wire email/push for v1, hide the bell in the layout and add a TODO.
- [ ] **Step 4:** Commit: `git add apps/web/app/api/[tenant]/approvals/action/route.ts apps/web/components/NotificationBell.tsx && git commit -m "fix(notifications): wire schema + approval notifications (APP3-001, APP3-002)"`

---

### Task 39 — Fix the audit "PDF" export (returns HTML, not PDF)

**Goal:** Audit export produces a real PDF or is honestly labeled.

**Files:**
- Modify: `apps/web/app/api/[tenant]/audit/export/route.ts`

- [ ] **Step 1:** Stop routing audit data through the case-PDF edge function (it filters by `status='approved'` which audit logs aren't).
- [ ] **Step 2:** Either (a) use `pdf-lib` to render a real PDF server-side, or (b) rename the endpoint to "Export as HTML" honestly and update the UI label.
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/audit/export/route.ts && git commit -m "fix(audit-export): honest format label or real PDF (EXP4-001)"`

---

## Phase 5 — DevOps & Deployment

### Task 40 — Delete duplicate CD pipeline

**Goal:** One web-deploy workflow, not two racing.

**Files:**
- Delete: `.github/workflows/deploy-web.yml` (or delete the web job in `cd.yml`)

- [ ] **Step 1:** Read both `.github/workflows/cd.yml` and `.github/workflows/deploy-web.yml`.
- [ ] **Step 2:** Delete `deploy-web.yml` (keep the `cd.yml` web job which has more complete config).
- [ ] **Step 3:** Commit: `git rm .github/workflows/deploy-web.yml && git commit -m "fix(cd): delete duplicate web deploy workflow (CD-001)"`

---

### Task 41 — Fix CD pipeline ordering (web depends on db)

**Goal:** Web deploys AFTER migrations apply.

**Files:**
- Modify: `.github/workflows/cd.yml`

- [ ] **Step 1:** Add `needs: [db]` to the `web` job in `cd.yml`.
- [ ] **Step 2:** Commit: `git add .github/workflows/cd.yml && git commit -m "fix(cd): web job depends on db job (CD-002)"`

---

### Task 42 — Deploy all 11 edge functions

**Goal:** All edge functions in the manifest are deployed.

**Files:**
- Modify: `.github/workflows/cd.yml`

- [ ] **Step 1:** Read `supabase/functions/manifest.json` to get the list of all 11 functions.
- [ ] **Step 2:** Expand the matrix in `cd.yml` to include: `ai-insights, ai-quality, ai-gap-analysis, generate-pdf, create-checkout, payment-webhook, create-portal-session, list-invoices, webads-export`. Skip `sso-callback` (disabled), `scim` (hidden), `dispatch-webhook` (disabled) for v1.
- [ ] **Step 3:** Commit: `git add .github/workflows/cd.yml && git commit -m "fix(cd): deploy all 11 edge functions (CD-003)"`

---

### Task 43 — Remove `--include-all` from `supabase db push`

**Goal:** Migrations don't re-run destructively.

**Files:**
- Modify: `.github/workflows/cd.yml`

- [ ] **Step 1:** Change `supabase db push --db-url ${{ secrets.SUPABASE_DB_URL }} --include-all` to `supabase db push --db-url ${{ secrets.SUPABASE_DB_URL }}`.
- [ ] **Step 2:** Commit: `git add .github/workflows/cd.yml && git commit -m "fix(cd): remove --include-all from db push (CD-004)"`

---

### Task 44 — Fix Dockerfile standalone build

**Goal:** Docker build succeeds (the container scan can run).

**Files:**
- Modify: `Dockerfile.web`

- [ ] **Step 1:** Add `ENV NEXT_OUTPUT=standalone` before the build step in `Dockerfile.web`.
- [ ] **Step 2:** Commit: `git add Dockerfile.web && git commit -m "fix(docker): set NEXT_OUTPUT=standalone (VR-001)"`

---

### Task 45 — Strip hardcoded Supabase credentials from tracked files

**Goal:** No prod Supabase URL/key in committed source.

**Files:**
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/eas.json`
- Modify: `opencode.json`

- [ ] **Step 1:** Remove the hardcoded `supabaseUrl` and `supabaseAnonKey` values from `app.json`, `eas.json`, `opencode.json`.
- [ ] **Step 2:** Set them via EAS secrets: `eas env:create EXPO_PUBLIC_SUPABASE_URL --value=...` and `eas env:create EXPO_PUBLIC_SUPABASE_ANON_KEY --value=...`.
- [ ] **Step 3:** Read them in code via `Constants.expoConfig.extra` or `process.env.EXPO_PUBLIC_SUPABASE_URL`.
- [ ] **Step 4:** Commit: `git add apps/mobile/app.json apps/mobile/eas.json opencode.json && git commit -m "fix(secrets): strip hardcoded Supabase creds (ENV-001, SEC-001)"`

---

### Task 46 — Fix EAS project ID + owner mismatch

**Goal:** `eas build` doesn't fail with "Project ID mismatch".

**Files:**
- Modify: `apps/mobile/app.json`

- [ ] **Step 1:** Run `cd apps/mobile && eas init` to get the actual project ID.
- [ ] **Step 2:** Update `app.json:97` with the correct `projectId`.
- [ ] **Step 3:** Update `owner` to match the Expo account that owns the project.
- [ ] **Step 4:** Commit: `git add apps/mobile/app.json && git commit -m "fix(eas): reconcile project ID + owner (ENV-002, MOB-004)"`

---

### Task 47 — Implement real health endpoint

**Goal:** `/api/health` pings the DB and returns 503 if unhealthy.

**Files:**
- Modify: `apps/web/app/api/health/route.ts`

- [ ] **Step 1:** Replace the stub with a real check:
```ts
export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('tenants').select('id').limit(1).single();
    if (error) return NextResponse.json({ status: 'unhealthy', db: 'error' }, { status: 503 });
    return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ status: 'unhealthy', error: 'unreachable' }, { status: 503 });
  }
}
```
- [ ] **Step 2:** Commit: `git add apps/web/app/api/health/route.ts && git commit -m "fix(health): real DB-ping health endpoint (MON-001)"`

---

### Task 48 — Configure branch protection on main

**Goal:** Required status checks prevent merging broken PRs.

- [ ] **Step 1:** Run: `gh api -X PUT repos/mahmoudmahdy077/elogbook/branches/main/protection -f required_status_checks[strict]=true -f required_status_checks[contexts][]=typecheck -f required_status_checks[contexts][]=lint -f required_status_checks[contexts][]=test -f required_status_checks[contexts][]=migration-lint -f required_status_checks[contexts][]=build-web -f enforce_admins=true -f required_pull_request_reviews[required_approving_review_count]=1`
- [ ] **Step 2:** Verify: `gh api repos/mahmoudmahdy077/elogbook/branches/main/protection`

---

### Task 49 — Schedule automated backups

**Goal:** Backups run daily via GitHub Actions.

**Files:**
- Create: `.github/workflows/backup.yml`

- [ ] **Step 1:** Create `.github/workflows/backup.yml`:
```yaml
name: Backup DB
on:
  schedule: [{ cron: '0 3 * * *' }]
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/backup-db.sh
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
      - uses: azure/upload-to-blob-action@v2
        with:
          connection_string: ${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
          container_name: elogbook-backups
```
- [ ] **Step 2:** Fix the GNU-only `date` and `stat` flags in `scripts/backup-db.sh` to be cross-platform (or just ensure it runs on `ubuntu-latest`).
- [ ] **Step 3:** Commit: `git add .github/workflows/backup.yml scripts/backup-db.sh && git commit -m "fix(backup): schedule daily backups via GHA (DR-001, DR-002)"`

---

### Task 50 — Create `supabase/config.toml` (project linking)

**Goal:** Supabase project is linked via tracked config.

**Files:**
- Create: `supabase/config.toml`

- [ ] **Step 1:** Run: `cd supabase && supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` (locally with the real ref).
- [ ] **Step 2:** Commit the resulting `supabase/config.toml`.
- [ ] **Step 3:** Commit: `git add supabase/config.toml && git commit -m "fix(supabase): track project linking config (SB-001)"`

---

## Phase 6 — Mobile TestFlight Readiness

### Task 51 — Remove dead `getDatabase()` calls from mobile screens

**Goal:** No mobile screen crashes on `OfflineStorageDisabledError`.

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (dashboard)
- Modify: `apps/mobile/app/(tabs)/my-cases.tsx`
- Modify: `apps/mobile/app/(tabs)/case-detail.tsx`
- Modify: `apps/mobile/app/(tabs)/log-case.tsx` (edit path)
- Modify: `apps/mobile/app/(tabs)/profile.tsx` (sign-out)
- Modify: `apps/mobile/lib/today-stats.ts`
- Modify: `apps/mobile/lib/sync.ts` (`getConflictDrafts`)

- [ ] **Step 1:** In each file, find and remove `getDatabase()` / `getAllCasesForResident` / `upsertCaseEntry` / `saveDraftCase` / `getConflictedCases` / `updateSyncStatus` calls. Replace with Supabase queries or no-ops.
- [ ] **Step 2:** In `sync.ts`, make `getConflictDrafts()` return `[]`.
- [ ] **Step 3:** Run: `pnpm --filter @elogbook/mobile test`
- [ ] **Step 4:** Commit: `git add apps/mobile/ && git commit -m "fix(mobile): remove dead DB calls from screens (MOB2-001..005, MOB2-012, MOB2-013)"`

---

### Task 52 — Mount SideMenuProvider + SideMenu

**Goal:** The ellipsis menu button works on every screen.

**Files:**
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`

- [ ] **Step 1:** Wrap the tab layout content in `<SideMenuProvider>` and render `<SideMenu>` inside it.
- [ ] **Step 2:** Pull `role` and `fullName` from `getRoleFromAuth()` / the user's profile.
- [ ] **Step 3:** Commit: `git add apps/mobile/app/(tabs)/_layout.tsx && git commit -m "fix(mobile): mount SideMenuProvider + SideMenu (MOB2-008)"`

---

### Task 53 — Generate real app icons

**Goal:** Icons are 1024×1024, not 1×1 placeholders.

**Files:**
- Replace: `apps/mobile/assets/icon.png`
- Replace: `apps/mobile/assets/splash.png`
- Replace: `apps/mobile/assets/adaptive-icon.png`

- [ ] **Step 1:** Generate 1024×1024 PNG icons (use a design tool, Figma, or `expo-optimize`).
- [ ] **Step 2:** Replace the 3 placeholder files.
- [ ] **Step 3:** Verify: file size > 1KB each.
- [ ] **Step 4:** Commit: `git add apps/mobile/assets/ && git commit -m "fix(mobile): real app icons (MOB2-006)"`

---

### Task 54 — Remove or create `network_security_config.xml`

**Goal:** Android build doesn't fail on missing file.

**Files:**
- Modify: `apps/mobile/app.json` (remove the reference) OR create the file

- [ ] **Step 1:** Either create `apps/mobile/android/app/src/main/res/xml/network_security_config.xml` with proper pin-set, OR remove the `networkSecurityConfig` line from `app.json`.
- [ ] **Step 2:** Commit: `git add apps/mobile/app.json && git commit -m "fix(mobile): resolve network_security_config.xml (MOB2-007)"`

---

### Task 55 — Configure Sentry DSN for mobile

**Goal:** Mobile crashes are reported.

**Files:**
- Modify: `apps/mobile/eas.json` (add `EXPO_PUBLIC_SENTRY_DSN` env)
- Modify: `apps/mobile/app.json` (set `sentryDsn`)

- [ ] **Step 1:** Create a Sentry project for mobile.
- [ ] **Step 2:** Set `EXPO_PUBLIC_SENTRY_DSN` in all EAS profiles in `eas.json`.
- [ ] **Step 3:** Set `sentryDsn` in `app.json` for non-EAS local dev.
- [ ] **Step 4:** Commit: `git add apps/mobile/eas.json apps/mobile/app.json && git commit -m "fix(mobile): configure Sentry DSN (MOB2-009)"`

---

### Task 56 — Add `useFocusEffect` to tab screens

**Goal:** Screens refresh data when returning to a tab.

**Files:**
- Modify: all tab screens in `apps/mobile/app/(tabs)/`

- [ ] **Step 1:** Replace `useEffect(() => { loadData(); }, [])` with `useFocusEffect(useCallback(() => { loadData(); }, [loadData]))` from `expo-router`.
- [ ] **Step 2:** Commit: `git add apps/mobile/app/ && git commit -m "fix(mobile): useFocusEffect for tab refresh (MOB2-015)"`

---

## Phase 7 — Test Coverage & CI Gates

### Task 57 — Run e2e, pgTAP, and Deno tests in CI

**Goal:** All existing tests actually run on every PR.

**Files:**
- Modify: `.github/workflows/ci.yml` (add e2e + db + deno jobs)
- Create: `.github/workflows/e2e.yml`
- Create: `.github/workflows/db-tests.yml`

- [ ] **Step 1:** Add a `db-tests` job to `ci.yml` that runs `supabase db reset && supabase db test`.
- [ ] **Step 2:** Create `.github/workflows/e2e.yml` that runs `pnpm --filter @elogbook/web test:e2e` on PRs.
- [ ] **Step 3:** Add a `deno-test` job that runs `cd supabase/functions/payment-webhook && deno test`.
- [ ] **Step 4:** Commit: `git add .github/workflows/ && git commit -m "ci: run e2e + pgTAP + deno tests in CI (TEST2-011)"`

---

### Task 58 — Fix the `logger.test.ts` process.pid test

**Goal:** No known-failing tests in the suite.

**Files:**
- Modify: `apps/web/lib/__tests__/logger.test.ts` (line 232)

- [ ] **Step 1:** The test asserts `parsed.pid` is a number, but in jsdom `window` is defined so the logger omits `pid`. Fix: either skip the assertion in jsdom (`it.skipIf(typeof window !== 'undefined', ...)`) or have the logger fall back to `process.pid ?? 0` when `window` is defined.
- [ ] **Step 2:** Run: `pnpm --filter @elogbook/web test -- logger`
- [ ] **Step 3:** Commit: `git add apps/web/lib/__tests__/logger.test.ts && git commit -m "fix(test): resolve logger process.pid test (TEST2-pre-existing)"`

---

### Task 59 — Add subscription lifecycle test

**Goal:** End-to-end billing test: signup → checkout → webhook → active → lapse → cutoff.

**Files:**
- Create: `supabase/functions/payment-webhook/lifecycle.test.ts`

- [ ] **Step 1:** Write a Deno test that:
  - Mocks a `checkout.session.completed` event → asserts `subscriptions.status='active'`
  - Mocks `customer.subscription.deleted` → asserts `subscriptions.status='canceled'`
  - Asserts the lapsed-tenant write guard blocks new case creation
- [ ] **Step 2:** Commit: `git add supabase/functions/payment-webhook/lifecycle.test.ts && git commit -m "test(billing): subscription lifecycle (TEST2-001)"`

---

### Task 60 — Add cross-tenant WRITE isolation test

**Goal:** RLS blocks cross-tenant INSERT/UPDATE/DELETE.

**Files:**
- Create: `supabase/tests/p1_1b_cross_tenant_write_isolation.sql`

- [ ] **Step 1:** Write a pgTAP test that:
  - Sets JWT to tenant A's resident
  - Attempts `INSERT INTO case_entries (tenant_id='tenantB', ...)` → asserts RLS violation
  - Attempts `UPDATE case_entries SET ... WHERE tenant_id='tenantB'` → asserts 0 rows affected
- [ ] **Step 2:** Commit: `git add supabase/tests/p1_1b_cross_tenant_write_isolation.sql && git commit -m "test(rls): cross-tenant WRITE isolation (TEST2-003)"`

---

### Task 61 — Add admin endpoint role-gating tests

**Goal:** Every admin endpoint returns 403 for residents.

**Files:**
- Create: `apps/web/app/api/[tenant]/admin/__tests__/role-gating.test.ts`

- [ ] **Step 1:** Write a parameterized Vitest that mocks a resident user and hits each admin endpoint (`sso`, `scim`, `webhooks`, `ai-config`, `payment-gateway`, `assign-role`, `invite`) → asserts 403.
- [ ] **Step 2:** Repeat with `institution_admin` → asserts 200/403 as appropriate.
- [ ] **Step 3:** Commit: `git add apps/web/app/api/[tenant]/admin/__tests__/role-gating.test.ts && git commit -m "test(admin): role gating on all admin endpoints (TEST2-004)"`

---

### Task 62 — Add PHI de-identification enforcement test

**Goal:** DB enforces that `is_deidentified=true` rows have NULL PHI fields.

**Files:**
- Create: `supabase/tests/p1_3_phi_deidentified_enforcement.sql`

- [ ] **Step 1:** Write a pgTAP test that:
  - Inserts a case with `is_deidentified=true, patient_mrn='123', patient_dob='1990-01-01'` → asserts CHECK constraint raises
  - Inserts a case with `is_deidentified=true, patient_mrn=NULL, patient_dob=NULL` → asserts success
  - Inserts a case with `is_deidentified=true, field_values='{"notes":"MRN 123456"}'` → asserts trigger raises (from Task 17)
- [ ] **Step 2:** Commit: `git add supabase/tests/p1_3_phi_deidentified_enforcement.sql && git commit -m "test(phi): de-identification enforcement (TEST2-002)"`

---

### Task 63 — Add rate-limiting test on auth endpoints

**Goal:** 31st login attempt from same IP returns 429.

**Files:**
- Create: `apps/web/e2e/rate-limit.spec.ts`

- [ ] **Step 1:** Write a Playwright test that POSTs to `/login` 31 times from the same IP → asserts the 31st returns 429 with a `Retry-After` header.
- [ ] **Step 2:** Commit: `git add apps/web/e2e/rate-limit.spec.ts && git commit -m "test(auth): rate limiting on login (TEST2-006)"`

---

### Task 64 — Add PDF export auth + cross-tenant test

**Goal:** `generate-pdf` rejects unauthenticated requests and cross-tenant case_ids.

**Files:**
- Create: `supabase/functions/generate-pdf/index.test.ts`

- [ ] **Step 1:** Write a Deno test that:
  - POSTs without `Authorization` → asserts 401
  - POSTs with tenant A's JWT but tenant B's `case_ids` → asserts 0 rows returned (RLS)
- [ ] **Step 2:** Commit: `git add supabase/functions/generate-pdf/index.test.ts && git commit -m "test(pdf): auth + cross-tenant (TEST2-007)"`

---

### Task 65 — Add axe-core a11y scan e2e

**Goal:** 0 critical a11y violations on key pages.

**Files:**
- Create: `apps/web/e2e/a11y.spec.ts`

- [ ] **Step 1:** Install `@axe-core/playwright` if not already.
- [ ] **Step 2:** Write a Playwright test that visits `/`, `/login`, `/signup`, `/pricing` and runs `await expect(page).toPassAxe()` on each.
- [ ] **Step 3:** Commit: `git add apps/web/e2e/a11y.spec.ts && git commit -m "test(a11y): axe-core scan on key pages (TEST2-014)"`

---

### Task 66 — Make `pnpm audit` blocking in CI

**Goal:** High+ vulnerabilities block merge.

**Files:**
- Modify: `.github/workflows/security.yml`

- [ ] **Step 1:** Remove `continue-on-error: true` from the `pnpm audit` step.
- [ ] **Step 2:** Add `--audit-level=high` flag.
- [ ] **Step 3:** Commit: `git add .github/workflows/security.yml && git commit -m "ci(security): make pnpm audit blocking (TEST2-017)"`

---

## Phase 8 — Final Verification

### Task 67 — Run the full verification suite

- [ ] **Step 1:** `pnpm install --frozen-lockfile`
- [ ] **Step 2:** `pnpm typecheck` (0 errors)
- [ ] **Step 3:** `pnpm lint:all` (0 errors)
- [ ] **Step 4:** `pnpm test` (all pass)
- [ ] **Step 5:** `supabase db reset && supabase db test` (all pgTAP pass)
- [ ] **Step 6:** `pnpm --filter @elogbook/web test:e2e` (all Playwright pass)
- [ ] **Step 7:** `pnpm build:web` (success)
- [ ] **Step 8:** `pnpm security:scan` (no high/critical)
- [ ] **Step 9:** If all green: `git push` (CD pipeline deploys)

---

## Appendix — Findings Index

| ID | Domain | Severity | Task |
|----|--------|----------|------|
| UX2-001 | Conversion | Blocking | 1 |
| UX2-002 | Conversion | Blocking | 2 |
| UX2-003 | Conversion | Blocking | (folded into 1 + 9) |
| SUB1-001 | Revenue | Blocking | 3 |
| GATE2-001 | Revenue | Blocking | 4 |
| GATE2-002 | Revenue | High | 4 |
| SUB1-004 | Revenue | Blocking | 5 |
| SUB1-002 | Revenue | Critical | 6 |
| SUB1-003/005 | Revenue | High | 7 |
| AI5-001 | Revenue | Blocking | 8 |
| GATE2-003 | Revenue | High | 8 |
| INST10-001 | Revenue | Blocking | 9 |
| HIDE9-001..004 | Revenue | High | 10 |
| SEC2-006 | Security | Critical | 11 |
| SEC2-004/AI5-002 | Security | Critical | 12 |
| SEC2-005/AI5-003 | Security | Critical | 13 |
| SEC2-009 | Security | High | 14 |
| SEC2-001/002/003 | Security | Critical | 15 |
| SEC2-008/010 | Security | High | 16 |
| SEC2-007 | Security | High | 17 |
| SEC2-012/013 | Security | High | 18 |
| PERF2-001/002 | Performance | Critical | 19 |
| PERF2-003..007 | Performance | Critical | 20 |
| PERF2-008 | Performance | Critical | 21 |
| PERF2-018 | Performance | High | 22 |
| PERF2-010 | Performance | High | 23 |
| PERF2-011 | Performance | High | 24 |
| PERF2-025/026/030 | Performance | Medium | 25 |
| PERF2-015 | Performance | High | 26 |
| UX2-022 | UI/UX | Critical | 27 |
| UX2-009 | UI/UX | Critical | 28 |
| UX2-010 | UI/UX | Critical | 29 |
| UX2-017 | UI/UX | Critical | 30 |
| UX2-018 | UI/UX | High | 31 |
| UX2-026/027 | UI/UX | Critical | 32 |
| UX2-028 | UI/UX | High | 33 |
| UX2-031 | UI/UX | Critical | 34 |
| UX2-033 | UI/UX | Critical | 35 |
| UX2-034 | UI/UX | High | 36 |
| UX2-035 | UI/UX | High | 37 |
| APP3-001/002 | Features | High | 38 |
| EXP4-001 | Features | High | 39 |
| CD-001 | DevOps | Blocking | 40 |
| CD-002 | DevOps | Blocking | 41 |
| CD-003 | DevOps | Blocking | 42 |
| CD-004 | DevOps | Blocking | 43 |
| VR-001 | DevOps | Blocking | 44 |
| ENV-001/SEC-001 | DevOps | Blocking | 45 |
| ENV-002/MOB-004 | DevOps | Blocking | 46 |
| MON-001 | DevOps | Blocking | 47 |
| CI-005 | DevOps | High | 48 |
| DR-001/002 | DevOps | Blocking | 49 |
| SB-001 | DevOps | Blocking | 50 |
| MOB2-001..005,012,013 | Mobile | Blocker | 51 |
| MOB2-008 | Mobile | Blocker | 52 |
| MOB2-006 | Mobile | Blocker | 53 |
| MOB2-007 | Mobile | Blocker | 54 |
| MOB2-009 | Mobile | Critical | 55 |
| MOB2-015 | Mobile | High | 56 |
| TEST2-011 | Tests | Critical | 57 |
| (pre-existing) | Tests | Critical | 58 |
| TEST2-001 | Tests | Critical | 59 |
| TEST2-003 | Tests | Critical | 60 |
| TEST2-004 | Tests | Critical | 61 |
| TEST2-002 | Tests | Critical | 62 |
| TEST2-006 | Tests | Critical | 63 |
| TEST2-007 | Tests | High | 64 |
| TEST2-014 | Tests | Medium | 65 |
| TEST2-017 | Tests | Medium | 66 |

---

## Appendix — Quick Command Reference

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

# Deploy (via CD pipeline on push to main)
git push
```

---

**End of ultimate plan.** Execute tasks 1–67 in order. Tasks 1–10 unblock revenue. Tasks 11–18 fix security blockers. Tasks 19–26 fix the 30-second performance goal. Tasks 27–39 fix UI/UX. Tasks 40–50 fix DevOps. Tasks 51–56 fix mobile. Tasks 57–66 add test coverage. Task 67 verifies everything. After task 67, the system is ready for the first paying junior doctor.
