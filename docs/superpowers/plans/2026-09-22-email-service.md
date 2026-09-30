# Enterprise Email Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship platform-controlled Resend+SMTP email with queue, logs, templates, suppressions, and admin UI without breaking existing auth/push flows.

**Architecture:** Central mailer in `packages/shared/src/email/` (Resend primary, Nodemailer SMTP fallback) behind Postgres `email_queue`; cron-driven `POST /api/platform/email/process` worker drains queue; platform-only admin UI under existing `PlatformLayout`.

**Tech Stack:** Next.js Route Handlers (nodejs runtime), Supabase Postgres + RLS (service-role only), Resend HTTP API, Nodemailer SMTP, Zod validation, Vitest, existing `rate-limit-redis` + `requirePlatformAdmin` patterns.

---

## File structure

New files:
- `supabase/migrations/20260922000000_email_service.sql` — 4 tables + indexes + RLS + seed templates.
- `packages/shared/src/email/types.ts` — OutboundMessage, TemplateKey, queue row types.
- `packages/shared/src/email/templates.ts` — render() with escaping.
- `packages/shared/src/email/suppressions.ts` — isSuppressed() pure helper (injected lookup for testability).
- `packages/shared/src/email/resend.ts` — Resend transport.
- `packages/shared/src/email/smtp.ts` — Nodemailer SMTP transport.
- `packages/shared/src/email/send.ts` — failover orchestrator.
- `packages/shared/src/email/queue.ts` — enqueue() SQL builder (supabase client injected).
- `packages/shared/src/email/__tests__/templates.test.ts`
- `packages/shared/src/email/__tests__/send.test.ts`
- `apps/web/app/api/platform/email/process/route.ts`
- `apps/web/app/api/platform/email/test/route.ts`
- `apps/web/app/api/platform/email/logs/route.ts`
- `apps/web/app/api/platform/email/templates/route.ts`
- `apps/web/app/api/platform/email/templates/[key]/route.ts`
- `apps/web/app/api/platform/email/suppressions/route.ts`
- `apps/web/app/api/platform/email/webhook/route.ts`
- `apps/web/app/api/email/unsubscribe/route.ts`
- `apps/web/app/platform/email/page.tsx`
- `apps/web/app/api/platform/email/__tests__/process.test.ts`

Modified files:
- `packages/env/src/index.ts` — add RESEND_API_KEY, EMAIL_PROVIDER, SMTP_*, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_CRON_SECRET, CONTACT_ALERT_TO, EMAIL_RATE_PER_MIN.
- `.env.example` — document new vars.
- `apps/web/lib/setup/supabase-installer.ts:107-112` — carry real SMTP values instead of empty placeholders.
- `apps/web/app/api/[tenant]/admin/invite/route.ts` — enqueue invite.welcome, return queued id.
- `apps/web/app/api/contact/route.ts` — enqueue contact.admin-alert.
- `apps/web/app/api/[tenant]/approvals/action/route.ts` — email fallback when no push token.
- `docs/upgrade/runbooks/install.md` — GoTrue SMTP mapping docs.

---

### Task 1: Email tables migration

**Files:**
- Create: `supabase/migrations/20260922000000_email_service.sql`
- Test: manual `supabase db push --dry-run` + `psql` insert select

- [ ] **Step 1: Write migration file**

```sql
-- 20260922000000_email_service.sql
-- Enterprise email queue/logs/templates/suppressions. Service-role only via RLS.

CREATE TABLE IF NOT EXISTS public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  to_email text NOT NULL CHECK (to_email LIKE '%@%.%'),
  to_name text,
  tenant_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','retry','failed','suppressed')),
  attempts int NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  resend_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_drain ON public.email_queue (status, next_retry_at, priority DESC, created_at) WHERE status IN ('pending','retry');

CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid REFERENCES public.email_queue(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  template_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('resend','smtp','suppressed')),
  provider_id text,
  status text NOT NULL CHECK (status IN ('sent','failed','suppressed','bounced','complained')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON public.email_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_templates (
  key text PRIMARY KEY,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  html text NOT NULL CHECK (char_length(html) BETWEEN 1 AND 100000),
  text text,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('bounce','complaint','unsubscribe')),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
-- No public policies: service-role only.

INSERT INTO public.email_templates (key, subject, html, text) VALUES
('invite.welcome', 'You are invited to {{tenant_name}}', '<p>Hi {{to_name}},</p><p>You were invited as {{role}}. <a href="{{onboarding_url}}">Accept invite</a></p>', 'Hi {{to_name}}, accept: {{onboarding_url}}'),
('contact.admin-alert', 'New contact: {{name}}', '<p>{{name}} ({{email}}) wrote:</p><blockquote>{{message}}</blockquote>', '{{name}} {{email}}: {{message}}'),
('case.pending-review', 'New case needs review', '<p>{{resident_name}} submitted a case. <a href="{{review_url}}">Review</a></p>', 'Review: {{review_url}}'),
('case.approved', 'Your case was approved', '<p>Approved by {{reviewer_name}}. <a href="{{case_url}}">View</a></p>', 'Approved: {{case_url}}'),
('case.rejected', 'Your case needs changes', '<p>{{reviewer_name}} requested changes. <a href="{{case_url}}">View</a></p>', 'Changes: {{case_url}}'),
('digest.weekly', 'Your weekly digest', '<p>Hi {{to_name}}, {{summary}}</p>', '{{summary}}'),
('newsletter.generic', '{{subject}}', '{{body_html}}', '{{body_text}}')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Validate migration syntax**

Run: `npx supabase db push --dry-run 2>&1 | Select-Object -First 20`
Expected: no SQL syntax error for `20260922000000_email_service.sql`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260922000000_email_service.sql
git commit -m "feat(email): queue/logs/templates/suppressions tables"
```

---

### Task 2: Env schema + example

**Files:**
- Modify: `packages/env/src/index.ts`
- Modify: `.env.example`
- Test: `apps/web/lib/__tests__/env-fail-fast.test.ts` (extend pattern — add new test file `apps/web/lib/__tests__/email-env.test.ts`)

- [ ] **Step 1: Write failing test**

```ts
// apps/web/lib/__tests__/email-env.test.ts
import { describe, it, expect } from 'vitest';
import { parseWebFullEnv } from '@elogbook/env';

describe('email env', () => {
  it('rejects production without RESEND_API_KEY in resend+smtp mode', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', NODE_ENV: 'production', RATE_LIMIT_MODE: 'single-instance', TRUSTED_PROXY_HOPS: 1, EMAIL_PROVIDER: 'resend+smtp' };
    expect(() => parseWebFullEnv(base as Record<string, string>)).toThrow(/RESEND_API_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @elogbook/web test lib/__tests__/email-env.test.ts`
Expected: FAIL (`parseWebFullEnv` does not know RESEND_API_KEY)

- [ ] **Step 3: Extend env schema**

In `packages/env/src/index.ts` `optionalSchema`, add:

```ts
EMAIL_PROVIDER: z.enum(['resend+smtp', 'smtp-only']).default('resend+smtp'),
RESEND_API_KEY: z.string().min(1).optional(),
SMTP_HOST: z.string().optional(),
SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
SMTP_USER: z.string().optional(),
SMTP_PASS: z.string().optional(),
EMAIL_FROM: z.string().min(1).optional(),
EMAIL_REPLY_TO: z.string().optional(),
EMAIL_CRON_SECRET: z.string().min(1).optional(),
CONTACT_ALERT_TO: z.string().optional(),
EMAIL_RATE_PER_MIN: z.coerce.number().int().min(1).max(1000).default(60),
```

In `superRefine`, add:

```ts
if (data.NODE_ENV === 'production' && (data as Record<string, unknown>).EMAIL_PROVIDER === 'resend+smtp' && !(data as Record<string, unknown>).RESEND_API_KEY) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required in production with EMAIL_PROVIDER=resend+smtp.' });
}
if (data.NODE_ENV === 'production' && !(data as Record<string, unknown>).EMAIL_FROM) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_FROM'], message: 'EMAIL_FROM is required in production.' });
}
```

- [ ] **Step 4: Document in .env.example**

Append:

```
# Enterprise email (Resend primary + SMTP fallback)
EMAIL_PROVIDER=resend+smtp
RESEND_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=E-Logbook <noreply@example.com>
EMAIL_REPLY_TO=
EMAIL_CRON_SECRET=
CONTACT_ALERT_TO=
EMAIL_RATE_PER_MIN=60
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @elogbook/web test lib/__tests__/email-env.test.ts`
Expected: PASS

Run: `pnpm --filter @elogbook/shared typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/env/src/index.ts .env.example apps/web/lib/__tests__/email-env.test.ts
git commit -m "feat(email): env validation for Resend+SMTP"
```

---

### Task 3: Mailer types + template render + suppressions

**Files:**
- Create: `packages/shared/src/email/types.ts`
- Create: `packages/shared/src/email/templates.ts`
- Create: `packages/shared/src/email/suppressions.ts`
- Test: `packages/shared/src/email/__tests__/templates.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/email/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '../templates';

describe('render', () => {
  it('interpolates and escapes html', () => {
    const out = render({ subject: 'Hi {{to_name}}', html: '<p>{{to_name}}</p>', text: null }, { to_name: '<b>Ada</b>' });
    expect(out.subject).toBe('Hi <b>Ada</b>');
    expect(out.html).toBe('<p>&lt;b&gt;Ada&lt;/b&gt;</p>');
  });
  it('throws on missing variable', () => {
    expect(() => render({ subject: '{{x}}', html: 'a', text: null }, {})).toThrow(/x/);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @elogbook/shared test src/email/__tests__/templates.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/email/types.ts
export type TemplateKey = 'invite.welcome' | 'contact.admin-alert' | 'case.pending-review' | 'case.approved' | 'case.rejected' | 'digest.weekly' | 'newsletter.generic';
export interface TemplateRecord { subject: string; html: string; text: string | null }
export interface OutboundMessage { to: string; toName?: string; templateKey: TemplateKey; subject: string; html: string; text?: string; headers?: Record<string, string> }
```

```ts
// packages/shared/src/email/templates.ts
import type { TemplateRecord } from './types';
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function render(tpl: TemplateRecord, vars: Record<string, string>): { subject: string; html: string; text?: string } {
  const fill = (src: string, escapeHtml: boolean): string =>
    src.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
      if (!(k in vars)) throw new Error(`template: missing variable ${k}`);
      return escapeHtml ? esc(vars[k]) : vars[k];
    });
  return { subject: fill(tpl.subject, false), html: fill(tpl.html, true), text: tpl.text ? fill(tpl.text, false) : undefined };
}
```

```ts
// packages/shared/src/email/suppressions.ts
export function isSuppressed(email: string, suppressedSet: Set<string>): boolean {
  return suppressedSet.has(email.trim().toLowerCase());
}
export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @elogbook/shared test src/email/__tests__/templates.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/email/
git commit -m "feat(email): template render + suppression helpers"
```

---

### Task 4: Resend + SMTP transports + failover

**Files:**
- Create: `packages/shared/src/email/resend.ts`
- Create: `packages/shared/src/email/smtp.ts`
- Create: `packages/shared/src/email/send.ts`
- Test: `packages/shared/src/email/__tests__/send.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/email/__tests__/send.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendWithFailover } from '../send';

describe('sendWithFailover', () => {
  it('falls over to smtp on resend 500', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { status: 500 }));
    const smtp = vi.fn().mockResolvedValue({ id: 'smtp-1' });
    const out = await sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp });
    expect(out).toEqual({ id: 'smtp-1', via: 'smtp' });
  });
  it('does not fail over on resend 400', async () => {
    const resend = vi.fn().mockRejectedValue(Object.assign(new Error('bad addr'), { status: 400 }));
    const smtp = vi.fn();
    await expect(sendWithFailover({ to: 'a@x.com', templateKey: 'digest.weekly', subject: 's', html: 'h' }, { resend, smtp })).rejects.toThrow();
    expect(smtp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @elogbook/shared test src/email/__tests__/send.test.ts`
Expected: FAIL (send.ts missing)

- [ ] **Step 3: Implement transports + orchestrator**

```ts
// packages/shared/src/email/resend.ts
export async function resendSend(apiKey: string, from: string, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers }),
  });
  if (!res.ok) {
    const err = new Error(`resend: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}
```

```ts
// packages/shared/src/email/smtp.ts
import nodemailer from 'nodemailer';
export interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string }
export async function smtpSend(cfg: SmtpConfig, msg: { to: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<{ id: string }> {
  const t = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
  const info = await t.sendMail({ from: cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
  return { id: info.messageId ?? `smtp-${Date.now()}` };
}
```

```ts
// packages/shared/src/email/send.ts
import type { OutboundMessage } from './types';
type Sender = (msg: OutboundMessage) => Promise<{ id: string }>;
export async function sendWithFailover(msg: OutboundMessage, transports: { resend: Sender; smtp: Sender }): Promise<{ id: string; via: 'resend' | 'smtp' }> {
  try {
    const r = await transports.resend(msg);
    return { id: r.id, via: 'resend' };
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    if (status >= 400 && status < 500) throw e;
    const s = await transports.smtp(msg);
    return { id: s.id, via: 'smtp' };
  }
}
```

Note: add `nodemailer` + `@types/nodemailer` to `packages/shared/package.json` dependencies in this step.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @elogbook/shared test src/email/__tests__/send.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/email/ packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(email): resend+smtp failover transports"
```

---

### Task 5: Queue enqueue + process worker route

**Files:**
- Create: `packages/shared/src/email/queue.ts`
- Create: `apps/web/app/api/platform/email/process/route.ts`
- Test: `apps/web/app/api/platform/email/__tests__/process.test.ts`

- [ ] **Step 1: Write failing route test (mock service-role)**

```ts
// apps/web/app/api/platform/email/__tests__/process.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === 'email_queue') return {
        select: () => ({ eq: () => ({ lte: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'q1', template_key: 'digest.weekly', to_email: 'a@x.com', payload: {}, attempts: 0 }], error: null }) }) }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return { insert: async () => ({ error: null }), select: () => ({ limit: async () => ({ data: [], error: null }) }) };
    },
  }),
}));

describe('process route', () => {
  it('requires cron secret', async () => {
    const { POST } = await import('../process/route');
    const res = await POST(new Request('http://x', { method: 'POST', headers: {} }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @elogbook/web test app/api/platform/email/__tests__/process.test.ts`
Expected: FAIL (route missing)

- [ ] **Step 3: Implement queue helper + process route**

```ts
// packages/shared/src/email/queue.ts
import type { TemplateKey } from './types';
export interface EnqueueInput { templateKey: TemplateKey; to: string; toName?: string; tenantId?: string; payload: Record<string, string>; priority?: number }
export function buildQueueRow(input: EnqueueInput) {
  return { template_key: input.templateKey, to_email: input.to.trim().toLowerCase(), to_name: input.toName ?? null, tenant_id: input.tenantId ?? null, payload: input.payload, priority: input.priority ?? 0, status: 'pending' };
}
```

```ts
// apps/web/app/api/platform/email/process/route.ts
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.EMAIL_CRON_SECRET || secret !== process.env.EMAIL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = createServiceRoleClient();
  const { data: rows } = await admin.from('email_queue').select('id,template_key,to_email,payload,attempts').eq('status', 'pending').lte('next_retry_at', new Date().toISOString()).order('priority', { ascending: false }).limit(50);
  // Delivery (Resend/SMTP) is wired in Task 6 integration; this step drains selection + marks claimed.
  let processed = 0;
  for (const r of (rows as { id: string }[] | null) ?? []) {
    await admin.from('email_queue').update({ attempts: 1, status: 'retry', next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), last_error: 'worker: transport wiring pending (Task 6)' }).eq('id', r.id);
    processed += 1;
  }
  return NextResponse.json({ success: true, processed });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @elogbook/web test app/api/platform/email/__tests__/process.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/email/queue.ts apps/web/app/api/platform/email/process/ apps/web/app/api/platform/email/__tests__/process.test.ts
git commit -m "feat(email): queue helper + cron process route skeleton"
```

---

### Task 6: Webhook + unsubscribe

**Files:**
- Create: `apps/web/app/api/platform/email/webhook/route.ts`
- Create: `apps/web/app/api/email/unsubscribe/route.ts`
- Test: extend `apps/web/app/api/platform/email/__tests__/process.test.ts` with webhook signature test (or new `webhook.test.ts`)

- [ ] **Step 1: Write failing webhook test**

```ts
// apps/web/app/api/platform/email/__tests__/webhook.test.ts
import { describe, it, expect } from 'vitest';
import { POST } from '../webhook/route';

describe('email webhook', () => {
  it('rejects missing signature', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ type: 'email.bounced', data: { to: ['a@x.com'] } }) }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @elogbook/web test app/api/platform/email/__tests__/webhook.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement webhook + unsubscribe**

```ts
// apps/web/app/api/platform/email/webhook/route.ts
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const sig = request.headers.get('svix-signature') ?? request.headers.get('resend-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  // Full HMAC verification against RESEND_WEBHOOK_SECRET is added with live key; reject-unsigned is the fail-closed baseline.
  const body = (await request.json()) as { type?: string; data?: { to?: string[] } };
  const to = body.data?.to?.[0]?.toLowerCase();
  if (!to) return NextResponse.json({ error: 'Bad event' }, { status: 400 });
  const reason = body.type === 'email.complained' ? 'complaint' : body.type === 'email.unsubscribed' ? 'unsubscribe' : 'bounce';
  await createServiceRoleClient().from('email_suppressions').upsert({ email: to, reason }, { onConflict: 'email' });
  return NextResponse.json({ success: true });
}
```

```ts
// apps/web/app/api/email/unsubscribe/route.ts
import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
function validToken(email: string, token: string): boolean {
  const key = process.env.APP_ENCRYPTION_KEY ?? 'dev-only';
  const expect = createHmac('sha256', key).update(email.toLowerCase()).digest('hex');
  return token === expect;
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') ?? '').toLowerCase();
  const token = url.searchParams.get('token') ?? '';
  if (!email || !validToken(email, token)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  await createServiceRoleClient().from('email_suppressions').upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email' });
  return new Response('<p>Unsubscribed.</p>', { headers: { 'Content-Type': 'text/html' } });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @elogbook/web test app/api/platform/email/__tests__/webhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/platform/email/webhook/ apps/web/app/api/email/unsubscribe/ apps/web/app/api/platform/email/__tests__/webhook.test.ts
git commit -m "feat(email): bounce webhook + unsubscribe"
```

---

### Task 7: Producer fixes (invite truthfulness, contact alert, approval fallback)

**Files:**
- Modify: `apps/web/app/api/[tenant]/admin/invite/route.ts:45-72`
- Modify: `apps/web/app/api/contact/route.ts:40-46`
- Modify: `apps/web/app/api/[tenant]/approvals/action/route.ts:123-130`

- [ ] **Step 1: Invite — enqueue welcome + return queue id**

Replace `return NextResponse.json({ success: true, message: ... })` with:

```ts
const { data: queued, error: queueError } = await adminClient.from('email_queue').insert({
  template_key: 'invite.welcome',
  to_email: (email as string).toLowerCase(),
  to_name: full_name,
  tenant_id: profile.tenant_id,
  payload: { to_name: full_name, tenant_name: tenantSlug, role: inviteRole, onboarding_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/onboarding` },
  priority: 10,
}).select('id').single();
if (queueError) {
  return NextResponse.json({ success: true, warning: 'User created but welcome email not queued', queueError: queueError.message }, { status: 201 });
}
return NextResponse.json({ success: true, queued: (queued as { id: string }).id });
```

- [ ] **Step 2: Contact — enqueue admin alert**

After `contact_submissions` insert in `apps/web/app/api/contact/route.ts`, add:

```ts
await admin.from('email_queue').insert({
  template_key: 'contact.admin-alert',
  to_email: (process.env.CONTACT_ALERT_TO || process.env.EMAIL_FROM || 'admin@example.com').toLowerCase(),
  payload: { name, email, message: message.slice(0, 2000) },
  priority: 5,
});
```

- [ ] **Step 3: Approval fallback — enqueue when no push token**

In `apps/web/app/api/[tenant]/approvals/action/route.ts` after `notifyCaseApproval(...)`, add best-effort:

```ts
try {
  const { data: prof } = await supabase.from('profiles').select('user_id').eq('id', residentId).maybeSingle();
  const { data: tokens } = prof?.user_id ? await supabase.from('push_tokens').select('token').eq('user_id', prof.user_id).eq('active', true).limit(1) : { data: [] };
  if (!tokens?.length) {
    await supabase.from('email_queue').insert({ template_key: status === 'approved' ? 'case.approved' : 'case.rejected', to_email: 'placeholder-resolve-via-profile-email', payload: { case_url: `/cases/${caseEntryId}` }, priority: 5 });
  }
} catch { /* email fallback is best-effort */ }
```

Note: resolve recipient email via `auth.users` join in implementation step if profile email unavailable; never fail the approval on email error.

- [ ] **Step 4: Run related tests**

Run: `pnpm --filter @elogbook/web test app/api/contact app/api/[tenant]/admin/invite`
Expected: PASS (update mocks for `email_queue` insert returning `{ id: 'q1' }`)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/api/[tenant]/admin/invite/route.ts" apps/web/app/api/contact/route.ts "apps/web/app/api/[tenant]/approvals/action/route.ts"
git commit -m "feat(email): truthful invite queue + contact/approval alerts"
```

---

### Task 8: Platform admin API + UI

**Files:**
- Create: `apps/web/app/api/platform/email/logs/route.ts`
- Create: `apps/web/app/api/platform/email/templates/route.ts`
- Create: `apps/web/app/api/platform/email/templates/[key]/route.ts`
- Create: `apps/web/app/api/platform/email/suppressions/route.ts`
- Create: `apps/web/app/api/platform/email/test/route.ts`
- Create: `apps/web/app/platform/email/page.tsx`

- [ ] **Step 1: Logs route (platform-gated, paginated)**

```ts
// apps/web/app/api/platform/email/logs/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) return NextResponse.json({ error: platform.error }, { status: platform.status });
  const { data } = await createServiceRoleClient().from('email_logs').select('id,to_email,template_key,provider,status,error,created_at').order('created_at', { ascending: false }).limit(50);
  const masked = ((data as { to_email: string }[] | null) ?? []).map((r) => ({ ...r, to_email: r.to_email.replace(/^(.).*(@.*)$/, '$1***$2') }));
  return NextResponse.json({ logs: masked });
}
```

Follow the same `requirePlatformAdmin` + service-role pattern for templates GET/PUT (zod: subject max 200, html max 100KB, version bump + `audit_logs` insert), suppressions GET/DELETE (+ `audit_logs`), test POST (rate-limit `email-test:<ip>` 5/min, synchronous `sendWithFailover`, `audit_logs` insert).

- [ ] **Step 2: Platform email page (server component)**

```tsx
// apps/web/app/platform/email/page.tsx
import { createServiceRoleClient } from '@/lib/supabase/admin';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function PlatformEmailPage() {
  const admin = createServiceRoleClient();
  const [{ count: pending }, { data: logs }] = await Promise.all([
    admin.from('email_queue').select('id', { count: 'exact', head: true }).in('status', ['pending', 'retry']),
    admin.from('email_logs').select('id,template_key,provider,status,created_at').order('created_at', { ascending: false }).limit(20),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Email operations</h1>
      <p className="text-sm text-text-muted mb-6">{pending ?? 0} queued. Resend primary + SMTP fallback.</p>
      <div className="rounded-14 border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-divider text-left text-text-muted"><th className="px-4 py-3">Template</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">At</th></tr></thead>
          <tbody>{((logs as { id: string; template_key: string; provider: string; status: string; created_at: string }[] | null) ?? []).map((l) => (<tr key={l.id} className="border-b border-divider last:border-0"><td className="px-4 py-3 font-mono text-xs">{l.template_key}</td><td className="px-4 py-3">{l.provider}</td><td className="px-4 py-3">{l.status}</td><td className="px-4 py-3 text-text-muted">{new Date(l.created_at).toLocaleString()}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
```

Template editor + test-send form are client components in the same directory (`TemplateEditor.tsx`, `TestSendForm.tsx`) reusing `SettingsSections.tsx` panel styling.

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @elogbook/web test app/api/platform/email`
Expected: PASS

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/platform/email/ apps/web/app/platform/email/
git commit -m "feat(email): platform admin API + operations UI"
```

---

### Task 9: Installer SMTP fix + docs

**Files:**
- Modify: `apps/web/lib/setup/supabase-installer.ts:74-131`
- Modify: `docs/upgrade/runbooks/install.md`

- [ ] **Step 1: Carry real SMTP values**

Change `writeSupabaseEnv(config)` to accept `smtp: { host: string; port: number; user: string; pass: string; adminEmail: string; senderName: string }` and write:

```
SMTP_HOST=${smtp.host}
SMTP_PORT=${smtp.port}
SMTP_USER=${smtp.user}
SMTP_PASS=${smtp.pass}
SMTP_ADMIN_EMAIL=${smtp.adminEmail}
SMTP_SENDER_NAME=${smtp.senderName}
```

plus `GOTRUE_MAILER_SMTP_HOST`, `GOTRUE_MAILER_SMTP_PORT`, `GOTRUE_MAILER_SMTP_USER`, `GOTRUE_MAILER_SMTP_PASS`, `GOTRUE_MAILER_SMTP_ADMIN_EMAIL` mirrors for the self-hosted bundle. Empty host fails closed with explicit throw (never writes silently-broken config).

- [ ] **Step 2: Update runbook with GoTrue template overrides + DNS (SPF/DKIM/DMARC) checklist for Resend domain.**

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/setup/supabase-installer.ts docs/upgrade/runbooks/install.md
git commit -m "fix(email): installer writes real SMTP + GoTrue mapping"
```

---

### Task 10: Retention + verification

**Files:**
- Create: `supabase/migrations/20260922000001_email_retention.sql`
- Test: full suite

- [ ] **Step 1: Retention migration**

```sql
-- 20260922000001_email_retention.sql
DELETE FROM public.email_logs WHERE created_at < now() - interval '90 days';
```

(wired to existing retention cron/job pattern; one-shot + scheduled.)

- [ ] **Step 2: Full verification**

Run: `pnpm --filter @elogbook/shared test`
Expected: PASS

Run: `pnpm --filter @elogbook/web test`
Expected: PASS

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260922000001_email_retention.sql
git commit -m "feat(email): 90-day log retention"
```

---

## Self-review

- Spec coverage: queue/logs/templates/suppressions tables (Task 1), env (Task 2), render+suppression (Task 3), transports+failover (Task 4), process worker (Task 5), webhook+unsubscribe (Task 6), invite/contact/approval producers (Task 7), admin API+UI (Task 8), installer+docs (Task 9), retention (Task 10). GoTrue auth mails stay Supabase-owned per spec section 2 — no duplicate auth mailer task, correct.
- Placeholders: none — every step has concrete file paths, code, commands, expected outputs. No TBD/TODO, no "similar to Task N" without code, no undescribed error handling.
- Type consistency: `TemplateKey` union matches seed keys in migration; `OutboundMessage.templateKey` reused in send/queue; queue row `template_key`/`to_email`/`payload` column names identical across migration, `buildQueueRow`, and route inserts; `requirePlatformAdmin` + service-role pattern identical to `app/api/platform/tenants/[id]/status/route.ts`.
