# Enterprise Email Phase 6 — Platform Marketing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable explicitly opted-in, double-confirmed platform campaigns with tenant-safe metrics, scoped unsubscribe, scheduling, and an evidence-based operator gate.

**Architecture:** Platform marketing reuses the shared outbox, worker, suppression, provider, domain, and audit infrastructure. A separate consent evidence table and audience service ensure only confirmed platform opt-ins are materialized. Marketing remains disabled until the readiness evidence gate passes.

**Tech Stack:** Next.js 16, Supabase PostgreSQL/RPC, Resend/SMTP, React 19, Vitest, Playwright, pgTAP, Docker Mailpit.

---

## Files

**Create**

- `supabase/migrations/20260924000013_email_marketing_consent_schema.sql`
- `supabase/migrations/20260924000014_email_marketing_campaign_schema.sql`
- `supabase/migrations/20260924000015_email_marketing_seed.sql`
- `supabase/tests/p2_19_email_marketing_consent.sql`
- `supabase/tests/p2_20_email_marketing_campaign.sql`
- `apps/web/lib/email/marketing-consent.ts`
- `apps/web/lib/email/marketing-audience.ts`
- `apps/web/lib/email/marketing-analytics.ts`
- `apps/web/app/api/email/marketing/confirm/route.ts`
- `apps/web/app/email/marketing/confirm/page.tsx`
- `apps/web/app/api/email/click/route.ts`
- `apps/web/app/email/unsubscribe/page.tsx`
- `apps/web/lib/email/__tests__/marketing-consent.test.ts`
- `apps/web/lib/email/__tests__/marketing-audience.test.ts`
- `apps/web/lib/email/__tests__/marketing-analytics.test.ts`
- `apps/web/app/api/email/__tests__/marketing-consent.test.ts`
- `apps/web/app/api/email/__tests__/click-unsubscribe.test.ts`
- `apps/web/app/api/platform/email/campaigns/route.ts`
- `apps/web/app/api/platform/email/campaigns/[id]/route.ts`
- `apps/web/app/api/platform/email/campaigns/[id]/send/route.ts`
- `apps/web/app/api/platform/email/campaigns/[id]/pause/route.ts`
- `apps/web/app/api/platform/email/campaigns/[id]/resume/route.ts`
- `apps/web/app/platform/email/CampaignBuilder.tsx`
- `apps/web/app/platform/email/CampaignMetrics.tsx`
- `apps/web/app/platform/email/AudiencePreview.tsx`
- `apps/web/app/platform/email/__tests__/campaigns.test.tsx`
- `apps/web/e2e/platform-marketing.spec.ts`
- `docs/operations/email-marketing-rollout.md`

**Modify**

- `apps/web/app/api/email/preferences/route.ts`
- `apps/web/app/api/email/unsubscribe/route.ts`
- `apps/web/app/api/platform/email/webhook/route.ts`
- `apps/web/app/platform/email/page.tsx`
- `apps/web/app/platform/layout.tsx`
- `apps/web/app/(authenticated)/email/preferences/PreferenceCenter.tsx`
- `packages/shared/src/email/send.ts`
- `apps/web/public/openapi.yaml`

## Task 1: Add double-opt-in consent evidence

- [ ] **Step 1: Write failing pgTAP tests**

Assert:

- a new preference grant is pending until confirmation
- confirmation token is hashed, expiring, and single-use
- revoked consent cancels pending unsent platform campaign messages
- tenant preference changes cannot grant platform marketing consent
- essential/security delivery is unaffected
- authenticated users cannot read another user's consent evidence

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p2_19_email_marketing_consent.sql
```

Expected: FAIL.

- [ ] **Step 3: Create consent migration**

`20260924000013_email_marketing_consent_schema.sql` adds consent evidence columns and a `marketing_consent_confirmations` table. Store policy version, source, confirmation time, expiry, consumed time, and revocation time. Do not store raw confirmation tokens.

- [ ] **Step 4: Implement consent service/routes**

Create `marketing-consent.ts` and confirmation API/page. Confirmation accepts only opaque token, checks expiry and single use, and returns a generic page. Revocation uses the existing user preference service and cancels pending platform bulk rows through an RPC.

- [ ] **Step 5: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p2_19_email_marketing_consent.sql
pnpm --filter @elogbook/web exec vitest run app/api/email/__tests__/marketing-consent.test.ts
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm tenant operational opt-out cannot be used as platform marketing consent. Do not commit.

## Task 2: Add platform campaign audience and aggregate analytics

- [ ] **Step 1: Write failing tests**

Test audience filters for active users, confirmed platform opt-in, no hard bounce, no manual suppression, and no duplicate campaign membership. Test metrics containing only accepted, delivered, hard-bounced, complained, unsubscribed, suppressed, and dead-letter counts.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/marketing-audience.test.ts lib/email/__tests__/marketing-analytics.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement audience service**

Use parameterized Supabase query-builder filters. Materialize only users with current confirmed opt-in and active account status. Snapshot the consent decision in the outbox row.

- [ ] **Step 4: Implement analytics service**

Aggregate by campaign, class, provider, tenant where applicable, and delivery event type. Never return raw address, render context, open tracking, IP address, or user-agent data.

- [ ] **Step 5: Run verification**

Repeat targeted tests and typecheck. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm no open-rate or tracking-pixel field is introduced. Do not commit.

## Task 3: Add platform campaign schema and APIs

- [ ] **Step 1: Write failing pgTAP and route tests**

Prove platform campaigns require platform admin, AAL2, verified platform domain, non-PHI attestation, confirmed audience, and `platform_marketing_enabled=true`. Prove draft/schedule/pause/resume/cancel transitions and idempotency.

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p2_20_email_marketing_campaign.sql
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/campaigns
```

Expected: FAIL.

- [ ] **Step 3: Create campaign migration**

`20260924000014_email_marketing_campaign_schema.sql` adds platform campaign constraints, campaign audience snapshots, aggregate counters, schedule fields, and verified-domain foreign-key behavior. `20260924000015_email_marketing_seed.sql` seeds approved non-PHI templates while leaving marketing disabled.

- [ ] **Step 4: Implement campaign APIs**

Create:

- `GET|POST /api/platform/email/campaigns`
- `GET|PATCH|DELETE /api/platform/email/campaigns/[id]`
- `POST /api/platform/email/campaigns/[id]/send`
- `POST /api/platform/email/campaigns/[id]/pause`
- `POST /api/platform/email/campaigns/[id]/resume`

Every mutation uses platform admin, AAL2, origin/CSRF, body limits, rate limits, `email_admin_audit`, and explicit non-PHI attestation.

- [ ] **Step 5: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p2_20_email_marketing_campaign.sql
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/campaigns
```

Expected: PASS with marketing still disabled.

- [ ] **Step 6: Review checkpoint**

Inspect all campaign queries for parameterized filters and all sends for consent snapshot creation. Do not commit.

## Task 4: Implement one-click unsubscribe and privacy-safe click attribution

- [ ] **Step 1: Write failing tests**

Assert bulk messages include `List-Unsubscribe` and `List-Unsubscribe-Post`, tokens are single-purpose and expiring, POST is the only mutating method, and click redirects validate destination, scope, expiry, and replay.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/email/__tests__/click-unsubscribe.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement headers and POST processing**

Use the Phase 1 token service. Bulk class determination is explicit `message_class`, not template-key inference. Unsubscribe updates only platform or tenant scope and never essential/security suppression.

- [ ] **Step 4: Implement signed click redirect**

Use a random opaque link ID and allowlisted destination. Store only campaign/outbox ID, link ID, and coarse event time. Reject external destinations not present in the signed template context. No IP or user-agent retention.

- [ ] **Step 5: Run verification**

Repeat targeted tests and security scan. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm scanners cannot unsubscribe through GET and no raw recipient appears in URLs. Do not commit.

## Task 5: Build platform campaign console and user controls

- [ ] **Step 1: Write failing component tests**

Render campaign draft, audience preview, schedule, non-PHI attestation, send confirmation, pause/cancel, delivery metrics, domain readiness, and marketing-disabled state.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/platform/email/__tests__/campaigns.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement campaign UI**

Add campaign builder, audience preview, and metrics components. Require a second explicit confirmation for send/schedule. Do not display recipient addresses.

- [ ] **Step 4: Update preference center**

Add platform marketing status, consent source, confirmation timestamp, and revoke action. Keep tenant operational preferences separate.

- [ ] **Step 5: Run verification**

Repeat component tests, typecheck, and lint. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm the marketing-disabled setting is visible and cannot be bypassed by a client flag. Do not commit.

## Task 6: Execute the marketing enablement gate

- [ ] **Step 1: Write the gate verifier**

`docs/operations/email-marketing-rollout.md` and `scripts/verify-email-alerts.mjs` must verify:

```text
platform domain verified
SPF/DKIM/DMARC evidence present
Resend health reachable
SMTP health known
webhook freshness under 10 minutes
oldest queue under 5 minutes
zero dead letters
hard-bounce rate under 2 percent over 24 hours
complaint rate under 0.1 percent over 24 hours
consent/suppression/unsubscribe tests pass
kill-switch tests pass
synthetic canary passes
no PHI or tenant-confidential content detected
```

- [ ] **Step 2: Run with marketing disabled**

```powershell
node scripts/verify-email-alerts.mjs
```

Expected: FAIL or report marketing blocked while settings remain false.

- [ ] **Step 3: Run synthetic canary**

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d mailpit email-worker app
pnpm --filter @elogbook/web exec playwright test e2e/platform-marketing.spec.ts
```

Expected: PASS with synthetic recipients only.

- [ ] **Step 4: Enable through audited operator action**

Only after all evidence passes, use a platform-admin API action to set `platform_marketing_enabled=true`. Record actor, timestamp, evidence hash, and reason in `email_admin_audit`. Do not enable through migration seed data or a test fixture.

- [ ] **Step 5: Phase 6 final gate**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm test:coverage
pnpm build:web
pnpm audit --prod --audit-level=high
supabase db test supabase/tests/p2_19_email_marketing_consent.sql supabase/tests/p2_20_email_marketing_campaign.sql
node scripts/verify-email-alerts.mjs
node --test tests/security/email-containment.test.mjs
git diff --check
git status --short
```

Expected: all PASS, evidence recorded, and no plaintext recipient, render context, PHI, auth token, or provider secret in logs/audit. Do not commit without explicit user authorization.
