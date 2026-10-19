# Enterprise Email Platform — Design

**Design status:** Approved 2026-09-24  
**Supersedes:** `docs/superpowers/specs/2026-09-22-email-service-design.md`  
**Primary deployments:** Docker Compose and Vercel  
**Providers:** Resend primary, generic SMTP failover, Supabase Auth/GoTrue SMTP for authentication messages  
**Administration:** Platform administrators and tenant administrators with separate authority boundaries  
**Content boundary:** Non-PHI only for tenant bulk and platform marketing

---

## 1. Decision summary

The project will implement one centralized, provider-neutral email platform with isolated message classes and policy lanes:

1. Essential transactional mail
2. Security transactional mail
3. Platform marketing mail
4. Tenant operational bulk mail

The system uses a durable PostgreSQL outbox, atomic claims and leases, provider adapters, signed delivery webhooks, scoped suppression, consent snapshots, tenant quotas, and separate administrative views for platform and tenant operators.

Supabase Auth remains the only system that creates authentication sessions and authentication tokens. GoTrue sends verification, magic-link, recovery, and invitation messages through its SMTP configuration. The application records authentication-email intent, operational state, and failures without copying authentication tokens into application logs or ordinary queue payloads.

Marketing and tenant bulk content must not contain PHI, ePHI, patient identifiers, case data, or tenant-confidential clinical information.

---

## 2. Current-state findings

The current working tree contains a partial email foundation:

- Resend and SMTP adapters
- A PostgreSQL email queue
- Operational logs
- Global templates
- A suppression table
- A queue processor
- Provider webhook handling
- A platform operations page
- Template editing and synchronous test send
- A small number of transactional producers

It is not production-ready. The implementation contains the following release blockers.

### 2.1 Delivery and queue blockers

- The production Docker environment omits required email variables, so startup validation can fail.
- No checked-in scheduler invokes the queue processor.
- The advisory-lock RPC used by the processor is not deployed.
- Queue rows are selected before being claimed, so concurrent workers can send the same message.
- A crash after provider acceptance and before the database status update can resend the message.
- Queue rows have no unique idempotency key.
- Resend `401`, `429`, and other provider responses are classified too broadly.
- Resend and SMTP transports have no explicit timeout or cancellation contract.
- `EMAIL_RATE_PER_MIN`, `EMAIL_REPLY_TO`, and other declared settings are not used.
- Queue updates and log inserts frequently ignore returned Supabase errors.
- Terminal failures have no complete operator retry or cancellation workflow.

### 2.2 Webhook blockers

- Every event other than complaint and unsubscribe is treated as a bounce.
- Delivered, opened, or clicked events can incorrectly suppress a recipient.
- Only the first recipient is processed.
- There is no event allowlist, replay window, or provider-event deduplication.
- Delivery logs are not updated from webhook events.
- Webhook and queue routes can be blocked by browser-oriented CSRF middleware before their machine authentication runs.

### 2.3 Authentication and invitation blockers

- Password recovery redirects to the dashboard instead of an update-password screen.
- Magic-link login can create a new user for an unknown email address.
- Admin password reset generates a link, discards it, and falsely reports that email was sent.
- Tenant invitation can create an Auth user before the profile insert, then leave an orphaned user after a duplicate-profile failure.
- Invitation links do not provide a usable password or acceptance path.
- Mentor and bulk invitations create database rows but do not send email.
- Invite query parameters are not consumed by signup.
- Mobile has no complete email confirmation, invitation, or recovery landing path.

### 2.4 Marketing and consent blockers

- No campaign, audience, scheduling, or campaign-membership model exists.
- Marketing consent is stored but not enforced by the worker.
- Tenant bulk policy and platform marketing policy are not separated.
- Suppression is global and can block essential transactional mail.
- Marketing unsubscribe uses a state-changing GET with a deterministic, non-expiring token.
- One-click unsubscribe and a user preference center are absent.
- Platform operations lack suppression, queue, domain, campaign, and provider-health controls.
- Tenant administrators have no email console.
- Open and click columns are not connected to a coherent analytics design.

### 2.5 Privacy and compliance blockers

- Queue and suppression tables store plaintext addresses and payloads.
- Email addresses are not redacted from all operational logs.
- Public contact messages can be copied into external email content.
- Queue payloads and logs lack complete recurring retention and deletion.
- Platform email audit records are written under an operator's unrelated home tenant.
- Email tables do not consistently use forced RLS.
- Arbitrary operator-supplied HTML and test recipients make the test endpoint an unsafe manual-send primitive.

---

## 3. Goals

- Deliver authentication, invitation, security, and operational messages reliably.
- Provide platform marketing and tenant operational bulk mail.
- Enforce platform opt-in, tenant opt-out, and essential-message exemptions separately.
- Prevent PHI and clinical data from entering marketing or tenant bulk content.
- Support a shared verified platform domain and verified custom tenant domains.
- Run safely on Docker Compose and Vercel.
- Use Resend as the primary application provider and generic SMTP as failover.
- Keep provider credentials in the host secret manager.
- Give platform operators full infrastructure and campaign control.
- Give tenant administrators safe control over their own non-PHI mail.
- Provide user preference, unsubscribe, confirmation, and recovery experiences on web and mobile.
- Produce append-only, tenant-safe audit evidence.
- Make queue processing observable, recoverable, and idempotent within provider capabilities.
- Migrate the existing system without silently losing queued messages.

---

## 4. Non-goals

- Reimplementing Supabase Auth token generation or session security.
- Sending PHI, ePHI, patient identifiers, case content, or clinical decision details through external providers.
- Allowing tenant administrators to edit provider credentials or global infrastructure policy.
- Guaranteeing mathematically exactly-once SMTP delivery when a provider accepts a message but the response is lost.
- Implementing an open-tracking pixel.
- Adding BullMQ, Redis job storage, or a separate campaign microservice in the first production release.
- Supporting arbitrary tenant-authored template variables.
- Reusing a marketing unsubscribe to suppress essential account or security messages.

---

## 5. Architecture

```text
Web, mobile, and server-side producers
  ├─ Essential transactional
  ├─ Security transactional
  ├─ Platform marketing
  └─ Tenant operational
             │
             ▼
Business transaction + email outbox
  ├─ template revision snapshot
  ├─ consent and preference snapshot
  ├─ tenant and domain scope
  ├─ deterministic idempotency key
  └─ encrypted recipient and render context
             │
             ▼
Atomic claim and lease worker
  ├─ essential lane
  ├─ tenant lane
  └─ platform campaign lane
             │
             ▼
Policy recheck
  ├─ account status
  ├─ tenant membership
  ├─ consent or opt-out
  ├─ scoped suppression
  ├─ quotas
  └─ domain status
             │
             ▼
Provider adapter
  ├─ Resend application mail
  ├─ generic SMTP failover
  └─ Supabase Auth/GoTrue SMTP
             │
             ▼
Signed delivery webhooks
  ├─ accepted and delivered
  ├─ hard bounce and complaint
  ├─ unsubscribe
  └─ delivery reconciliation
```

The application uses one platform and one durable job store. Message classes are isolated logically and operationally so campaign traffic cannot starve essential traffic.

This design provides at-least-once processing, deterministic business idempotency, provider idempotency where supported, and webhook reconciliation. It does not claim exactly-once delivery across an ambiguous SMTP network boundary.

---

## 6. Message classes and policy matrix

| Class | Examples | Consent | Unsubscribe | Hard bounce | Complaint | Scope |
|---|---|---:|---:|---:|---:|---|
| `essential_transactional` | Invitation, recovery, case decision, account action | No | No | Blocks until verified | Does not block | User or tenant |
| `security_transactional` | Password/security alerts, domain or account risk | No | No | Blocks until verified | Does not block | User |
| `platform_marketing` | Product education, release notes, security newsletter | Explicit opt-in | Required | Blocks | Blocks | Platform |
| `tenant_operational` | Tenant announcements and approved non-PHI bulk notices | Tenant opt-out | Required | Blocks | Blocks | Tenant |

Additional rules:

- A platform marketing send requires an active account and current platform-marketing opt-in.
- A tenant operational send requires an active tenant membership and no tenant-specific opt-out.
- A tenant send cannot target a user outside its tenant.
- Marketing consent and tenant preference snapshots are recorded at enqueue and revalidated at dispatch.
- A hard bounce blocks all classes until an authorized operator verifies or clears the address.
- Marketing complaint and unsubscribe states never block essential or security messages.
- Platform and tenant administrators cannot manually bypass a hard bounce without an audited verification action.
- Test sends are restricted to the operator's own address or an explicit QA allowlist.

---

## 7. Data model

The migration follows expand, backfill, dual-write, and contract phases. Existing queue data is migrated before the legacy table is retired.

### 7.1 `email_system_settings`

Single global settings row:

- `id`
- `enabled`
- `platform_marketing_enabled`
- `tenant_mail_enabled`
- `default_domain_id`
- `default_reply_to_email`
- `tenant_campaign_recipient_limit`
- `tenant_daily_recipient_limit`
- `platform_campaign_recipient_limit`
- `platform_daily_recipient_limit`
- `queue_retention_days`
- `log_retention_days`
- `audit_retention_days`
- `updated_by`
- timestamps

Initial limits:

- Tenant campaign: 500 recipients
- Tenant daily total: 2,000 recipients
- Platform campaign: 50,000 recipients
- Platform daily total: 100,000 recipients
- Essential traffic is quota-exempt but remains abuse-rate-limited

### 7.2 `email_domains`

- Identity and scope: `id`, `scope`, optional `tenant_id`
- `hostname`
- `provider_domain_id`
- `status`: `pending`, `verifying`, `verified`, `failed`, `disabled`
- `spf_status`, `dkim_status`, `dmarc_status`
- `is_default`
- `verified_at`
- creator and timestamps

A unique normalized hostname prevents duplicate domains. Only verified, active domains can be selected for sending.

### 7.3 `email_templates` and `email_template_revisions`

`email_templates` stores identity and lifecycle:

- `id`, `scope`, optional `tenant_id`
- `template_key`
- `message_class`
- `name`
- `active_revision_id`
- `is_active`
- creator and timestamps

`email_template_revisions` stores immutable content:

- `id`, `template_id`, `version`
- `subject`
- `html`
- `text`
- `allowed_variables`
- `content_sha256`
- `created_by`
- `created_at`

A database trigger prevents updates and deletes to published revisions. Queue rows reference an exact revision so later edits cannot change an in-flight message.

### 7.4 `email_preferences`

- `user_id`
- nullable `tenant_id`
- `platform_marketing_opt_in`
- `tenant_mail_opt_out`
- `policy_version`
- `consent_source`
- `consented_at`
- timestamps

Global preferences use `tenant_id IS NULL`. Tenant preferences use the specific tenant ID. Essential and security delivery cannot be disabled by these controls.

### 7.5 `email_campaigns`

- `id`, `scope`, optional `tenant_id`
- `name`
- `message_class`
- `template_revision_id`
- optional subject override
- structured `audience_definition`
- `status`: `draft`, `scheduled`, `materializing`, `sending`, `paused`, `completed`, `canceled`, `failed`
- `scheduled_at`
- start and completion timestamps
- `created_by`
- `idempotency_key`
- recipient counters
- last sanitized error code

Audience definitions are validated structured data, not SQL fragments. Supported filters are account status, tenant membership, tenant role, and platform-marketing preference.

### 7.6 `email_outbox`

- `id`
- `message_class`
- `delivery_channel`: `app_provider` or `supabase_auth`
- `scope`, optional `tenant_id`, optional `campaign_id`
- optional `user_id`
- encrypted recipient address and optional recipient name
- recipient HMAC and masked address
- encrypted render context
- template and template revision IDs
- consent and preference snapshot
- `status`: `pending`, `claimed`, `retry_wait`, `accepted`, `delivered`, `suppressed`, `failed`, `dead_letter`, `canceled`
- `priority`
- `attempts`, `max_attempts`
- `next_attempt_at`
- `lease_owner`, `lease_expires_at`, `fence`
- selected provider and provider message ID
- `idempotency_key`
- accepted, delivered, updated, and purge timestamps

A unique `idempotency_key` prevents duplicate producer intent. Critical business events use deterministic values such as `case:<entry-id>:approved:<version>`.

### 7.7 `email_delivery_events`

- `id`
- unique provider event ID
- `outbox_id`
- `event_type`
- `provider_message_id`
- recipient HMAC
- provider timestamp
- sanitized metadata
- created timestamp

Allowed application events are `accepted`, `delivered`, `hard_bounced`, `soft_bounced`, `complained`, and `unsubscribed`. No raw address or provider payload is retained.

### 7.8 `email_suppressions`

- `id`
- scope: `global`, `platform`, or `tenant`
- optional `tenant_id`
- recipient HMAC
- reason: `hard_bounce`, `complaint`, `unsubscribe`, or `manual`
- source
- `active`
- optional expiry
- creator and timestamps
- sanitized metadata

Uniqueness is enforced for scope, tenant, recipient HMAC, and reason.

### 7.9 `email_worker_heartbeats`

- `worker_id`
- deployment ID
- worker version
- started and last-seen timestamps
- sanitized worker metadata

Heartbeats contain no recipient or message data.

### 7.10 `email_test_recipients`

- `id`
- scope: `platform` or `tenant`
- optional `tenant_id`
- recipient HMAC and masked address
- label
- `active`
- creator and timestamps

An operator's own authenticated address is always allowed. Every other test recipient must have an active allowlist row. Test sends cannot become arbitrary campaign or recipient discovery endpoints.

### 7.11 `email_admin_audit`

- monotonically increasing ID
- actor user and platform/tenant role
- scope and optional tenant ID
- action
- resource type and ID
- outcome
- sanitized metadata
- timestamp

This table is append-only and independent of tenant `audit_logs`, preventing platform activity from leaking into an operator's home tenant.

### 7.12 Tenant invitation changes

Existing `tenant_invites` gains:

- normalized email HMAC
- token hash
- expiry and accepted timestamps
- inviter user ID
- intended role
- delivery version
- explicit failed and superseded states

A partial unique index permits only one active invitation per tenant and normalized email.

---

## 8. Encryption and secret boundaries

### 8.1 Application data encryption

Recipient addresses, recipient names, and render context use versioned AES-256-GCM encryption implemented in the Node server runtime.

Host-managed settings:

- `EMAIL_DATA_ENCRYPTION_KEYS`
- `EMAIL_DATA_ACTIVE_KEY_VERSION`
- `EMAIL_LOOKUP_HMAC_KEY`
- `EMAIL_TOKEN_SIGNING_SECRET`

Encryption records include a key version and authentication tag. Key rotation decrypts with an old key and re-encrypts with the active key without exposing plaintext.

The existing unverified PostgreSQL encryption GUC path is not used for new email data.

### 8.2 Provider secrets

Provider secrets remain in the host secret manager:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `EMAIL_CRON_SECRET`
- GoTrue mailer credentials and sender configuration

The admin UI can show whether required values are present and run tests, but cannot read or return secret values.

### 8.3 Logging

Operational logs contain:

- masked address
- recipient HMAC prefix
- tenant and campaign IDs
- template key and revision
- message class
- provider result and latency
- sanitized error code

They never contain plaintext address, render context, password, recovery token, invitation token, raw provider body, or message body.

---

## 9. Queue and worker design

### 9.1 Atomic claim

A PostgreSQL RPC claims messages with `FOR UPDATE SKIP LOCKED`. Each claim assigns:

- worker ID
- lease expiry
- monotonically increasing fence

Completion and failure updates require the current fence. Expired claims return to eligible work automatically.

### 9.2 Transactional outbox

Critical business operations write outbox intent in the same database transaction as the business change. Existing case-operation RPCs are extended rather than followed by a second non-transactional insert.

Non-critical route producers use a single server-side enqueue service that checks returned database errors and returns an explicit queued, suppressed, or failed result.

### 9.3 Scheduling

Docker Compose runs a dedicated pinned email worker service. Vercel Cron calls a GET-compatible internal processor route with bearer authentication. Both use the same processor module and database RPCs.

The internal route is narrowly exempted from browser CSRF origin checks. It still requires the scheduler secret, request-size limits, and audit-safe logging.

### 9.4 Retry policy

- Network errors, `408`, `425`, `429`, and `5xx` are retryable.
- `Retry-After` takes precedence.
- Other retry delays use exponential backoff with jitter, a 5-minute base, and a 6-hour cap.
- Default maximum attempts: 8 over 48 hours.
- Permanent recipient or template validation errors become `failed`.
- Provider authentication and configuration errors open a provider circuit and pause new claims for that provider.
- Exhausted retryable messages become `dead_letter`.
- Authorized operators can retry, cancel, or inspect dead letters.

### 9.5 Fairness

Essential and security messages have reserved capacity and higher priority. Tenant and platform campaign claims are capped independently. A campaign pause or provider circuit does not stop essential traffic.

### 9.6 Maintenance

The worker performs daily maintenance:

- purge expired queue payloads
- purge terminal rows beyond retention
- enforce audit and log retention
- remove expired suppression records where policy allows
- report worker heartbeat

No additional scheduler is required for retention.

---

## 10. Provider adapters

Each adapter implements:

```ts
interface EmailTransport {
  name: 'resend' | 'smtp' | 'supabase_auth';
  send(message: RenderedEmail, context: SendContext): Promise<TransportResult>;
  health(context: HealthContext): Promise<TransportHealth>;
}
```

### 10.1 Resend

- Explicit connect and total timeout
- Idempotency header derived from outbox ID
- Request ID retained in sanitized logs
- `Retry-After` captured
- RFC 8058 unsubscribe headers for bulk mail
- Plain-text alternative required
- Custom sending domain selected from verified domain state

### 10.2 SMTP

- Nodemailer transport
- Explicit connection and socket timeouts
- STARTTLS required for non-secure submission ports
- Deterministic `Message-ID` per outbox row
- Provider-neutral accepted/rejected/ambiguous result
- No promise of exactly-once delivery

### 10.3 Supabase Auth

The application asks GoTrue to issue and send official authentication messages. It does not generate or store GoTrue recovery or invitation tokens.

Admin-initiated recovery calls the supported GoTrue delivery action. The response is used for truthful queued/accepted/failed state, while actual delivery remains subject to SMTP and provider events where available.

---

## 11. Authentication, invitation, and adjacent flows

### 11.1 Signup and confirmation

- Signup validation remains server-side and rate-limited.
- The success state distinguishes confirmation-required from already-confirmed/autoconfirm development modes.
- Confirmation resend uses an explicit rate limit and does not reveal whether an arbitrary account exists.
- The email link uses an allowlisted HTTPS callback.
- Mobile universal links open the native app when installed and a secure web callback otherwise.

### 11.2 Magic link

- `shouldCreateUser` is always false.
- The operation is rate-limited by IP and normalized email hash.
- The success response does not disclose account existence.
- MFA enforcement occurs before honoring any requested `next` path.

### 11.3 Password recovery

- Recovery links target `/auth/callback?type=recovery`.
- The callback exchanges the code and redirects to a dedicated `/update-password` screen.
- The screen requires a valid recovery session, validates password strength, updates the password, clears recovery state, and signs out before returning to login.
- Dashboard access is blocked until recovery completes.

### 11.4 Tenant invitation

The invite flow is one idempotent operation:

1. Normalize and validate the address.
2. Create or update the active `tenant_invites` record.
3. Ask GoTrue to issue the official invitation action appropriate to the account state.
4. Record encrypted, minimal delivery intent and queue status.
5. Return `queued`, `resent`, `already_pending`, or a truthful failure.
6. Roll back or mark failed any partially created Auth/profile state.
7. Expire unused invitations and supersede replaced invitations.

The application never sends a link to an unauthenticated onboarding page as the only invitation action.

### 11.5 Admin password reset

The admin route triggers GoTrue recovery delivery and reports failure when GoTrue rejects the request. It does not call `generateLink`, discard the result, and return a false success.

### 11.6 Contact submissions

- The API accepts validated form-encoded and JSON bodies.
- Actual body size is enforced while reading, not only through `Content-Length`.
- Institution and message fields are validated and stored.
- Email alerts contain sender metadata and a secure platform-admin link, not free-text message content.
- Queue failure is surfaced to the platform and never converted into a false public success.

### 11.7 Case notifications

Case submission and approval/rejection use database transactions that create approval state and outbox intent together. Notification rows use Auth user IDs. Repeated approval attempts do not enqueue duplicate decision mail. Email fallback is not conditional on push-token presence; push and email are independent channels.

---

## 12. Consent, preferences, and unsubscribe

### 12.1 Platform marketing

- Explicit opt-in only
- Double opt-in for new web subscriptions
- Confirmation links are opaque, expiring, and single-use
- Consent evidence records policy version, source, and timestamp
- Revocation prevents new sends and cancels pending unsent platform campaign messages

### 12.2 Tenant operational mail

- Default allowed for active tenant members
- Tenant-specific opt-out
- Opt-out cancels pending unsent messages for that tenant
- Tenant cannot override a global hard-bounce or manual security suppression

### 12.3 Preference center

Web and mobile expose:

- platform marketing status
- per-tenant operational mail status
- security and essential mail explanation
- policy and privacy links
- resend confirmation and verification actions where applicable

### 12.4 Unsubscribe

Bulk messages include:

- `List-Unsubscribe`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
- an opaque expiring single-purpose token

The POST endpoint updates only the message's authorized scope. A confirmation page may be shown after processing. Link scanners cannot unsubscribe through a GET request.

---

## 13. Content safety and template policy

### 13.1 Allowed variables

System templates may use only approved variables such as:

- first name
- application name
- tenant name
- action URL
- expiry time
- support email

Tenant templates cannot reference case IDs, patient fields, MRNs, dates of birth, diagnoses, evaluation content, or arbitrary database payloads.

### 13.2 HTML

- HTML is sanitized server-side before persistence and again before send.
- Scripts, forms, iframes, objects, embedded applications, and event-handler attributes are prohibited.
- Link schemes are limited to approved HTTPS, mailto, and application-relative routes.
- Remote images are disabled by default.
- A text alternative is mandatory.
- Admin previews render in a sandboxed iframe with a restrictive Content Security Policy.

### 13.3 Non-PHI attestation

Tenant and platform campaign sends require a non-PHI attestation. A conservative content gate blocks obvious identifiers and prohibited clinical labels, but the system does not claim that pattern matching can detect every possible PHI occurrence. Variable allowlists and campaign types remain the primary control.

---

## 14. Platform administration

The platform navigation links to an email console with these areas.

### 14.1 Overview

- provider mode and circuit state
- Resend and SMTP health
- GoTrue SMTP configuration status without secrets
- queue depth and oldest age
- worker heartbeat
- webhook freshness
- accepted, delivered, bounced, complained, and dead-letter counts
- recent configuration and security alerts

### 14.2 Domains

- shared platform domain
- add and verify custom domains
- provider domain ID
- SPF, DKIM, and DMARC status
- default-domain selection
- disable or re-verify domains
- platform audit history

### 14.3 Templates

- system and platform templates
- immutable revision history
- sandboxed preview
- sample-variable validation
- test send to an authorized address
- activate and rollback

### 14.4 Queue operations

- filter by class, tenant, campaign, provider, and status
- inspect sanitized error codes
- retry, cancel, or dead-letter
- no raw recipient or payload display

### 14.5 Suppressions

- global and tenant scope filters
- hard bounce, complaint, unsubscribe, and manual reasons
- expiry and verification state
- audited manual add, clear, and verified resubscribe

### 14.6 Campaigns

- platform-marketing opt-in audience
- draft, preview, schedule, pause, resume, and cancel
- quota and estimated recipient count
- accepted, delivered, hard-bounced, complained, and unsubscribed metrics
- no open-rate metric

### 14.7 Provider configuration

The console exposes non-secret readiness, selected provider, sender identity, and test results. Credentials remain managed by the deployment platform and are never stored in the admin database.

---

## 15. Tenant administration

Tenant administrators receive a tenant-scoped mail console.

### 15.1 Authority

Tenant administrators may:

- create and revise tenant templates
- request and verify a custom sending domain
- select an approved shared or verified tenant domain
- create non-PHI tenant campaigns
- target active members using structured filters
- schedule, pause, and cancel tenant campaigns
- review tenant delivery history and dead letters
- review tenant-specific preferences and suppressions
- send test messages to authorized QA recipients

They cannot:

- read or change provider secrets
- change global kill switches
- send platform campaigns
- target another tenant
- access another tenant's logs or preferences
- send prohibited clinical or patient content

### 15.2 Server authorization

Every tenant email mutation requires:

- authenticated active profile
- active tenant
- `institution_admin` or `admin` role
- AAL2 MFA
- CSRF or origin validation
- body-size and rate limits
- platform or tenant email kill-switch check
- append-only audit event

A UI page redirect is never treated as authorization.

---

## 16. API surface

All request bodies use Zod validation. All mutation routes return explicit queued, accepted, suppressed, canceled, or failed states.

### 16.1 Platform APIs

- `GET /api/platform/email/overview`
- `GET|POST /api/platform/email/domains`
- `POST /api/platform/email/domains/[id]/verify`
- `POST /api/platform/email/domains/[id]/default`
- `DELETE /api/platform/email/domains/[id]`
- `GET|POST /api/platform/email/templates`
- `GET|POST /api/platform/email/templates/[id]/revisions`
- `POST /api/platform/email/templates/[id]/activate`
- `POST /api/platform/email/templates/revisions/[id]/rollback`
- `POST /api/platform/email/test`
- `GET /api/platform/email/outbox`
- `POST /api/platform/email/outbox/[id]/retry`
- `POST /api/platform/email/outbox/[id]/cancel`
- `GET|POST /api/platform/email/suppressions`
- `DELETE /api/platform/email/suppressions/[id]`
- `GET|POST /api/platform/email/campaigns`
- `GET|PATCH|DELETE /api/platform/email/campaigns/[id]`
- `POST /api/platform/email/campaigns/[id]/send`
- `POST /api/platform/email/campaigns/[id]/pause`
- `POST /api/platform/email/campaigns/[id]/resume`
- `POST /api/platform/email/webhook`
- `GET /api/internal/email/process`

### 16.2 Tenant APIs

- `GET /api/[tenant]/email/overview`
- `GET|POST /api/[tenant]/email/domains`
- `POST /api/[tenant]/email/domains/[id]/verify`
- `GET|POST /api/[tenant]/email/templates`
- `POST /api/[tenant]/email/templates/[id]/revisions`
- `POST /api/[tenant]/email/templates/[id]/activate`
- `GET|POST /api/[tenant]/email/campaigns`
- `GET|PATCH|DELETE /api/[tenant]/email/campaigns/[id]`
- `POST /api/[tenant]/email/campaigns/[id]/send`
- `POST /api/[tenant]/email/campaigns/[id]/pause`
- `POST /api/[tenant]/email/campaigns/[id]/resume`
- `GET /api/[tenant]/email/outbox`
- `GET /api/[tenant]/email/suppressions`
- `POST /api/[tenant]/email/test`

### 16.3 User and public APIs

- `GET|PATCH /api/email/preferences`
- `POST /api/email/unsubscribe`
- `GET /api/email/unsubscribe` — read-only confirmation page; it never changes preferences
- `POST /api/email/click`
- `POST /api/auth/signup`
- `POST /api/auth/email/verify`
- `POST /api/auth/email/magic-link`
- `POST /api/auth/email/recovery`
- `POST /api/auth/email/confirmation`
- `POST /api/auth/invitation/accept`

Authentication endpoints are rate-limited by IP, normalized email HMAC, and account-state token where applicable. They return generic responses to prevent account enumeration.

---

## 17. Environment contract

The authoritative server schema includes:

- `EMAIL_ENABLED`
- `EMAIL_PROVIDER`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `EMAIL_REPLY_TO`
- `EMAIL_RATE_PER_MIN`
- `EMAIL_DATA_ENCRYPTION_KEYS`
- `EMAIL_DATA_ACTIVE_KEY_VERSION`
- `EMAIL_LOOKUP_HMAC_KEY`
- `EMAIL_TOKEN_SIGNING_SECRET`
- `EMAIL_CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `CONTACT_ALERT_TO`

Production validation:

- requires HTTPS `NEXT_PUBLIC_SITE_URL`
- requires encryption and token keys when email is enabled
- requires Resend credentials when Resend is enabled
- requires SMTP host and credentials when SMTP is enabled or fallback is required
- requires webhook and scheduler secrets when those paths are enabled
- forbids blank secret values after environment expansion
- validates sender and reply-to as bare addresses, separate from display names
- rejects localhost sender or callback URLs in production

Docker Compose, CI production boot checks, Vercel configuration, setup output, `.env.example`, and environment documentation must be generated from or verified against the same contract.

---

## 18. Deployment

### 18.1 Local

- Mailpit captures Supabase Auth and application messages.
- The email worker runs in the local Compose profile.
- No external provider secret is required.
- Safe autoconfirm mode remains available only outside production.

### 18.2 Staging

- Resend test mode
- Separate staging sending domain
- Staging database and webhook endpoint
- Synthetic recipients only
- No production recipient or tenant data

### 18.3 Docker production

- Dedicated pinned worker service
- Host-managed environment file or secret injection
- Postgres persistence
- Caddy ingress
- Daily worker maintenance
- Graceful worker shutdown and lease recovery

### 18.4 Vercel production

- Vercel Cron invokes the GET processor
- Internal authorization uses the scheduler secret
- Cron frequency is at least once per minute
- Database claim leases make overlapping invocations safe
- Preview and E2E environments use test providers or disabled delivery

### 18.5 Kill switches

Delivery can be paused independently for:

- global application mail
- platform campaigns
- all tenant campaigns
- one tenant
- one domain
- one message class

Security notices and essential recovery operations follow the approved policy and cannot be disabled by tenant controls.

---

## 19. Observability and alerts

### 19.1 Structured events

- message enqueued
- message claimed
- provider attempt
- provider accepted
- delivery webhook
- suppression created
- campaign materialized
- worker heartbeat
- maintenance completed

All events use request, message, campaign, tenant, template, and provider IDs without recipient plaintext.

### 19.2 Metrics and alerts

Alert when:

- oldest pending message exceeds 5 minutes
- no worker heartbeat for two expected intervals
- webhook freshness exceeds 10 minutes
- any provider circuit opens
- dead-letter count is greater than zero
- hard-bounce rate exceeds 2 percent over 24 hours
- complaint rate exceeds 0.1 percent over 24 hours
- queue insert failures occur
- key rotation or encryption failures occur

Metrics aggregate by tenant, domain, template, class, and provider without using raw addresses as metric labels.

---

## 20. Testing strategy

### 20.1 Shared package

- template escaping and missing-variable failure
- HTML sanitization policy
- AES-256-GCM round trip and tamper rejection
- key-version rotation
- HMAC normalization and constant-time comparison
- Resend/SMTP timeout and result mapping
- retry classification and circuit behavior
- unsubscribe and click token expiry and replay

### 20.2 PostgreSQL and pgTAP

- all email tables have RLS and FORCE RLS
- authenticated roles receive no direct table access
- claim uses `SKIP LOCKED`
- two workers cannot claim the same row
- expired leases recover
- stale fences cannot complete work
- idempotency keys are unique
- template revisions are immutable after publish
- tenant campaign audience cannot cross tenant boundaries
- consent and suppression rules are enforced
- retention functions remove only eligible data
- user deletion removes or transforms email data

### 20.3 Route integration

- machine worker and webhook routes pass through proxy behavior
- scheduler authentication fails closed
- webhook event allowlist, timestamp, signature, and event-ID replay protection
- 429 and 5xx retry
- permanent validation failure
- provider circuit behavior
- database errors are not ignored
- admin API role, tenant, AAL2, CSRF, body-size, and rate-limit enforcement
- test-send recipient restrictions

### 20.4 Provider contract tests

- Resend test-mode acceptance and webhook fixture
- SMTP submission through Mailpit
- GoTrue verification, magic-link, recovery, and invitation delivery
- custom-domain rejection behavior
- provider timeout and ambiguous-response behavior

### 20.5 E2E

- web signup and confirmation resend
- existing-user magic link
- unknown-user magic-link rejection without account creation
- recovery through update-password
- tenant invite, resend, expiry, and acceptance
- mobile universal-link fallback
- platform template revision and rollback
- tenant campaign send and opt-out cancellation
- platform campaign opt-in and unsubscribe
- provider webhook reconciliation
- queue retry and dead-letter operator actions

### 20.6 Release gates

Every release phase must pass:

- typecheck
- lint
- unit tests
- route integration tests
- applicable pgTAP tests
- applicable E2E tests
- production build
- migration lint
- dependency security audit
- code security review
- no plaintext secrets, tokens, recipient payloads, or PHI in diffs and logs

---

## 21. Rollout plan

### Phase 1 — Safety and compatibility

- Add the authoritative environment contract.
- Add Mailpit and Compose/Vercel scheduler wiring.
- Fix middleware handling for machine routes.
- Fix webhook event classification, replay protection, and all-recipient processing.
- Add provider timeouts and truthful test-send behavior.
- Introduce global, tenant, and class kill switches.

### Phase 2 — Durable transactional core

- Create expanded email schema and immutable template revisions.
- Add encryption, HMAC, claim, lease, fence, retry, and dead-letter RPCs.
- Dual-write new producers to legacy and new outbox formats.
- Migrate queued legacy rows.
- Switch worker processing to atomic claims.
- Add recurring retention and worker heartbeat.

### Phase 3 — Authentication and transactional correctness

- Fix signup, magic-link, recovery, confirmation, and mobile callback flows.
- Replace the broken tenant invite transaction.
- Make admin reset trigger actual GoTrue delivery.
- Repair contact submission and case notification outbox behavior.
- Add email state and resend actions to user management.

### Phase 4 — Platform operations

- Ship the platform health, domain, template, queue, suppression, and audit console.
- Add verified shared and custom-domain management.
- Add provider health and maintenance controls.
- Run a production canary and deliverability verification.

### Phase 5 — Tenant mail

- Add tenant templates, sender branding, verified domains, quotas, and campaigns.
- Enforce tenant opt-out and non-PHI policy.
- Add tenant console and user preference center.
- Soak tenant delivery before enabling broad use.

### Phase 6 — Platform marketing

- Add double opt-in, platform audiences, scheduling, and campaign analytics.
- Enable platform marketing only after consent, domain, suppression, deliverability, and kill-switch evidence passes.

Each phase is independently deployable and backward compatible. No phase enables a broader message class before its predecessor is stable.

---

## 22. Acceptance criteria

The upgrade is production-ready only when all conditions are true:

- Docker and Vercel production environments pass the same startup contract.
- Every queued message is atomically claimed and recoverable.
- A concurrent worker cannot send the same claimed message.
- Duplicate business events cannot create duplicate outbox intent.
- Resend rate limits and transient failures retry correctly.
- SMTP has bounded timeouts and TLS enforcement.
- Provider webhooks cannot suppress recipients for normal delivery events.
- Replayed webhook events are rejected.
- Marketing unsubscribe cannot block essential mail.
- Tenant campaigns cannot cross tenant boundaries.
- Platform marketing requires explicit opt-in.
- Tenant bulk mail enforces tenant opt-out.
- Queue, logs, and admin views do not expose plaintext recipient addresses or payloads.
- Tenant and platform admin mutations enforce server-side AAL2 and audit.
- Password recovery, invitation, confirmation, and mobile flows work end to end.
- Contact messages are not copied into external email bodies.
- Custom domains cannot send until verified.
- Dead letters, provider circuits, stale workers, and queue age are visible and actionable.
- Retention and user-deletion jobs are recurring and tested.
- All release gates pass.

---

## 23. Spec self-review

- Placeholder scan: no TBD, TODO, or unresolved provider or policy choice remains.
- Consistency: one unified platform is used for all classes; message policy remains consistent across queue, provider, webhook, admin, and user surfaces.
- Authority consistency: platform operators control infrastructure and platform campaigns; tenant operators control only tenant-scoped templates, domains, and campaigns; both require server-side AAL2.
- Consent consistency: platform marketing uses explicit opt-in, tenant bulk uses tenant opt-out, and essential/security classes are separate.
- Scope: the design is intentionally multi-phase. Implementation must be delivered through the phased plan rather than as one unreviewable change set.
- Terminology: `accepted` means the provider accepted the message; `delivered` requires a delivery event. Neither is described as guaranteed inbox placement.
- Security consistency: secrets remain host-managed; tenant content is non-PHI; all mutations are authorized, validated, rate-limited, and audited.
