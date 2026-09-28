# Enterprise Email Phase 4 — Platform Operations Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform operators a production console for health, verified domains, immutable templates, queue operations, scoped suppressions, provider readiness, and audit evidence.

**Architecture:** Platform APIs call focused server services and reviewed service-role queries. Every mutation requires active platform-admin authority and AAL2, validates origin and body size, records append-only email audit, and returns explicit state. Provider credentials remain host-managed.

**Tech Stack:** Next.js 16 server components and route handlers, Supabase service role, Resend domain API, React 19, Tailwind CSS, Vitest, Playwright, pgTAP.

---

## Files

**Create**

- `supabase/migrations/20260924000010_email_platform_operations.sql`
- `supabase/tests/p2_16_email_platform_operations.sql`
- `apps/web/lib/email/provider-health.ts`
- `apps/web/lib/email/domain-management.ts`
- `apps/web/lib/email/admin-query.ts`
- `apps/web/lib/email/audit.ts`
- `apps/web/lib/email/__tests__/provider-health.test.ts`
- `apps/web/lib/email/__tests__/domain-management.test.ts`
- `apps/web/app/api/platform/email/overview/route.ts`
- `apps/web/app/api/platform/email/settings/route.ts`
- `apps/web/app/api/platform/email/domains/route.ts`
- `apps/web/app/api/platform/email/domains/[id]/verify/route.ts`
- `apps/web/app/api/platform/email/domains/[id]/default/route.ts`
- `apps/web/app/api/platform/email/domains/[id]/route.ts`
- `apps/web/app/api/platform/email/templates/[id]/route.ts`
- `apps/web/app/api/platform/email/templates/[id]/revisions/route.ts`
- `apps/web/app/api/platform/email/templates/[id]/activate/route.ts`
- `apps/web/app/api/platform/email/templates/revisions/[id]/rollback/route.ts`
- `apps/web/app/api/platform/email/outbox/route.ts`
- `apps/web/app/api/platform/email/outbox/[id]/retry/route.ts`
- `apps/web/app/api/platform/email/outbox/[id]/cancel/route.ts`
- `apps/web/app/api/platform/email/suppressions/[id]/route.ts`
- `apps/web/app/platform/email/OverviewPanel.tsx`
- `apps/web/app/platform/email/DomainPanel.tsx`
- `apps/web/app/platform/email/TemplateRevisionPanel.tsx`
- `apps/web/app/platform/email/TemplatePreviewFrame.tsx`
- `apps/web/app/platform/email/QueuePanel.tsx`
- `apps/web/app/platform/email/SuppressionPanel.tsx`
- `apps/web/app/platform/email/ProviderHealthPanel.tsx`
- `apps/web/app/platform/email/__tests__/console.test.tsx`
- `apps/web/e2e/email-platform-console.spec.ts`
- `docs/operations/email-deliverability-runbook.md`
- `docs/operations/email-alerts.md`
- `scripts/verify-email-alerts.mjs`

**Modify**

- `apps/web/app/api/platform/email/templates/route.ts`
- `apps/web/app/api/platform/email/templates/[key]/route.ts`
- `apps/web/app/api/platform/email/suppressions/route.ts`
- `apps/web/app/api/platform/email/logs/route.ts`
- `apps/web/app/api/platform/email/test/route.ts`
- `apps/web/app/api/platform/email/webhook/route.ts`
- `apps/web/app/api/platform/email/process/route.ts`
- `apps/web/app/api/ready/route.ts`
- `apps/web/app/platform/email/page.tsx`
- `apps/web/app/platform/email/TemplateEditor.tsx`
- `apps/web/app/platform/email/TestSendForm.tsx`
- `apps/web/app/platform/layout.tsx`
- `apps/web/public/openapi.yaml`

## Task 1: Add platform operational state

- [ ] **Step 1: Write failing pgTAP tests**

Assert provider health/circuit storage exists, domain status constraints are enforced, default domain is unique, platform settings reject campaign enablement before evidence fields are valid, and every table uses FORCE RLS.

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p2_16_email_platform_operations.sql
```

Expected: FAIL.

- [ ] **Step 3: Create the migration**

`20260924000010_email_platform_operations.sql` adds `last_provider_check_at`, `last_provider_latency_ms`, and `last_webhook_event_at` to `email_system_settings`; adds `verification_attempts`, `last_provider_code`, and `last_verified_at` to `email_domains`; adds `set_default_email_domain(p_domain_id uuid)`, `set_email_delivery_setting(p_key text, p_value jsonb)`, and `record_email_provider_health(p_provider text, p_reachable boolean, p_latency_ms integer, p_code text)` functions; and adds indexes for queue/dead-letter summaries. Domain history is recorded in `email_admin_audit`. Campaign settings remain false.

- [ ] **Step 4: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p2_16_email_platform_operations.sql
node scripts/lint-migrations.mjs
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Confirm campaign enablement is not changed by this migration. Do not commit.

## Task 2: Implement provider health and domain management

- [ ] **Step 1: Write failing service tests**

Mock Resend and SMTP. Assert health returns only configured state, reachability, bounded latency, circuit state, and sanitized code. Assert domain creation normalizes hostname, rejects IP/localhost, stores provider ID, and never stores API secrets.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/provider-health.test.ts lib/email/__tests__/domain-management.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement provider health**

Use bounded `AbortSignal.timeout`, no raw provider body, and circuit update through the reviewed RPC. Health checks never send a message unless an operator explicitly chooses a canary send.

- [ ] **Step 4: Implement domain lifecycle**

Create, verify, disable, and select default operations. Require verified state before default selection. Store provider domain ID, SPF/DKIM/DMARC status, and timestamps. Record email audit for every mutation.

- [ ] **Step 5: Run verification**

Repeat targeted tests and typecheck. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect provider adapter error handling. Do not commit.

## Task 3: Add platform email APIs

- [ ] **Step 1: Write failing API tests**

For every mutation, assert platform admin, active profile, AAL2, origin validation, JSON content type, body limit, rate limit, tenant/global scope enforcement, and `email_admin_audit` insertion.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/platform/email
```

Expected: FAIL for new routes and migration of key-based template routes.

- [ ] **Step 3: Implement overview and settings**

Overview returns queue counts, oldest age, worker heartbeat, provider/circuit state, webhook freshness, domain status, and aggregate delivery metrics. Settings accepts only allowlisted non-secret fields and returns masked values.

- [ ] **Step 4: Implement domain APIs**

Create/read list, verify, default, and disable/delete. Deleting a domain requires it not be the active default and no pending campaign reference.

- [ ] **Step 5: Implement immutable template APIs**

Create a new revision for every content change. Activate only a complete revision. Rollback creates a new revision from the selected historical content. Use content policy validation before persistence.

- [ ] **Step 6: Implement queue and suppression actions**

List with cursor/filter pagination. Retry only eligible failed/dead-letter rows. Cancel only pending/retry/claimed-not-sent rows. Suppression add/clear requires a reason and verified recipient state for resubscribe.

- [ ] **Step 7: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/platform/email
pnpm --filter @elogbook/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Search for key-based template lookup, raw address output, and audit writes to tenant `audit_logs`. Do not commit.

## Task 4: Build the platform console

- [ ] **Step 1: Write failing component tests**

Render overview, provider health, domains, template revision history, sandbox preview, queue filters/actions, and suppression filters/actions. Assert inaccessible actions are not rendered and server errors display a generic failure.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/platform/email/__tests__/console.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement panels**

Use server components for initial data and client components only for forms/filters. `TemplatePreviewFrame` must render sanitized HTML inside a sandboxed iframe with `sandbox` and a restrictive CSP; it must not execute scripts or load remote images.

- [ ] **Step 4: Link the console**

Add an Email link to `apps/web/app/platform/layout.tsx` and a link from the platform home page. Preserve the existing platform-admin boundary.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/platform/email/__tests__/console.test.tsx
pnpm --filter @elogbook/web lint
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Verify no provider secret, raw recipient, or render context is rendered into HTML or client props. Do not commit.

## Task 5: Add alerts, readiness, and canary evidence

- [ ] **Step 1: Write failing verifier tests**

`verify-email-alerts.mjs` must assert thresholds from the spec:

```js
const thresholds = {
  oldestPendingSeconds: 300,
  webhookFreshnessSeconds: 600,
  workerHeartbeatIntervals: 2,
  hardBounceRate: 0.02,
  complaintRate: 0.001,
  deadLetters: 0,
};
```

- [ ] **Step 2: Implement runbooks and verifier**

Document operator actions for provider outage, queue backlog, hard bounce, complaint spike, stale webhook, dead letter, domain failure, and kill switch. The verifier parses repository configuration and fails if thresholds drift.

- [ ] **Step 3: Update readiness**

Readiness reports degraded rather than failing essential readiness when campaign lanes are disabled. Provider circuit and queue age are visible; secret values are not.

- [ ] **Step 4: Run E2E**

```powershell
pnpm --filter @elogbook/web exec playwright test e2e/email-platform-console.spec.ts
node scripts/verify-email-alerts.mjs
```

Expected: PASS with synthetic provider fixtures.

- [ ] **Step 5: Phase 4 checkpoint**

Run global gates and verify platform AAL2, CSRF, domain verification, template immutability, queue actions, suppression scope, masked logs, and canary evidence. Do not commit.
