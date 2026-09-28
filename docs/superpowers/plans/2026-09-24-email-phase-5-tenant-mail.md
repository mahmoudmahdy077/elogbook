# Enterprise Email Phase 5 — Tenant Mail Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow institution administrators to manage non-PHI tenant templates, verified sender domains, tenant campaigns, quotas, preferences, and delivery operations without crossing tenant or clinical-data boundaries.

**Architecture:** Tenant campaigns use the shared outbox and processor with `tenant_operational` class, tenant-scoped audience compilation, opt-out revalidation, quotas, and verified-domain selection. Platform marketing remains disabled.

**Tech Stack:** Next.js 16, Supabase PostgreSQL/RPC, React 19, Expo, Zod 4, Vitest, Playwright, pgTAP.

---

## Files

**Create**

- `supabase/migrations/20260924000011_email_tenant_campaign_schema.sql`
- `supabase/migrations/20260924000012_email_tenant_campaign_rpcs.sql`
- `supabase/tests/p2_17_email_tenant_campaign.sql`
- `supabase/tests/p2_18_email_preferences.sql`
- `apps/web/lib/email/tenant-policy.ts`
- `apps/web/lib/email/tenant-audience.ts`
- `apps/web/lib/email/campaign-service.ts`
- `apps/web/lib/email/preferences.ts`
- `apps/web/lib/email/__tests__/tenant-policy.test.ts`
- `apps/web/lib/email/__tests__/tenant-audience.test.ts`
- `apps/web/app/api/[tenant]/email/overview/route.ts`
- `apps/web/app/api/[tenant]/email/domains/route.ts`
- `apps/web/app/api/[tenant]/email/domains/[id]/verify/route.ts`
- `apps/web/app/api/[tenant]/email/templates/route.ts`
- `apps/web/app/api/[tenant]/email/templates/[id]/revisions/route.ts`
- `apps/web/app/api/[tenant]/email/templates/[id]/activate/route.ts`
- `apps/web/app/api/[tenant]/email/campaigns/route.ts`
- `apps/web/app/api/[tenant]/email/campaigns/[id]/route.ts`
- `apps/web/app/api/[tenant]/email/campaigns/[id]/send/route.ts`
- `apps/web/app/api/[tenant]/email/campaigns/[id]/pause/route.ts`
- `apps/web/app/api/[tenant]/email/campaigns/[id]/resume/route.ts`
- `apps/web/app/api/[tenant]/email/outbox/route.ts`
- `apps/web/app/api/[tenant]/email/suppressions/route.ts`
- `apps/web/app/api/[tenant]/email/test/route.ts`
- `apps/web/app/api/email/preferences/route.ts`
- `apps/web/app/(authenticated)/[tenant]/email/page.tsx`
- `apps/web/app/(authenticated)/[tenant]/email/TenantEmailConsole.tsx`
- `apps/web/app/(authenticated)/[tenant]/email/TenantTemplateEditor.tsx`
- `apps/web/app/(authenticated)/[tenant]/email/TenantCampaignBuilder.tsx`
- `apps/web/app/(authenticated)/email/preferences/page.tsx`
- `apps/web/app/(authenticated)/email/preferences/PreferenceCenter.tsx`
- `apps/mobile/app/(tabs)/email-preferences.tsx`
- `apps/mobile/lib/preferences.ts`
- `apps/mobile/lib/__tests__/preferences.test.ts`
- `apps/web/e2e/tenant-email.spec.ts`

**Modify**

- `apps/web/app/api/email/unsubscribe/route.ts`
- `apps/web/app/api/[tenant]/admin/__tests__/role-gating.test.ts`
- `apps/web/app/(authenticated)/[tenant]/layout.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/web/public/openapi.yaml`

## Task 1: Add tenant campaign schema and RLS

- [ ] **Step 1: Write failing pgTAP tests**

Assert:

- tenant campaign class is `tenant_operational`
- campaign tenant matches template tenant
- audience filters are structured JSON, not SQL
- cross-tenant campaign reads/mutations fail
- tenant admin service RPCs validate active tenant and role
- campaign quotas default to 500 per campaign and 2,000 per day
- campaign membership stores recipient HMAC/masked data, not plaintext

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p2_17_email_tenant_campaign.sql
```

Expected: FAIL.

- [ ] **Step 3: Create `20260924000011_email_tenant_campaign_schema.sql`**

Create `email_campaigns` and `email_campaign_memberships` with:

```sql
status text NOT NULL CHECK (status IN ('draft','scheduled','materializing','sending','paused','completed','canceled','failed'))
```

Add indexes for tenant/status/schedule and unique campaign idempotency. Enable and force RLS. No authenticated direct table grants; reviewed RPCs and server routes provide access.

- [ ] **Step 4: Run schema verification**

```powershell
supabase db reset
supabase db test supabase/tests/p2_17_email_tenant_campaign.sql
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Confirm no policy permits a tenant to query another tenant's campaign or membership. Do not commit.

## Task 2: Implement tenant audience and policy services

- [ ] **Step 1: Write failing tests**

Test active-user filtering, role filters, tenant membership, opt-out filtering, hard-bounce filtering, campaign limit, daily limit, unverified-domain rejection, and cross-tenant rejection.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/tenant-policy.test.ts lib/email/__tests__/tenant-audience.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement structured audience compilation**

`tenant-audience.ts` accepts only a Zod object with `accountStatus`, `roles`, and `tenantMailOptOut`. Compile to Supabase query-builder predicates, never raw SQL.

- [ ] **Step 4: Implement policy and quotas**

`tenant-policy.ts` checks active tenant, `institution_admin`/`admin`, AAL2 context supplied by the route, verified domain, message class, non-PHI content, recipient quota, daily quota, opt-out, and scoped suppression.

- [ ] **Step 5: Run verification**

Repeat targeted tests and typecheck. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect all audience predicates for parameterized builder calls. Do not commit.

## Task 3: Add tenant campaign RPCs

- [ ] **Step 1: Write failing pgTAP tests**

Prove:

- draft campaign cannot send before active template revision and verified domain
- send materializes eligible recipients once
- duplicate send request is idempotent
- pause prevents new materialization
- resume is allowed only from paused
- cancel cancels pending unsent messages
- opt-out cancels only tenant operational messages
- daily and campaign quotas are enforced atomically

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p2_17_email_tenant_campaign.sql
```

Expected: FAIL.

- [ ] **Step 3: Create `20260924000012_email_tenant_campaign_rpcs.sql`**

Implement `create_tenant_campaign`, `update_tenant_campaign`, `materialize_tenant_campaign`, `pause_tenant_campaign`, `resume_tenant_campaign`, and `cancel_tenant_campaign`. Each RPC checks tenant/role scope and writes audit/outbox intent transactionally.

- [ ] **Step 4: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p2_17_email_tenant_campaign.sql
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Confirm campaign state transitions cannot be performed by direct table updates. Do not commit.

## Task 4: Add tenant APIs

- [ ] **Step 1: Write failing API tests**

Every mutation must assert active tenant, `institution_admin`/`admin`, AAL2, CSRF/origin, body limits, rate limits, tenant kill switch, and `email_admin_audit`. List APIs must return only current-tenant records.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/email
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement tenant overview/domain/template routes**

Reuse the platform domain/template services with tenant scope. Tenant admins may request/verify custom domains and manage only their own template revisions. Shared platform domains are selectable but not editable.

- [ ] **Step 4: Implement tenant campaign routes**

Create/update/send/pause/resume/cancel routes return explicit states and sanitized campaign counters. Send requires a typed confirmation body containing campaign ID and `nonPhiAttestation: true`.

- [ ] **Step 5: Implement tenant outbox/suppression/test routes**

Return masked/HMAC data only. Test recipients must be the tenant admin or an active tenant-scoped allowlist row. Tenant API cannot return global provider or campaign data.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/email app/api/[tenant]/admin/__tests__/role-gating.test.ts
pnpm --filter @elogbook/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Search client URLs for tenant UUID/slug mismatches and confirm all admin checks are server-side. Do not commit.

## Task 5: Add web and mobile preference center

- [ ] **Step 1: Write failing preference tests**

Test platform marketing display, per-tenant operational opt-out, essential/security explanation, inactive tenant handling, and opt-out cancellation of pending tenant messages.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/email/__tests__/preferences.test.ts app/api/email/__tests__/unsubscribe.test.ts
pnpm --filter @elogbook/mobile test lib/__tests__/preferences.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement preference APIs**

`GET` returns current user's global and tenant preferences. `PATCH` accepts only a validated preference change and records policy version/source. Tenant opt-out calls the campaign cancellation function for unsent tenant rows.

- [ ] **Step 4: Implement web preference center**

Link from tenant settings and platform/account settings. Explain that security and essential messages cannot be disabled. Tenant opt-out remains separate per tenant.

- [ ] **Step 5: Implement mobile preference center**

Add a profile link and screen using the same API. Keep offline behavior limited to a non-sensitive cached preference summary; server confirmation is required before claiming a change succeeded.

- [ ] **Step 6: Run verification**

Repeat web/mobile tests, typecheck, and lint. Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Confirm platform marketing remains visibly unavailable until Phase 6. Do not commit.

## Task 6: Build tenant console

- [ ] **Step 1: Write failing component tests**

Render overview, domain status, template revision editor, campaign builder, audience preview, non-PHI attestation, send confirmation, quota errors, pause/cancel controls, and tenant opt-out list.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run "app/(authenticated)/[tenant]/email"
```

Expected: FAIL.

- [ ] **Step 3: Implement tenant console**

Add `/[tenant]/email` to tenant navigation for admin roles only. Use the existing panel, table, form, toast, and server-action conventions. Do not expose global provider credentials or platform campaign controls.

- [ ] **Step 4: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run "app/(authenticated)/[tenant]/email"
pnpm --filter @elogbook/web lint
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Verify template preview is sandboxed and campaign UI cannot display or accept clinical fields. Do not commit.

## Task 7: Soak and release tenant mail

- [ ] **Step 1: Add E2E coverage**

Create `apps/web/e2e/tenant-email.spec.ts` for admin campaign send, opt-out cancellation, quota rejection, cross-tenant denial, unverified-domain denial, pause/resume, and dead-letter retry.

- [ ] **Step 2: Run synthetic Mailpit campaign**

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d mailpit email-worker app
pnpm --filter @elogbook/web exec playwright test e2e/tenant-email.spec.ts
```

Expected: PASS with synthetic recipients only.

- [ ] **Step 3: Phase 5 gate**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
pnpm audit --prod --audit-level=high
supabase db test supabase/tests/p2_17_email_tenant_campaign.sql supabase/tests/p2_18_email_preferences.sql
git diff --check
git status --short
```

Confirm tenant isolation, quota enforcement, opt-out behavior, no PHI payloads, and platform marketing still disabled. Do not commit.
