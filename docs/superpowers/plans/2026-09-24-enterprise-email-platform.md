# Enterprise Email Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current partial email implementation with a secure, durable, tenant-safe transactional and marketing email platform for Docker Compose and Vercel.

**Architecture:** PostgreSQL is the durable source of truth for email intent, consent snapshots, template revisions, campaign membership, delivery state, and atomic worker claims. Node.js encrypts recipient/context data, enforces policy, and sends through Resend, SMTP, or Supabase Auth/GoTrue. Platform and tenant administration use separate server-authorized surfaces and append-only email audit events.

**Tech Stack:** Next.js 16 App Router, TypeScript 6, Supabase Postgres/Auth, Node.js 22 `crypto`, Zod 4, Resend HTTP API, Nodemailer, Vitest 4, pgTAP, Playwright, pnpm 9.15, Docker Compose, Vercel Cron.

---

## Governing documents

- Approved design: `docs/superpowers/specs/2026-09-24-enterprise-email-platform-design.md`
- Superseded design: `docs/superpowers/specs/2026-09-22-email-service-design.md`
- Migration policy: `docs/operations/migration-policy.md`
- Security policy: `SECURITY.md`

## Execution constraints

- The working tree already contains user and security-hardening changes. Do not reset, clean, checkout, or revert unrelated work.
- Do not commit, amend, push, or create a PR unless the user explicitly requests it.
- Do not enable tenant campaigns or platform marketing before their phase gates pass.
- Marketing and tenant bulk content must not include PHI, ePHI, patient identifiers, case data, or clinical details.
- Provider credentials remain host-managed and server-only.
- Every database mutation must check the returned error or run inside a tested RPC.
- Every admin authorization check must execute on the server.
- Historical email migrations remain unchanged; all changes use new forward migrations.
- New code follows existing workspace, Zod, Supabase, logger, and Vitest patterns.

## Phase plans

Execute in this order:

1. `docs/superpowers/plans/2026-09-24-email-phase-1-safety.md`
2. `docs/superpowers/plans/2026-09-24-email-phase-2-durable-core.md`
3. `docs/superpowers/plans/2026-09-24-email-phase-3-auth-transactional.md`
4. `docs/superpowers/plans/2026-09-24-email-phase-4-platform-operations.md`
5. `docs/superpowers/plans/2026-09-24-email-phase-5-tenant-mail.md`
6. `docs/superpowers/plans/2026-09-24-email-phase-6-platform-marketing.md`

Do not begin a later phase until the prior phase's final review checkpoint passes.

## File responsibility map

### Shared email contracts

- `packages/shared/src/email/types.ts` — message, transport, policy, campaign, and result types
- `packages/shared/src/email/crypto.ts` — AES-256-GCM envelopes, key versions, HMAC helpers
- `packages/shared/src/email/tokens.ts` — expiring, single-purpose action tokens
- `packages/shared/src/email/policy.ts` — pure message-class and suppression decisions
- `packages/shared/src/email/schemas.ts` — transport and webhook schemas
- `packages/shared/src/email/sanitize.ts` — server-side HTML and URL policy
- `packages/shared/src/email/resend.ts` — Resend transport
- `packages/shared/src/email/smtp.ts` — SMTP transport
- `packages/shared/src/email/send.ts` — failover and typed error classification
- `packages/shared/src/email/webhook.ts` — provider event parsing and mapping
- `packages/shared/src/email/templates.ts` — compatibility wrapper over strict rendering
- `packages/shared/src/email/queue.ts` — compatibility wrapper over new enqueue contracts
- `packages/shared/src/email/suppressions.ts` — normalization and scoped suppression helpers

### Web server email services

- `apps/web/lib/email/scheduler-auth.ts` — constant-time scheduler authentication
- `apps/web/lib/email/legacy-processor.ts` — temporary Phase 1 adapter for the legacy queue
- `apps/web/lib/email/kill-switch.ts` — global, class, tenant, and domain delivery gates
- `apps/web/lib/email/crypto.ts` — server key-ring parsing and rotation
- `apps/web/lib/email/enqueue.ts` — canonical enqueue service
- `apps/web/lib/email/policy.ts` — database-backed account, tenant, consent, and suppression revalidation
- `apps/web/lib/email/render.ts` — immutable template revision rendering
- `apps/web/lib/email/content-policy.ts` — non-PHI variable and content enforcement
- `apps/web/lib/email/provider-factory.ts` — provider construction and circuit state
- `apps/web/lib/email/rate-limit.ts` — provider and tenant send budgets
- `apps/web/lib/email/processor.ts` — claim, policy, render, send, finalize, retry
- `apps/web/lib/email/observability.ts` — PHI-free email events
- `apps/web/lib/email/audit.ts` — append-only email admin audit
- `apps/web/lib/email/provider-health.ts` — bounded provider readiness
- `apps/web/lib/email/domain-management.ts` — provider domain lifecycle
- `apps/web/lib/email/campaign-service.ts` — shared campaign state machine
- `apps/web/lib/email/tenant-policy.ts` — tenant quotas and authorization
- `apps/web/lib/email/tenant-audience.ts` — parameterized tenant audience compiler
- `apps/web/lib/email/marketing-consent.ts` — double-opt-in evidence
- `apps/web/lib/email/marketing-audience.ts` — platform opted-in audience
- `apps/web/lib/email/marketing-analytics.ts` — aggregate campaign metrics
- `apps/web/lib/email/preferences.ts` — global and tenant preference mutations

### Database migrations

Apply after `20260923000006_attachment_quarantine_storage.sql` in this order:

1. `20260924000001_email_safety_controls.sql`
2. `20260924000002_email_platform_expand.sql`
3. `20260924000003_email_platform_rpcs.sql`
4. `20260924000004_email_platform_backfill.sql`
5. `20260924000005_email_platform_maintenance.sql`
6. `20260924000006_email_auth_intent.sql`
7. `20260924000007_email_auth_transactional_rpcs.sql`
8. `20260924000008_email_legacy_contract.sql`
9. `20260924000010_email_platform_operations.sql`
10. `20260924000011_email_tenant_campaign_schema.sql`
11. `20260924000012_email_tenant_campaign_rpcs.sql`
12. `20260924000013_email_marketing_consent_schema.sql`
13. `20260924000014_email_marketing_campaign_schema.sql`
14. `20260924000015_email_marketing_seed.sql`

The numbering leaves `20260924000009` unused so later unrelated work can use it without renaming files.

### Deployment and operations

- `docker-compose.yml` — production app, worker, and email environment
- `docker-compose.local.yml` — Mailpit and local worker profile
- `vercel.json` — authenticated once-per-minute processor Cron
- `apps/web/Dockerfile` — worker runtime and scripts
- `scripts/email-worker.mjs` — graceful long-running scheduler
- `scripts/verify-email-runtime.mjs` — environment/deployment contract verifier
- `scripts/verify-email-alerts.mjs` — deliverability threshold and kill-switch verifier
- `scripts/migrate-legacy-email-outbox.mjs` — resumable Node encryption backfill
- `docs/operations/email-deliverability-runbook.md`
- `docs/operations/email-alerts.md`
- `docs/operations/email-marketing-rollout.md`

## Locked cross-phase contracts

```ts
type EmailMessageClass =
  | 'essential_transactional'
  | 'security_transactional'
  | 'platform_marketing'
  | 'tenant_operational';

type EmailDeliveryChannel = 'app_provider' | 'supabase_auth';

type EmailOutboxStatus =
  | 'pending'
  | 'claimed'
  | 'retry_wait'
  | 'accepted'
  | 'delivered'
  | 'suppressed'
  | 'failed'
  | 'dead_letter'
  | 'canceled';

interface EmailTransport {
  name: 'resend' | 'smtp' | 'supabase_auth';
  send(message: RenderedEmail, context: SendContext): Promise<TransportResult>;
  health(context: HealthContext): Promise<TransportHealth>;
}

type EnqueueResult =
  | { state: 'queued'; outboxId: string }
  | { state: 'suppressed'; code: string }
  | { state: 'failed'; code: string };
```

Canonical server symbols:

```ts
enqueueEmailIntent(input: EnqueueInput): Promise<EnqueueResult>;
processEmailBatch(input: ProcessorInput): Promise<ProcessorResult>;
claimEmailOutbox(input: ClaimInput): Promise<ClaimedMessage[]>;
completeEmailOutbox(input: CompleteInput): Promise<MutationResult>;
failEmailOutbox(input: FailInput): Promise<MutationResult>;
revalidateDeliveryPolicy(input: PolicyInput): Promise<PolicyDecision>;
renderEmailRevision(input: RenderInput): Promise<RenderedEmail>;
recordEmailAdminAudit(input: AuditInput): Promise<void>;
issueEmailActionToken(input: ActionTokenInput): Promise<{ token: string }>;
consumeEmailActionToken(input: ConsumeTokenInput): Promise<ActionTokenRecord | null>;
assertAuthorizedEmailRecipient(input: RecipientInput): Promise<void>;
assertNonPhiCampaignContent(input: ContentInput): Promise<void>;
```

Compatibility exports remain during migration:

- `render()` from `@elogbook/shared/email/templates`
- `sendWithFailover()` from `@elogbook/shared/email/send`
- `buildQueueRow()` from `@elogbook/shared/email/queue`
- `POST /api/platform/email/process`
- Existing platform email template, test, log, and suppression endpoints

## Global verification gates

Run the applicable commands after every phase:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
pnpm typecheck
pnpm lint:all
pnpm test
pnpm test:coverage
pnpm build:web
pnpm audit --prod --audit-level=high
node scripts/verify-email-runtime.mjs
supabase db reset
supabase db test
git diff --check
git status --short
```

Expected result:

- Typecheck, lint, tests, build, migration tests, runtime verification, and security audit pass.
- `git diff --check` emits no whitespace errors.
- `git status --short` contains only intended implementation files plus the user's pre-existing uncommitted files.
- No campaign kill switch is enabled ahead of its phase.

## Final release evidence

Before enabling platform marketing, retain evidence for:

- verified platform sending domain
- SPF, DKIM, and DMARC status
- Resend and SMTP health
- webhook freshness under ten minutes
- queue age under five minutes
- zero unexplained dead letters
- hard-bounce rate below 2 percent over 24 hours
- complaint rate below 0.1 percent over 24 hours
- consent, suppression, unsubscribe, and kill-switch tests
- synthetic-recipient canary through every enabled transport
- no PHI, recipient plaintext, render context, or auth token in logs, audit, or test artifacts

## Review checkpoints

Each phase ends with:

1. Run phase-specific tests.
2. Run global verification gates.
3. Inspect `git diff --check` and `git status --short`.
4. Review the phase diff for secrets, plaintext recipient data, loose SQL, client-only authorization, and ignored database errors.
5. Confirm later campaign switches remain disabled.
6. Do not commit unless the user explicitly authorizes a commit.

## Plan self-review

### Spec coverage

| Approved design area | Implemented by |
|---|---|
| Environment and deployment contract | Phase 1 Tasks 1 and 8 |
| Machine scheduler and CSRF boundary | Phase 1 Task 3 |
| Typed Resend/SMTP transports | Phase 1 Task 4 |
| Webhook replay and event safety | Phase 1 Task 5 |
| Read-only GET and one-click POST unsubscribe | Phase 1 Task 6 |
| Restricted test send and platform audit | Phase 1 Task 7 |
| Logging redaction | Phase 1 Task 9 |
| Encrypted outbox and schema | Phase 2 Tasks 1–3 |
| Atomic claim, lease, fence, retry | Phase 2 Tasks 4 and 6 |
| Idempotent enqueue and backfill | Phase 2 Tasks 5 and 7 |
| Retention, deletion, heartbeat, readiness | Phase 2 Task 8 |
| Auth email and recovery | Phase 3 Tasks 1–4 |
| Invitation and admin reset | Phase 3 Tasks 5–6 |
| Contact and case transactional correctness | Phase 3 Task 7 |
| Mobile universal links | Phase 3 Task 8 |
| Legacy contract retirement | Phase 3 Task 9 |
| Platform health, domains, templates, queue, suppression | Phase 4 Tasks 1–3 |
| Alerts, readiness, canary, runbooks | Phase 4 Task 5 |
| Tenant policy, audiences, quotas, campaigns | Phase 5 Tasks 1–4 |
| Tenant console and preferences | Phase 5 Tasks 5–6 |
| Platform double opt-in and marketing | Phase 6 Tasks 1–3 |
| One-click unsubscribe and privacy-safe clicks | Phase 6 Task 4 |
| Marketing console and evidence gate | Phase 6 Tasks 5–6 |

### Placeholder scan

The new plan documents contain no unresolved placeholder markers or deferred implementation instructions. Ellipses appear only in executable TypeScript spread syntax inside test examples.

### Type consistency

The plans consistently use the approved `EmailMessageClass`, `EmailDeliveryChannel`, `EmailOutboxStatus`, `EnqueueResult`, and server symbol names. Phase 2 defines encryption and outbox contracts before Phase 3 auth intent and Phase 5/6 campaign producers consume them. Phase 6 test filenames use `.test.ts` consistently.

### Scope check

The design is decomposed into six ordered plans. Each phase has its own schema boundary, test set, verification command set, and stop condition; no phase depends on an unbuilt later phase.

