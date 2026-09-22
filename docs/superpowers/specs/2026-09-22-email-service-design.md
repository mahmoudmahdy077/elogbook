# Enterprise Email Service — Design

**Design status:** Approved 2026-09-22
**Approach:** A — Centralized enterprise mailer (Resend primary + SMTP fallback, platform-only admin)
**Scope:** Full transactional + marketing (invites, contact alerts, case approval, digests, newsletters, auth reliability)

---

## 1. Current state audit (2026-09-22)

No app-level email service exists. Verified by codebase search:

- Zero provider code: no `resend`, `nodemailer`, `sendgrid`, `postmark`, `SES` in `apps/`, `packages/`, `supabase/functions/` (only hit is `SmtpError` mapping in `apps/web/lib/error-messages.ts:16`).
- SMTP unconfigured: `apps/web/lib/setup/supabase-installer.ts:107-112` writes `SMTP_HOST=`, `SMTP_USER=`, `SMTP_PASS=` empty, `SMTP_ADMIN_EMAIL=admin@example.com` placeholder. No email vars in `.env.example`, `docker-compose.yml`, or `packages/env/src/index.ts` validation.
- Admin control is zero: `app/(authenticated)/[tenant]/admin/` has overview, retention, scim, sso, templates, webhooks, white-label — no email page. `app/platform/` has tenants + pages only, gated by `requirePlatformAdmin` in `app/platform/layout.tsx`.
- All auth email depends on missing SMTP: magic link `app/login/page.tsx:124` (`signInWithOtp`), password reset `app/login/page.tsx:40` (`resetPasswordForEmail`), signup `app/signup/SignupForm.tsx:50`, invite `app/api/[tenant]/admin/invite/route.ts:45` (`admin.createUser` then returns fake `Invitation sent to ${email}` with no delivery verification, no resend path).
- Contact form is DB-only: `app/api/contact/route.ts:41` inserts into `contact_submissions`, notifies nobody.
- Notifications are push/in-app only: `apps/web/lib/notifications.ts` sends Expo Push + `notifications` table rows (table created in `supabase/migrations/00083_onboarding_steps.sql:25`). No email fallback.

**Verdict:** BROKEN for self-hosted/production (GoTrue cannot deliver without SMTP). Works on Supabase Cloud only via shared rate-limited mailer. No queue, no logs, no templates, no bounce handling, no admin visibility.

---

## 2. Goals and non-goals

Goals:
- Reliable delivery for invites, contact alerts, case approval fallback, digests, newsletters with retry and audit trail.
- Platform-operator control: provider health, queue depth, logs, templates, test-send, suppressions.
- Resend primary, generic SMTP fallback (self-hosted relay compatible).
- Truthful invite status (queue id, no false "sent" claims).
- Bounce/complaint/unsubscribe suppression enforced before every send.

Non-goals:
- Re-implementing Supabase Auth emails (magic link, OTP, reset, signup confirm stay GoTrue-owned; this project only fixes their SMTP config and documents templates).
- Tenant self-service domains/keys in v1 (platform-only per decision).
- Dedicated worker infra (no BullMQ/Redis hard dependency; reuse existing `single-instance` Map / `distributed` Upstash rate-limit pattern).

---

## 3. Architecture

New `mailer` module in `packages/shared/src/email/` with a transport interface:

```ts
interface MailTransport { name: 'resend' | 'smtp'; send(msg: OutboundMessage): Promise<{ id: string }> }
async function send(msg: OutboundMessage): Promise<{ id: string; via: 'resend' | 'smtp' }>
```

`send()` tries Resend first; on network error or 5xx it fails over to SMTP (Nodemailer). 4xx from Resend (invalid address, suppressed) does not fail over — it is logged as rejected.

All app-originated email is enqueued, never sent inline in request handlers, except the platform test-send path which sends synchronously for immediate feedback. A `POST /api/platform/email/process` route (invoked by cron: Vercel Cron in cloud, host cron hitting the endpoint with a `CRON_SECRET` in self-host) drains `email_queue` rows in `pending` state ordered by `priority DESC, created_at ASC`, with per-run cap of 50 and per-domain throttling.

Existing patterns reused: `checkRateLimit`/`rateLimitResponse` from `@/lib/rate-limit-redis`, `requirePlatformAdmin` from `@/lib/supabase/require-platform-admin`, `requireTenantAdmin` for invite enqueue, `audit_logs` inserts for admin actions, `PlatformLayout` shell for UI.

---

## 4. Components

### 4.1 Database (4 new tables, RLS service-role only + platform-admin read via service role in routes)

- `email_queue(id uuid pk, template_key text, to_email text, to_name text nullable, tenant_id uuid nullable, payload jsonb, priority int default 0, status text default 'pending', attempts int default 0, next_retry_at timestamptz default now(), last_error text nullable, resend_id text nullable, created_at timestamptz default now())`. Index on `(status, next_retry_at, priority)`.
- `email_logs(id uuid pk, queue_id uuid references email_queue, to_email text, template_key text, provider text, provider_id text nullable, status text, error text nullable, opened_at timestamptz nullable, clicked_at timestamptz nullable, created_at timestamptz default now())`.
- `email_templates(key text pk, subject text, html text, text text nullable, version int default 1, active boolean default true, updated_by uuid nullable, updated_at timestamptz default now())`. Seed keys: `invite.welcome`, `contact.admin-alert`, `case.approved`, `case.rejected`, `case.pending-review`, `digest.weekly`, `newsletter.generic`, `auth.invite-fallback-note`.
- `email_suppressions(email text pk, reason text check (reason in ('bounce','complaint','unsubscribe')), tenant_id uuid nullable, created_at timestamptz default now())`.

RLS: enable RLS on all four, no public policies; all access via service-role client in API routes. No tenant policies in v1 (platform-only admin).

### 4.2 Library (`packages/shared/src/email/`)

- `types.ts` — `OutboundMessage`, `TemplateKey`, queue row types.
- `resend.ts` — Resend HTTP send via `RESEND_API_KEY`, sets `List-Unsubscribe` header for bulk keys.
- `smtp.ts` — Nodemailer transport from `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`.
- `send.ts` — failover orchestrator + suppression pre-check hook.
- `queue.ts` — `enqueue(template_key, to, payload, opts)` inserts to `email_queue` after suppression check.
- `templates.ts` — `render(key, payload)` returns `{ subject, html, text }` with `{{variable}}` interpolation and HTML escaping; missing variable throws (fail-closed, never sends half-rendered mail).
- `suppressions.ts` — `isSuppressed(email)` lookup; `suppress(email, reason)` upsert.

Web app imports via workspace package (same pattern as `@elogbook/shared` components used in `app/login/page.tsx:8`).

### 4.3 Env (`packages/env/src/index.ts` + `.env.example` + installer)

New vars, all server-only (no `NEXT_PUBLIC_` prefix):
- `RESEND_API_KEY` (optional in dev, required in production unless `EMAIL_PROVIDER=smtp-only`).
- `EMAIL_PROVIDER` enum `resend+smtp | smtp-only`, default `resend+smtp`.
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (e.g. `E-Logbook <noreply@elogbook.example>`), `EMAIL_REPLY_TO`.
- `EMAIL_CRON_SECRET` for the process endpoint.
- `EMAIL_RATE_PER_MIN` default 60.

`supabase-installer.ts` fix: replace empty SMTP placeholders with values carried from setup wizard answers (or explicit empty-with-warning), and set `GOTRUE_MAILER_*` mapping correctly for the self-hosted Supabase bundle. Document GoTrue template overrides in `docs/upgrade/runbooks/install.md`.

### 4.4 API routes (`apps/web/app/api/`)

- `POST /api/platform/email/process` — cron auth via `EMAIL_CRON_SECRET`, drains queue, writes `email_logs`, updates queue status (`sent`/`retry`/`failed`), respects suppressions.
- `POST /api/platform/email/test` — platform admin only, rate-limited (5/min/IP + operator), synchronous send to one address, returns `{ id, via }`.
- `GET /api/platform/email/logs` — paginated logs (limit 50, cursor), to-domain masking for non-operator fields.
- `GET /api/platform/email/templates` + `PUT /api/platform/email/templates/[key]` — list/update with zod validation (subject max 200, html max 100KB), version bump, audit log write.
- `GET /api/platform/email/suppressions` + `DELETE /api/platform/email/suppressions` — list/remove (resubscribe) with audit log.
- `POST /api/platform/email/webhook` — Resend `email.bounced`/`email.complained`/`email.unsubscribed` events verified by Resend signature header, upserts suppressions.
- Modified: `app/api/[tenant]/admin/invite/route.ts` — after `admin.createUser`, enqueue `invite.welcome` with onboarding link, return `{ success: true, queued: queueId }` instead of false "sent" claim; on `createUser` error return 400 as today.
- Modified: `app/api/contact/route.ts` — after `contact_submissions` insert, enqueue `contact.admin-alert` to `CONTACT_ALERT_TO` (new env, defaults to `EMAIL_FROM`).
- Modified: approval paths (`app/api/[tenant]/approvals/action/route.ts`, `(authenticated)/[tenant]/cases/[id]/submit/route.ts`) — after in-app + push notify, enqueue email fallback when recipient has no active push token.

All admin routes: `validateOrigin` + `requirePlatformAdmin` (platform) or `requireTenantAdmin` (invite), `content-length` 64KB cap, `checkRateLimit` per route.

### 4.5 UI (`app/platform/email/page.tsx` + components)

Single platform page reusing `PlatformLayout`, four sections:
1. Status card: provider (`resend+smtp`), Resend reachability (last test-send result), queue depth (`pending` count), last worker run, last error.
2. Logs table: time, template, to-domain, provider, status, error excerpt. Server component, 50-row pages.
3. Template editor: key selector, subject + HTML textarea, preview (rendered with sample payload), save (PUT), version display.
4. Test-send + suppressions: email input + template picker + send button (rate-limited), suppression table with remove buttons.

No tenant-facing UI in v1. Follows existing `platform/page.tsx` table + panel styling (`rounded-14 border border-border bg-surface`).

---

## 5. Data flow

1. Producer (invite/contact/approval/digest/newsletter cron) calls `enqueue()` → suppression check → `email_queue` insert (`pending`).
2. Cron hits `POST /api/platform/email/process` with `EMAIL_CRON_SECRET` → selects up to 50 `pending` rows where `next_retry_at <= now()` ordered by priority → for each: re-check suppression → `render()` → `send()` (Resend, fail over to SMTP) → insert `email_logs`, update queue to `sent` (or `retry` with `next_retry_at = now + backoff`, or `failed` after 3 attempts).
3. Resend webhook events → suppressions upsert → future enqueues for that address are skipped and logged as `suppressed`.
4. Unsubscribe: bulk templates include `List-Unsubscribe: <https://site/api/email/unsubscribe?token=>` with HMAC token (`APP_ENCRYPTION_KEY`); `GET /api/email/unsubscribe` upserts suppression and renders confirmation page.

Invite flow detail: `admin.createUser` (Supabase sends its own invite mail if GoTrue SMTP works) + app `invite.welcome` queue row with tenant name, role, onboarding URL. If GoTrue SMTP is down the user still gets the app welcome with a recovery link; route response includes `queued` id so operators can trace in `/platform/email` logs.

---

## 6. Error handling and security

- Retry: attempts 1 immediate, 2 after 5 min, 3 after 30 min, then `failed` (dead-letter, visible in admin UI, never auto-retried again).
- 4xx from provider (bad address, suppressed, validation) → `failed` immediately, no retry.
- Template render throw → `failed` with `last_error = template: <detail>`, no send.
- Rate limits: test-send 5/min per operator IP; bulk enqueue per tenant 200/hour; process route 1 concurrent (advisory lock via `pg_try_advisory_lock`).
- Auth: platform routes require `requirePlatformAdmin` (active platform_admin + AAL2, same as `PlatformLayout`); webhook requires Resend signature verification; unsubscribe requires HMAC token; process route requires `EMAIL_CRON_SECRET`.
- Secrets: keys only in server runtime, never `NEXT_PUBLIC_`; validated in `packages/env`; missing `RESEND_API_KEY` in `resend+smtp` mode fails closed at boot with explicit error (same pattern as `RATE_LIMIT_MODE` validation).
- Audit: every template update, suppression removal, and test-send writes `audit_logs` (`action` in `email.template.update`, `email.suppression.remove`, `email.test`).
- Privacy: logs list view masks local-part (`j***@hospital.org`); full address only in row detail for operators; payload JSON excludes PII beyond to_name; retention 90 days via scheduled delete (same pattern as retention admin section).

---

## 7. Testing

- Unit (`packages/shared` vitest): transport failover (Resend 500 → SMTP called), 4xx no-failover, template interpolation + escaping + missing-variable throw, suppression check short-circuit.
- Route integration (`apps/web` vitest): process drains pending → sent + log row; retry backoff timestamps; webhook bounce → suppression row; test-send rate-limit 429; invite route returns `queued` id and inserts queue row (mock service-role).
- E2E (playwright, platform): operator logs in, visits `/platform/email`, sends test mail (mocked provider in preview), edits template, removes suppression.
- Manual verification: `RESEND_API_KEY` sandbox key sends to verified address; SMTP fallback verified by stopping Resend key (invalid key → SMTP path in logs with `via: smtp`).

---

## 8. Rollout (3 phases, no breaking changes)

- Phase 1 (reliability fix): env schema + `.env.example` + installer SMTP fix + GoTrue template docs + invite truthfulness (`queued` id) + contact admin alert. Push/in-app untouched.
- Phase 2 (enterprise core): queue/logs/templates/suppressions tables + mailer lib + process cron + platform UI + test-send + webhook.
- Phase 3 (full marketing): digest + newsletter producers, unsubscribe flow, bulk throttling, retention job.

Rollback: each phase is additive; disabling cron stops Phase 2+ sends; Phase 1 installer change is config-only and reversible.

---

## 9. Spec self-review

- Placeholders: none — all table columns, routes, env names, retry timings, caps are concrete.
- Consistency: platform-only admin throughout (no tenant email UI contradicts nothing); Supabase Auth stays GoTrue-owned (no duplicate auth mailer); queue is the single send path for app mail (no direct-send exceptions except test-send, which is explicit).
- Scope: single plan-sized (mailer lib + 4 tables + 6 routes + 1 page + 3 producer edits); digests/newsletters are Phase 3 producers on the same queue, not separate systems.
- Ambiguity: provider mode enum resolves Resend-vs-SMTP question; `failed` is terminal (no silent requeue); log masking rule is explicit.
