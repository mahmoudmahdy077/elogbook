# Enterprise Email Phase 1 — Safety and Compatibility Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing email path safe, observable, correctly scheduled, and deployment-complete without enabling tenant campaigns or platform marketing.

**Architecture:** Preserve the legacy queue while introducing the final environment contract, machine-route authentication, typed provider transports, safe webhook processing, read-only GET unsubscribe, restricted test sends, and append-only email audit storage. Docker and Vercel invoke one processor contract.

**Tech Stack:** Next.js 16, TypeScript 6, Zod 4, Supabase Postgres/Auth, Resend HTTP API, Nodemailer, Vitest 4, pgTAP, Docker Compose, Vercel Cron.

---

## Files

**Create**

- `supabase/migrations/20260924000001_email_safety_controls.sql`
- `supabase/tests/p1_22_email_safety_controls.sql`
- `packages/shared/src/email/webhook.ts`
- `packages/shared/src/email/__tests__/webhook.test.ts`
- `packages/shared/src/email/__tests__/resend.test.ts`
- `packages/shared/src/email/__tests__/smtp.test.ts`
- `apps/web/lib/email/scheduler-auth.ts`
- `apps/web/lib/email/kill-switch.ts`
- `apps/web/lib/email/legacy-processor.ts`
- `apps/web/lib/email/__tests__/scheduler-auth.test.ts`
- `apps/web/lib/email/__tests__/kill-switch.test.ts`
- `apps/web/app/api/internal/email/process/route.ts`
- `apps/web/app/api/internal/email/__tests__/process.test.ts`
- `apps/web/app/api/platform/email/__tests__/test-send.test.ts`
- `apps/web/app/api/email/__tests__/unsubscribe.test.ts`
- `scripts/email-worker.mjs`
- `scripts/verify-email-runtime.mjs`
- `docker-compose.local.yml`
- `tests/security/email-containment.test.mjs`

**Modify**

- `packages/env/src/index.ts`
- `apps/web/instrumentation.ts`
- `apps/web/proxy.ts`
- `packages/shared/src/email/types.ts`
- `packages/shared/src/email/send.ts`
- `packages/shared/src/email/resend.ts`
- `packages/shared/src/email/smtp.ts`
- `packages/shared/src/email/templates.ts`
- `packages/shared/src/email/suppressions.ts`
- `packages/shared/src/email/queue.ts`
- `apps/web/app/api/platform/email/webhook/route.ts`
- `apps/web/app/api/platform/email/process/route.ts`
- `apps/web/app/api/platform/email/test/route.ts`
- `apps/web/app/api/contact/route.ts`
- `apps/web/app/api/email/unsubscribe/route.ts`
- `apps/web/app/api/platform/email/logs/route.ts`
- `apps/web/app/api/platform/email/suppressions/route.ts`
- `apps/web/app/platform/email/TestSendForm.tsx`
- `apps/web/app/platform/email/page.tsx`
- `apps/web/lib/logger.ts`
- `apps/web/lib/setup/supabase-installer.ts`
- `apps/web/app/api/setup/deploy-supabase/route.ts`
- `apps/web/Dockerfile`
- `package.json`
- `pnpm-lock.yaml`
- `.env.example`
- `docs/env-reference.md`
- `docs/upgrade/runbooks/install.md`
- `scripts/check-env.mjs`
- `scripts/verify-boot.mjs`
- `docker-compose.yml`
- `vercel.json`
- `.github/workflows/ci.yml`
- `apps/web/public/openapi.yaml`
- `apps/web/lib/__tests__/email-env.test.ts`
- `apps/web/lib/__tests__/env-fail-fast.test.ts`
- `apps/web/app/api/platform/email/__tests__/process.test.ts`
- `apps/web/app/api/platform/email/__tests__/webhook.test.ts`

## Task 1: Establish the authoritative environment contract

- [ ] **Step 1: Write failing environment tests**

Extend `apps/web/lib/__tests__/email-env.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { parseWebFullEnv } from '@elogbook/env';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SITE_URL: 'https://elogbook.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  NODE_ENV: 'production',
  RATE_LIMIT_MODE: 'single-instance',
  TRUSTED_PROXY_HOPS: '1',
  EMAIL_ENABLED: 'true',
  EMAIL_PROVIDER: 'resend+smtp',
  EMAIL_FROM_ADDRESS: 'noreply@elogbook.example',
  EMAIL_FROM_NAME: 'E-Logbook',
  EMAIL_REPLY_TO: 'support@elogbook.example',
  EMAIL_DATA_ENCRYPTION_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}',
  EMAIL_DATA_ACTIVE_KEY_VERSION: '1',
  EMAIL_LOOKUP_HMAC_KEY: 'lookup-secret-with-at-least-32-bytes',
  EMAIL_TOKEN_SIGNING_SECRET: 'token-secret-with-at-least-32-bytes',
  EMAIL_CRON_SECRET: 'cron-secret-with-at-least-32-bytes',
  RESEND_API_KEY: 'resend-key',
  RESEND_WEBHOOK_SECRET: 'webhook-secret',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  CONTACT_ALERT_TO: 'alerts@elogbook.example',
  EMAIL_RATE_PER_MIN: '60',
};

describe('email environment', () => {
  it('accepts the complete production contract', () => {
    expect(parseWebFullEnv(valid).EMAIL_FROM_ADDRESS).toBe('noreply@elogbook.example');
  });

  it('rejects localhost callback URLs in production', () => {
    expect(() => parseWebFullEnv({ ...valid, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toThrow(/HTTPS/);
  });

  it('rejects display-name sender values in EMAIL_FROM_ADDRESS', () => {
    expect(() => parseWebFullEnv({ ...valid, EMAIL_FROM_ADDRESS: 'E-Logbook <noreply@elogbook.example>' })).toThrow();
  });

  it('requires Resend credentials when Resend is enabled', () => {
    const { RESEND_API_KEY: _removed, ...withoutResend } = valid;
    expect(() => parseWebFullEnv(withoutResend)).toThrow(/RESEND_API_KEY/);
  });

  it('requires SMTP credentials when failover is enabled', () => {
    const { SMTP_HOST: _removed, ...withoutSmtp } = valid;
    expect(() => parseWebFullEnv(withoutSmtp)).toThrow(/SMTP_HOST/);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
pnpm --filter @elogbook/web exec vitest run lib/__tests__/email-env.test.ts
```

Expected: FAIL because `EMAIL_ENABLED`, split sender fields, encryption keys, and token secrets are not in the current schema.

- [ ] **Step 3: Implement the schema**

Replace the email portion of `packages/env/src/index.ts` with explicit fields:

```ts
const optionalSchema = z.object({
  // existing non-email fields remain unchanged
  EMAIL_ENABLED: z.enum(['true', 'false']).default('true'),
  EMAIL_PROVIDER: z.enum(['resend+smtp', 'smtp-only']).default('resend+smtp'),
  EMAIL_FROM_ADDRESS: z.email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).max(120).optional(),
  EMAIL_REPLY_TO: z.email().optional(),
  EMAIL_RATE_PER_MIN: z.coerce.number().int().min(1).max(1000).default(60),
  EMAIL_DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  EMAIL_DATA_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1).optional(),
  EMAIL_LOOKUP_HMAC_KEY: z.string().min(32).optional(),
  EMAIL_TOKEN_SIGNING_SECRET: z.string().min(32).optional(),
  EMAIL_CRON_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(32).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  CONTACT_ALERT_TO: z.email().optional(),
});
```

Add production refinements:

```ts
if (data.NODE_ENV === 'production' && data.EMAIL_ENABLED) {
  if (!data.EMAIL_FROM_ADDRESS) ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM_ADDRESS'], message: 'EMAIL_FROM_ADDRESS is required when email is enabled.' });
  if (!data.EMAIL_DATA_ENCRYPTION_KEYS) ctx.addIssue({ code: 'custom', path: ['EMAIL_DATA_ENCRYPTION_KEYS'], message: 'EMAIL_DATA_ENCRYPTION_KEYS is required when email is enabled.' });
  if (!data.EMAIL_DATA_ACTIVE_KEY_VERSION) ctx.addIssue({ code: 'custom', path: ['EMAIL_DATA_ACTIVE_KEY_VERSION'], message: 'EMAIL_DATA_ACTIVE_KEY_VERSION is required when email is enabled.' });
  if (!data.EMAIL_LOOKUP_HMAC_KEY) ctx.addIssue({ code: 'custom', path: ['EMAIL_LOOKUP_HMAC_KEY'], message: 'EMAIL_LOOKUP_HMAC_KEY is required when email is enabled.' });
  if (!data.EMAIL_TOKEN_SIGNING_SECRET) ctx.addIssue({ code: 'custom', path: ['EMAIL_TOKEN_SIGNING_SECRET'], message: 'EMAIL_TOKEN_SIGNING_SECRET is required when email is enabled.' });
  if (!data.EMAIL_CRON_SECRET) ctx.addIssue({ code: 'custom', path: ['EMAIL_CRON_SECRET'], message: 'EMAIL_CRON_SECRET is required when email is enabled.' });
  if (data.EMAIL_PROVIDER === 'resend+smtp' && !data.RESEND_API_KEY) ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required for resend+smtp.' });
  if (data.EMAIL_PROVIDER !== 'smtp-only' && !data.SMTP_HOST) ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'SMTP_HOST is required when SMTP failover is enabled.' });
  if (data.EMAIL_PROVIDER !== 'smtp-only' && (!data.SMTP_USER || !data.SMTP_PASS)) ctx.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASS are required when SMTP failover is enabled.' });
}

if (data.NODE_ENV === 'production' && data.NEXT_PUBLIC_SITE_URL.startsWith('http://localhost')) {
  ctx.addIssue({ code: 'custom', path: ['NEXT_PUBLIC_SITE_URL'], message: 'Production requires an HTTPS non-localhost site URL.' });
}
```

Normalize empty environment strings to `undefined` before parsing so `.env.example` placeholders do not fail as present-but-empty values. Update `apps/web/app/api/contact/route.ts` to require a bare `CONTACT_ALERT_TO` for admin alerts and never use a display-name sender as a recipient.

- [ ] **Step 4: Update instrumentation, examples, and documentation**

Update `.env.example`, `docs/env-reference.md`, `scripts/check-env.mjs`, `scripts/verify-boot.mjs`, and `apps/web/lib/__tests__/env-fail-fast.test.ts` with the same fields. Keep `EMAIL_FROM` only as a documented development compatibility alias; new runtime code must use `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`.

- [ ] **Step 5: Run focused verification**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/__tests__/email-env.test.ts lib/__tests__/env-fail-fast.test.ts
pnpm --filter @elogbook/env typecheck
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect `packages/env/src/index.ts`, `.env.example`, and deployment tests. Confirm production rejects localhost and incomplete secrets. Do not commit.

## Task 2: Add safety-control storage and pgTAP coverage

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/p1_22_email_safety_controls.sql` with assertions that:

```sql
BEGIN;
SELECT plan(12);

SELECT has_table('public', 'email_system_settings', 'system settings exist');
SELECT has_table('public', 'email_delivery_controls', 'delivery controls exist');
SELECT has_table('public', 'email_delivery_events', 'delivery events exist');
SELECT has_table('public', 'email_action_tokens', 'action tokens exist');
SELECT has_table('public', 'email_test_recipients', 'test recipients exist');
SELECT has_table('public', 'email_admin_audit', 'email audit exists');

SELECT has_table_privilege('anon', 'public.email_delivery_events', 'INSERT', false, 'anon cannot insert delivery events');
SELECT has_table_privilege('authenticated', 'public.email_action_tokens', 'SELECT', false, 'authenticated cannot read action tokens');
SELECT has_table_privilege('authenticated', 'public.email_admin_audit', 'DELETE', false, 'authenticated cannot delete audit');
SELECT has_table_privilege('service_role', 'public.email_delivery_events', 'INSERT', true, 'service role records events');
SELECT has_table_privilege('service_role', 'public.email_admin_audit', 'INSERT', true, 'service role records audit');
SELECT throws_ok(
  $$UPDATE public.email_admin_audit SET action = 'tampered'$$,
  '42501',
  NULL,
  'email audit is append-only'
);

ROLLBACK;
```

- [ ] **Step 2: Run pgTAP and confirm failure**

```powershell
supabase db reset
supabase db test supabase/tests/p1_22_email_safety_controls.sql
```

Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Create `20260924000001_email_safety_controls.sql`**

The migration must create:

```sql
CREATE TABLE public.email_system_settings (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  enabled boolean NOT NULL DEFAULT true,
  platform_marketing_enabled boolean NOT NULL DEFAULT false,
  tenant_mail_enabled boolean NOT NULL DEFAULT false,
  default_reply_to_email text,
  tenant_campaign_recipient_limit integer NOT NULL DEFAULT 500 CHECK (tenant_campaign_recipient_limit > 0),
  tenant_daily_recipient_limit integer NOT NULL DEFAULT 2000 CHECK (tenant_daily_recipient_limit > 0),
  platform_campaign_recipient_limit integer NOT NULL DEFAULT 50000 CHECK (platform_campaign_recipient_limit > 0),
  platform_daily_recipient_limit integer NOT NULL DEFAULT 100000 CHECK (platform_daily_recipient_limit > 0),
  queue_retention_days integer NOT NULL DEFAULT 30 CHECK (queue_retention_days BETWEEN 1 AND 365),
  log_retention_days integer NOT NULL DEFAULT 90 CHECK (log_retention_days BETWEEN 30 AND 730),
  audit_retention_days integer NOT NULL DEFAULT 180 CHECK (audit_retention_days BETWEEN 90 AND 3650),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_delivery_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('global','platform','tenant','domain')),
  scope_id uuid,
  message_class text CHECK (message_class IN ('essential_transactional','security_transactional','platform_marketing','tenant_operational')),
  enabled boolean NOT NULL DEFAULT true,
  reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'tenant' AND scope_id IS NOT NULL) OR scope_type <> 'tenant')
);

CREATE TABLE public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_message_id text,
  recipient_hmac text,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE public.email_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('unsubscribe','confirmation','invitation')),
  subject_hmac text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_test_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipient_hmac text NOT NULL,
  masked_address text NOT NULL,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR scope = 'platform')
);

CREATE TABLE public.email_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_role text,
  scope text NOT NULL CHECK (scope IN ('platform','tenant','system')),
  tenant_id uuid REFERENCES public.tenants(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed','denied')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Add indexes, insert the singleton settings row with both campaign switches disabled, enable and force RLS on all six tables, add the append-only trigger, and add a trigger that rejects raw recipient-like keys in audit metadata. The trigger must allow only `recipient_hmac`, `masked_address`, `domain`, and count fields.

- [ ] **Step 4: Run migration verification**

```powershell
supabase db reset
supabase db test supabase/tests/p1_22_email_safety_controls.sql
node scripts/lint-migrations.mjs
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Confirm `platform_marketing_enabled=false` and `tenant_mail_enabled=false`. Do not commit.

## Task 3: Authenticate the internal processor and preserve proxy safety

- [ ] **Step 1: Write failing scheduler-auth tests**

Create `apps/web/lib/email/__tests__/scheduler-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAuthorizedEmailScheduler } from '@/lib/email/scheduler-auth';

const request = (headers: Record<string, string>) => new Request('http://localhost/api/internal/email/process', { headers });

describe('email scheduler auth', () => {
  it('accepts a matching bearer token', () => {
    expect(isAuthorizedEmailScheduler(request({ authorization: 'Bearer secret-value' }), 'secret-value')).toBe(true);
  });

  it('accepts the legacy cron header during compatibility', () => {
    expect(isAuthorizedEmailScheduler(request({ 'x-cron-secret': 'secret-value' }), 'secret-value')).toBe(true);
  });

  it('rejects missing, short, and mismatched values', () => {
    expect(isAuthorizedEmailScheduler(request({}), 'secret-value')).toBe(false);
    expect(isAuthorizedEmailScheduler(request({ authorization: 'Bearer short' }), 'secret-value')).toBe(false);
    expect(isAuthorizedEmailScheduler(request({ authorization: 'Bearer wrong-value' }), 'secret-value')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/scheduler-auth.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement constant-time scheduler authentication**

Create `apps/web/lib/email/scheduler-auth.ts`:

```ts
import { timingSafeEqual } from 'crypto';

function equalSecret(presented: string, configured: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function isAuthorizedEmailScheduler(request: Request, configured = process.env.EMAIL_CRON_SECRET ?? ''): boolean {
  if (!configured) return false;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  const legacy = request.headers.get('x-cron-secret') ?? '';
  return equalSecret(bearer, configured) || equalSecret(legacy, configured);
}
```

- [ ] **Step 4: Add the internal route**

Create `apps/web/app/api/internal/email/process/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { isAuthorizedEmailScheduler } from '@/lib/email/scheduler-auth';
import { processLegacyEmailBatch } from '@/lib/email/legacy-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  if (!isAuthorizedEmailScheduler(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await processLegacyEmailBatch(request);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export const GET = handle;
export const POST = handle;
```

Extract the current processor body into `apps/web/lib/email/legacy-processor.ts`; the old platform route becomes a compatibility adapter to this internal route or directly calls the same function.

- [ ] **Step 5: Update proxy exemptions**

Add `/api/internal/email/process` to `proxyOriginExemptions` and `proxyBodyExemptions`. Keep existing `/api/platform/email/process` and `/api/platform/email/webhook` exemptions for compatibility. Add a proxy integration test proving unauthenticated internal requests reach the route and receive `401`, not `403`.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/scheduler-auth.test.ts app/api/internal/email/__tests__/process.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Inspect proxy diffs and ensure no general `/api/internal` bypass exists. Do not commit.

## Task 4: Introduce typed transport results and bounded providers

- [ ] **Step 1: Write failing transport tests**

Add tests that assert:

```ts
expect(await classifyHttpStatus(429)).toBe('retryable');
expect(await classifyHttpStatus(408)).toBe('retryable');
expect(await classifyHttpStatus(422)).toBe('rejected');
expect(await classifyHttpStatus(401)).toBe('configuration');
```

Mock `fetch` and assert Resend uses `AbortSignal.timeout`, sends `Idempotency-Key`, captures request ID and `Retry-After`, and never exposes response bodies in thrown errors.

Mock Nodemailer and assert:

- port 465 sets `secure: true`
- other submission ports set `requireTLS: true`
- connection, greeting, and socket timeouts are present
- `messageId` is deterministic from the outbox ID

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/resend.test.ts src/email/__tests__/smtp.test.ts
```

Expected: FAIL because typed results and timeouts do not exist.

- [ ] **Step 3: Extend `types.ts`**

```ts
export type TransportName = 'resend' | 'smtp' | 'supabase_auth';
export type TransportOutcome = 'accepted' | 'rejected' | 'retryable' | 'configuration' | 'ambiguous';

export interface TransportResult {
  outcome: TransportOutcome;
  id?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  code: string;
}

export interface SendContext {
  idempotencyKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
}
```

- [ ] **Step 4: Implement Resend with bounded failure details**

```ts
export async function resendSend(input: ResendSendInput): Promise<TransportResult> {
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify(input.payload),
    signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
  });
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (response.ok) {
    const body = (await response.json()) as { id: string };
    return { outcome: 'accepted', id: body.id, requestId, code: 'accepted' };
  }
  const status = response.status;
  const retryAfter = Number(response.headers.get('retry-after'));
  return {
    outcome: status === 401 || status === 403 ? 'configuration' : [408, 425, 429].includes(status) || status >= 500 ? 'retryable' : 'rejected',
    requestId,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    code: `resend_http_${status}`,
  };
}
```

Do not include the raw provider body in the result or log.

- [ ] **Step 5: Implement SMTP and failover**

Configure Nodemailer with:

```ts
nodemailer.createTransport({
  host: config.host,
  port: config.port,
  secure: config.port === 465,
  requireTLS: config.port !== 465,
  auth: { user: config.user, pass: config.pass },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});
```

Update `sendWithFailover()` to fail over on `retryable`, `ambiguous`, or `configuration`; return `rejected` directly; and return a typed result including the actual provider.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__
pnpm --filter @elogbook/shared typecheck
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Confirm no API key, recipient, rendered body, or raw provider body appears in errors. Do not commit.

## Task 5: Make webhook processing allowlisted, replay-safe, and complete

- [ ] **Step 1: Write failing webhook tests**

Create fixtures for:

- `email.sent`
- `email.delivered`
- `email.bounced`
- `email.complained`
- `email.unsubscribed`
- two recipients in one event
- stale Svix timestamp
- duplicate provider event ID
- missing provider event ID

Assert normal delivery events never create suppressions.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/webhook.test.ts
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/__tests__/webhook.test.ts
```

Expected: FAIL because the parser and route currently collapse unknown events to bounce.

- [ ] **Step 3: Implement the pure webhook parser**

Create `packages/shared/src/email/webhook.ts`:

```ts
export const acceptedWebhookTypes = new Set([
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.unsubscribed',
]);

export function normalizeWebhookType(type: string): 'accepted' | 'delivered' | 'hard_bounced' | 'complained' | 'unsubscribed' | null {
  if (type === 'email.sent') return 'accepted';
  if (type === 'email.delivered') return 'delivered';
  if (type === 'email.bounced') return 'hard_bounced';
  if (type === 'email.complained') return 'complained';
  if (type === 'email.unsubscribed') return 'unsubscribed';
  return null;
}

export function svixTimestampIsFresh(timestamp: string, nowMs = Date.now(), toleranceMs = 300_000): boolean {
  const value = Number(timestamp) * 1000;
  return Number.isFinite(value) && Math.abs(nowMs - value) <= toleranceMs;
}
```

- [ ] **Step 4: Rewrite route persistence**

For each event:

1. Verify signature and five-minute freshness.
2. Parse the raw body once.
3. Require a provider event ID.
4. Insert into `email_delivery_events` with unique provider/event ID.
5. Treat unique conflict as an already-processed replay and return `200`.
6. Process every `data.to` recipient.
7. Update matching legacy `email_logs` by provider ID.
8. Create legacy suppression only for `hard_bounced`, `complained`, or `unsubscribed`.
9. Check every returned Supabase error and return `500` for a database failure.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/webhook.test.ts
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/__tests__/webhook.test.ts
supabase db test supabase/tests/p1_22_email_safety_controls.sql
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect suppression assertions and confirm delivered events cannot suppress. Do not commit.

## Task 6: Replace state-changing GET unsubscribe with expiring POST tokens

- [ ] **Step 1: Write failing unsubscribe tests**

Test that:

- GET returns a confirmation page and performs no insert/update/delete
- POST without a token returns `400`
- POST with expired or consumed token returns `400`
- valid token creates the correct scoped suppression
- token comparison is constant-time
- token database is written even when the upsert fails

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/email/__tests__/unsubscribe.test.ts
```

Expected: FAIL because GET currently changes state and POST does not exist.

- [ ] **Step 3: Implement token helpers**

Create `packages/shared/src/email/tokens.ts` with random 32-byte tokens, SHA-256 token hashes, and a database-backed issue/consume service. Use `EMAIL_TOKEN_SIGNING_SECRET` only for action-token payload authentication; store only token hashes in `email_action_tokens`.

The public token must encode purpose, token ID, expiry, and scope, and must be authenticated with HMAC-SHA256.

- [ ] **Step 4: Make GET read-only**

Return an HTML confirmation page containing a POST form. Do not access the suppression table in GET.

- [ ] **Step 5: Implement POST**

Parse the token, authenticate it, check expiry and `consumed_at`, atomically mark it consumed, upsert the scoped suppression, inspect the returned error, and return a generic success page. Essential message classes are not affected by marketing unsubscribe.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/email/__tests__/unsubscribe.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Confirm no raw address appears in the URL and GET has no mutation call. Do not commit.

## Task 7: Restrict test sends and move audit out of tenant logs

- [ ] **Step 1: Write failing test-send tests**

Assert that a platform operator can send only:

- to their own authenticated email, or
- to an active HMAC allowlist row

Reject arbitrary subject/HTML, require a saved active template and sample variables, and write `email_admin_audit` rather than tenant `audit_logs`.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/__tests__/test-send.test.ts
```

Expected: FAIL because the current endpoint accepts arbitrary recipient, subject, and HTML.

- [ ] **Step 3: Replace the request schema**

```ts
const testSchema = z.object({
  to: z.email().max(320),
  templateKey: z.string().min(1).max(120),
  variables: z.record(z.string(), z.string().max(500)).default({}),
}).strict();
```

- [ ] **Step 4: Enforce recipient policy**

Compute `HMAC-SHA-256(EMAIL_LOOKUP_HMAC_KEY, normalizedAddress)`. Query `email_test_recipients` by HMAC and active state. The operator's own address bypasses the allowlist but is still logged and rate-limited.

- [ ] **Step 5: Use email audit**

Insert actor, action, resource, outcome, masked address, template, provider result code, and no raw provider body into `email_admin_audit`. A failed audit write must return `500` for a successful send mutation so operators do not receive an unaudited success.

- [ ] **Step 6: Update the UI**

`TestSendForm.tsx` selects an existing template, accepts allowlisted sample values, and displays queued/accepted/failed state. Remove free-form HTML and arbitrary-recipient controls.

- [ ] **Step 7: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/platform/email/__tests__/test-send.test.ts
pnpm --filter @elogbook/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Confirm test sending cannot be used as a general mail relay. Do not commit.

## Task 8: Add Mailpit, Docker worker, and Vercel Cron

- [ ] **Step 1: Write deployment-contract tests**

Create `scripts/verify-email-runtime.mjs` to assert:

- Docker app and worker receive the same email environment names
- `EMAIL_CRON_SECRET` is required
- local override includes Mailpit
- Vercel has a Cron entry for `/api/internal/email/process`
- worker script contains graceful shutdown and no secret logging
- campaign settings default disabled in migration

- [ ] **Step 2: Run and confirm failure**

```powershell
node scripts/verify-email-runtime.mjs
```

Expected: FAIL because the worker, Mailpit, and Vercel Cron do not exist.

- [ ] **Step 3: Add Mailpit and worker Compose services**

`docker-compose.local.yml` must expose Mailpit only on local ports and configure SMTP/API values. `docker-compose.yml` must add `email-worker` using the same image, environment, private network, and health contract as `app`. The worker must call the internal processor and must not publish a public port.

- [ ] **Step 4: Add `scripts/email-worker.mjs`**

```js
const baseUrl = process.env.EMAIL_WORKER_BASE_URL ?? 'http://app:3000';
const secret = process.env.EMAIL_CRON_SECRET;
const intervalMs = Number(process.env.EMAIL_WORKER_INTERVAL_MS ?? 5000);
if (!secret) throw new Error('EMAIL_CRON_SECRET is required');
let stopping = false;
const stop = () => { stopping = true; };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
while (!stopping) {
  try {
    const response = await fetch(`${baseUrl}/api/internal/email/process`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) console.error(JSON.stringify({ event: 'email.worker.failed', status: response.status }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'email.worker.failed', code: error instanceof Error ? error.name : 'unknown' }));
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
```

- [ ] **Step 5: Add Vercel Cron**

Add:

```json
"crons": [
  { "path": "/api/internal/email/process", "schedule": "* * * * *" }
]
```

The route must accept the Vercel Cron authorization contract without exposing the secret to the browser.

- [ ] **Step 6: Update CI and Docker build**

Add the runtime verifier to CI, copy `scripts/email-worker.mjs` into the runtime image, and run the environment contract in the production boot test.

- [ ] **Step 7: Run verification**

```powershell
node scripts/verify-email-runtime.mjs
docker compose -f docker-compose.yml -f docker-compose.local.yml config --quiet
pnpm build:web
```

Expected: PASS.

- [ ] **Step 8: Review checkpoint**

Confirm production does not publish Mailpit or the worker, and Vercel Cron does not use a browser session. Do not commit.

## Task 9: Redact email data and finish Phase 1 verification

- [ ] **Step 1: Write failing logger containment tests**

Extend `apps/web/lib/__tests__/logger.test.ts` to assert recursive redaction of:

- `email`
- `to`
- `to_email`
- `recipient`
- `payload`
- `render_context`
- `authorization`
- provider body fields
- nested objects and arrays

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/__tests__/logger.test.ts
```

Expected: FAIL because current sanitization is shallow and does not classify email or payload fields.

- [ ] **Step 3: Implement recursive sanitization**

Replace string matching with recursive traversal over objects and arrays. Replace values under sensitive keys with `[REDACTED]`. For email values return a masked form; for payload/render context return `[REDACTED]`. Never pass error objects directly to Sentry tags.

- [ ] **Step 4: Add containment verification**

Create `tests/security/email-containment.test.mjs` to scan Phase 1 changed source and test output patterns for:

- direct `console.log` of addresses
- `logger.*` calls containing `to`, `email`, or `payload`
- raw provider response bodies
- auth tokens in email routes
- transaction tests that assert plaintext was persisted

- [ ] **Step 5: Run the complete Phase 1 gate**

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"
pnpm --filter @elogbook/shared test src/email/__tests__
pnpm --filter @elogbook/web test lib/email app/api/internal/email app/api/platform/email app/api/email lib/__tests__/logger.test.ts lib/__tests__/email-env.test.ts
supabase db reset
supabase db test supabase/tests/p1_22_email_safety_controls.sql
node --test tests/security/email-containment.test.mjs
node scripts/verify-email-runtime.mjs
docker compose -f docker-compose.yml -f docker-compose.local.yml config --quiet
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
pnpm audit --prod --audit-level=high
git diff --check
git status --short
```

Expected: all commands PASS; campaign switches remain disabled; no commit is created.

- [ ] **Step 6: Phase 1 checkpoint**

Record evidence for Docker, Vercel Cron, Mailpit, webhook replay handling, GET unsubscribe behavior, test-recipient restriction, and log redaction. Proceed to Phase 2 only after review.
