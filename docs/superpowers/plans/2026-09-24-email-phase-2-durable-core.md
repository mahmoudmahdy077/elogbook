# Enterprise Email Phase 2 — Durable Transactional Core Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce encrypted, idempotent, atomically claimed email outbox processing with leases, fencing, retry, dead letters, retention, and safe compatibility with the legacy queue.

**Architecture:** New email storage is additive. Application producers dual-write through one enqueue service, the worker claims rows with PostgreSQL `FOR UPDATE SKIP LOCKED`, and completion requires a current fence. A resumable Node backfill encrypts legacy recipients and payloads before the legacy contract is retired in Phase 3.

**Tech Stack:** PostgreSQL 17, Supabase RPC, Node.js 22 `crypto`, Next.js 16, Zod 4, Vitest 4, pgTAP.

---

## Files

**Create**

- `supabase/migrations/20260924000002_email_platform_expand.sql`
- `supabase/migrations/20260924000003_email_platform_rpcs.sql`
- `supabase/migrations/20260924000004_email_platform_backfill.sql`
- `supabase/migrations/20260924000005_email_platform_maintenance.sql`
- `supabase/tests/p1_23_email_outbox_rls.sql`
- `supabase/tests/p1_24_email_claim_concurrency.sql`
- `supabase/tests/p1_25_email_idempotency.sql`
- `supabase/tests/p1_26_email_retention.sql`
- `supabase/tests/p1_27_email_user_deletion.sql`
- `packages/shared/src/email/crypto.ts`
- `packages/shared/src/email/policy.ts`
- `packages/shared/src/email/sanitize.ts`
- `packages/shared/src/email/schemas.ts`
- `packages/shared/src/email/__tests__/crypto.test.ts`
- `packages/shared/src/email/__tests__/policy.test.ts`
- `packages/shared/src/email/__tests__/sanitize.test.ts`
- `apps/web/lib/email/crypto.ts`
- `apps/web/lib/email/enqueue.ts`
- `apps/web/lib/email/policy.ts`
- `apps/web/lib/email/render.ts`
- `apps/web/lib/email/content-policy.ts`
- `apps/web/lib/email/provider-factory.ts`
- `apps/web/lib/email/rate-limit.ts`
- `apps/web/lib/email/processor.ts`
- `apps/web/lib/email/observability.ts`
- `apps/web/lib/email/__tests__/enqueue.test.ts`
- `apps/web/lib/email/__tests__/processor.test.ts`
- `apps/web/lib/email/__tests__/policy.test.ts`
- `apps/web/lib/email/__tests__/content-policy.test.ts`
- `apps/web/lib/email/__tests__/observability.test.ts`
- `scripts/migrate-legacy-email-outbox.mjs`

**Modify**

- `packages/shared/src/email/types.ts`
- `packages/shared/src/email/templates.ts`
- `packages/shared/src/email/queue.ts`
- `packages/shared/src/email/suppressions.ts`
- `apps/web/app/api/internal/email/process/route.ts`
- `apps/web/app/api/platform/email/process/route.ts`
- `apps/web/app/api/platform/email/webhook/route.ts`
- `apps/web/app/api/[tenant]/admin/invite/route.ts`
- `apps/web/app/api/contact/route.ts`
- `apps/web/app/api/[tenant]/approvals/action/route.ts`
- `apps/web/app/api/ready/route.ts`
- `apps/web/lib/logger.ts`
- `scripts/email-worker.mjs`
- `packages/shared/src/types/database.ts`

## Task 1: Add the expanded email schema

- [ ] **Step 1: Write failing pgTAP schema tests**

In `p1_23_email_outbox_rls.sql`, assert the existence of `email_outbox`, `email_template_revisions`, `email_preferences`, `email_domains`, `email_worker_heartbeats`, `email_provider_circuits`, and `email_migration_ledger`; assert FORCE RLS; assert authenticated roles cannot read encrypted recipient/context fields; assert unique outbox idempotency keys; assert published template revisions cannot be updated or deleted.

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db reset
supabase db test supabase/tests/p1_23_email_outbox_rls.sql
```

Expected: FAIL because the expanded schema does not exist.

- [ ] **Step 3: Create `20260924000002_email_platform_expand.sql`**

Create the core table:

```sql
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_class text NOT NULL CHECK (message_class IN ('essential_transactional','security_transactional','platform_marketing','tenant_operational')),
  delivery_channel text NOT NULL CHECK (delivery_channel IN ('app_provider','supabase_auth')),
  scope text NOT NULL CHECK (scope IN ('system','platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_name_enc text,
  recipient_email_enc text NOT NULL,
  recipient_email_hmac text NOT NULL,
  recipient_masked text NOT NULL,
  render_context_enc text NOT NULL,
  encryption_key_version integer NOT NULL,
  template_id uuid,
  template_revision_id uuid,
  consent_snapshot jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','retry_wait','accepted','delivered','suppressed','failed','dead_letter','canceled')),
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  fence bigint NOT NULL DEFAULT 0,
  provider text,
  provider_message_id text,
  sanitized_error_code text,
  idempotency_key text NOT NULL UNIQUE,
  accepted_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  purge_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR scope <> 'tenant')
);
```

Create the remaining tables with these exact boundaries:

```sql
CREATE TABLE public.email_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  html text NOT NULL CHECK (char_length(html) BETWEEN 1 AND 100000),
  text text,
  allowed_variables jsonb NOT NULL DEFAULT '[]',
  content_sha256 text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE TABLE public.email_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform_marketing_opt_in boolean NOT NULL DEFAULT false,
  tenant_mail_opt_out boolean NOT NULL DEFAULT false,
  policy_version text NOT NULL,
  consent_source text,
  consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  provider_domain_id text,
  status text NOT NULL CHECK (status IN ('pending','verifying','verified','failed','disabled')),
  spf_status text NOT NULL DEFAULT 'pending',
  dkim_status text NOT NULL DEFAULT 'pending',
  dmarc_status text NOT NULL DEFAULT 'pending',
  is_default boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR scope = 'platform')
);

CREATE TABLE public.email_worker_heartbeats (
  worker_id text PRIMARY KEY,
  deployment_id text NOT NULL,
  worker_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_provider_circuits (
  provider text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('closed','open','half_open')),
  failure_code text,
  opened_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_migration_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_key text NOT NULL UNIQUE,
  source_table text NOT NULL,
  last_source_id uuid,
  processed_count integer NOT NULL DEFAULT 0,
  checksum text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Extend `email_templates` with `scope`, nullable `tenant_id`, `message_class`, `active_revision_id`, and lifecycle timestamps. Add a foreign key from `email_template_revisions.template_id` to `email_templates.id`, and make the identity row unique by normalized scope, tenant, and template key. Add a unique lower-case hostname index on `email_domains`, partial unique indexes for global and tenant `email_preferences`, claim/campaign indexes on `email_outbox`, and sanitized compatibility columns to `email_logs` and `email_suppressions`. Add `default_domain_id uuid` to `email_system_settings` after `email_domains` exists, with a foreign key in the same migration.

- [ ] **Step 4: Add immutability and RLS protections**

Add triggers that reject updates or deletes to published `email_template_revisions` and append-only `email_admin_audit`. Revoke all new table privileges from `anon` and `authenticated` except the minimum preference RPC surface; operational access remains through service role and reviewed `SECURITY DEFINER` RPCs.

- [ ] **Step 5: Run migration verification**

```powershell
supabase db reset
supabase db test supabase/tests/p1_23_email_outbox_rls.sql
node scripts/lint-migrations.mjs
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm every new table has RLS and FORCE RLS. Do not commit.

## Task 2: Implement versioned encryption and recipient HMAC

- [ ] **Step 1: Write failing crypto tests**

Test exact behavior:

```ts
const encrypted = encryptJson({ email: 'user@example.com' }, { key: Buffer.alloc(32, 7), keyVersion: 1 });
expect(encrypted).toMatch(/^v1\./);
expect(decryptJson(encrypted, { key: Buffer.alloc(32, 7) })).toEqual({ email: 'user@example.com' });
expect(() => decryptJson(encrypted, { key: Buffer.alloc(32, 8) })).toThrow();
expect(hmacEmail(' User@Example.com ', secret)).toBe(hmacEmail('user@example.com', secret));
```

Add random-IV and tamper rejection tests.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/crypto.test.ts
```

Expected: FAIL because crypto helpers do not exist.

- [ ] **Step 3: Implement shared crypto primitives**

Create `packages/shared/src/email/crypto.ts` using `randomBytes`, `createCipheriv('aes-256-gcm')`, `createDecipheriv`, `createHmac('sha256')`, and `timingSafeEqual`. Envelope format:

```text
v<keyVersion>.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>
```

- [ ] **Step 4: Implement server key-ring parsing**

Create `apps/web/lib/email/crypto.ts`:

```ts
export type EmailKeyRing = {
  activeVersion: number;
  keys: Map<number, Buffer>;
};

export function parseEmailKeyRing(source: Record<string, string | undefined>): EmailKeyRing {
  const raw = source.EMAIL_DATA_ENCRYPTION_KEYS;
  const activeVersion = Number(source.EMAIL_DATA_ACTIVE_KEY_VERSION);
  if (!raw || !Number.isInteger(activeVersion)) throw new Error('email key ring is not configured');
  const parsed = JSON.parse(raw) as Record<string, string>;
  const keys = new Map<number, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error(`email key ${version} is not 32 bytes`);
    keys.set(Number(version), key);
  }
  if (!keys.has(activeVersion)) throw new Error('active email key is missing');
  return { activeVersion, keys };
}
```

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/crypto.test.ts
pnpm --filter @elogbook/web exec vitest run lib/email
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm no fallback to plaintext and no key material in errors. Do not commit.

## Task 3: Enforce scoped policy and sanitized rendering

- [ ] **Step 1: Write failing policy and sanitization tests**

Assert:

- marketing unsubscribe does not block essential messages
- tenant unsubscribe does not block another tenant's essential message
- hard bounce blocks every class until cleared
- global manual suppression blocks tenant and platform bulk
- scripts, forms, frames, objects, event attributes, remote images, and non-approved URL schemes are removed
- unknown template variables fail before send
- text alternative is mandatory for bulk messages

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__/policy.test.ts src/email/__tests__/sanitize.test.ts
```

Expected: FAIL because pure policy and sanitizer modules do not exist.

- [ ] **Step 3: Implement pure suppression policy**

`packages/shared/src/email/policy.ts` must accept only:

```ts
export interface SuppressionFact {
  scope: 'global' | 'platform' | 'tenant';
  tenantId: string | null;
  reason: 'hard_bounce' | 'complaint' | 'unsubscribe' | 'manual';
  active: boolean;
}

export function shouldSuppress(messageClass: EmailMessageClass, facts: SuppressionFact[], tenantId: string | null): boolean;
```

Hard bounce always returns true. Essential/security ignore complaint and unsubscribe. Bulk checks matching scope. Tenant checks current tenant only.

- [ ] **Step 4: Implement sanitizer and renderer**

`packages/shared/src/email/sanitize.ts` must use a maintained HTML sanitizer already present in the dependency graph; if no suitable dependency exists, add a pinned, audited sanitizer package before implementation. Do not write regex-based HTML sanitization.

`apps/web/lib/email/render.ts` must load one immutable revision, compare template variables to `allowed_variables`, escape subject/text variables, sanitize HTML, and return provider-neutral `RenderedEmail`.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/shared test src/email/__tests__
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/policy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect sanitizer configuration and dependency audit. Do not commit.

## Task 4: Implement atomic claim, lease, fence, and completion RPCs

- [ ] **Step 1: Write failing concurrency tests**

`p1_24_email_claim_concurrency.sql` must prove:

- two sessions cannot claim the same eligible row
- a claimed row is excluded until lease expiry
- an expired lease is reclaimed with a higher fence
- an old fence cannot complete or fail a reclaimed row
- essential capacity is reserved when campaign rows exceed the campaign cap

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p1_24_email_claim_concurrency.sql
```

Expected: FAIL because claim RPCs do not exist.

- [ ] **Step 3: Create `20260924000003_email_platform_rpcs.sql`**

Implement:

```sql
claim_email_outbox(p_worker_id text, p_limit integer, p_lease_seconds integer, p_campaign_limit integer)
complete_email_outbox(p_outbox_id uuid, p_worker_id text, p_fence bigint, p_provider text, p_provider_message_id text, p_accepted_at timestamptz)
fail_email_outbox(p_outbox_id uuid, p_worker_id text, p_fence bigint, p_retry_at timestamptz, p_error_code text, p_terminal boolean)
record_email_delivery_event(p_provider text, p_provider_event_id text, p_event_type text, p_provider_message_id text, p_recipient_hmac text, p_occurred_at timestamptz, p_metadata jsonb) returns uuid
heartbeat_email_worker(p_worker_id text, p_deployment_id text, p_worker_version text, p_metadata jsonb) returns void
maintain_email_platform(p_retention jsonb) returns jsonb
enqueue_email_intent(p_message_class text, p_delivery_channel text, p_scope text, p_tenant_id uuid, p_campaign_id uuid, p_user_id uuid, p_recipient_name_enc text, p_recipient_email_enc text, p_recipient_email_hmac text, p_recipient_masked text, p_render_context_enc text, p_encryption_key_version integer, p_template_id uuid, p_template_revision_id uuid, p_consent_snapshot jsonb, p_priority integer, p_idempotency_key text, p_max_attempts integer) returns table(outbox_id uuid, state text, code text)
```

Claim query core:

```sql
WITH candidate AS (
  SELECT id
  FROM public.email_outbox
  WHERE (
    status IN ('pending','retry_wait')
    AND next_attempt_at <= now()
  ) OR (
    status = 'claimed'
    AND lease_expires_at < now()
  )
  ORDER BY
    CASE message_class
      WHEN 'security_transactional' THEN 0
      WHEN 'essential_transactional' THEN 1
      WHEN 'tenant_operational' THEN 2
      WHEN 'platform_marketing' THEN 3
    END,
    priority DESC,
    created_at
  FOR UPDATE SKIP LOCKED
  LIMIT p_limit
)
UPDATE public.email_outbox AS e
SET status = 'claimed',
    lease_owner = p_worker_id,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    fence = e.fence + 1,
    attempts = e.attempts + 1,
    updated_at = now()
FROM candidate
WHERE e.id = candidate.id
RETURNING e.*;
```

Enforce fence checks in completion/failure updates and return zero rows on stale fences.

- [ ] **Step 4: Lock down functions**

Use `SECURITY DEFINER`, fixed `search_path`, revoked public execute, and explicit service-role checks. No function accepts raw SQL or arbitrary table names.

- [ ] **Step 5: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p1_24_email_claim_concurrency.sql
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Inspect grants and function search paths. Do not commit.

## Task 5: Enforce enqueue idempotency and policy snapshots

- [ ] **Step 1: Write failing idempotency tests**

`p1_25_email_idempotency.sql` must prove duplicate `idempotency_key` returns the existing outbox row and does not create a second row. Add route tests proving a database insert error returns `failed`, not `queued`.

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p1_25_email_idempotency.sql
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/enqueue.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `enqueueEmailIntent`**

`apps/web/lib/email/enqueue.ts` must:

1. validate input with Zod
2. normalize address
3. compute HMAC and mask
4. evaluate class and tenant scope
5. encrypt recipient and context
6. call `enqueue_email_intent`
7. map returned state to `queued`, `suppressed`, or `failed`

It must not directly insert through Supabase table APIs.

- [ ] **Step 4: Dual-write current producers**

Modify invite, contact, and approval producers to call the new service while retaining the legacy insert until Phase 3. If the new insert fails, return/log a truthful failure and preserve the business action's existing transaction semantics.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/enqueue.test.ts app/api/[tenant]/admin/invite app/api/contact app/api/[tenant]/approvals/action
supabase db test supabase/tests/p1_25_email_idempotency.sql
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm no producer logs plaintext recipient or context. Do not commit.

## Task 6: Implement the canonical processor and retry policy

- [ ] **Step 1: Write failing processor tests**

Cover:

- essential before campaign
- policy revalidation at dispatch
- revoked tenant preference cancels pending tenant message
- platform marketing without opt-in is suppressed
- hard bounce suppresses
- Resend accepted updates `accepted`, not `delivered`
- webhook later updates `delivered`
- `429` honors `Retry-After`
- `5xx` retries
- `401` opens provider circuit
- stale fence cannot finalize
- dead letter occurs after eight attempts
- ambiguous SMTP result remains retryable

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/processor.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `processEmailBatch`**

The processor must claim, decrypt, revalidate, render, send, and finalize one message at a time. Use `EMAIL_RATE_PER_MIN` as a process-wide token budget and provider responses for dynamic throttling. Never infer `delivered` from provider acceptance.

- [ ] **Step 4: Implement provider circuits**

`provider-factory.ts` reads and updates `email_provider_circuits`. Configuration errors open a circuit for 15 minutes; successful health/accept responses close it. Circuit state does not delete messages.

- [ ] **Step 5: Update both processor routes**

`/api/internal/email/process` is canonical. `/api/platform/email/process` becomes a compatibility adapter with identical authentication and output.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run lib/email/__tests__/processor.test.ts app/api/internal/email/__tests__/process.test.ts app/api/platform/email/__tests__/process.test.ts
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Confirm campaign rows remain disabled and essential traffic has reserved capacity. Do not commit.

## Task 7: Backfill legacy queue safely

- [ ] **Step 1: Write dry-run tests**

Add a Node test fixture with legacy `pending`, `retry`, `failed`, and `suppressed` rows. Assert dry-run reports counts/checksums without writing or printing addresses/payloads.

- [ ] **Step 2: Run and confirm failure**

```powershell
node scripts/migrate-legacy-email-outbox.mjs --dry-run
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement resumable migration**

Use a stable key `legacy-email:<legacy-id>`. Read bounded pages, encrypt in Node, call the enqueue RPC, and write batch count/checksum to `email_migration_ledger`. Map statuses exactly:

```js
const statusMap = {
  pending: 'pending',
  sent: 'accepted',
  retry: 'retry_wait',
  failed: 'dead_letter',
  suppressed: 'suppressed',
};
```

- [ ] **Step 4: Create `20260924000004_email_platform_backfill.sql`**

This migration creates no plaintext transformation. It creates migration ledger constraints and verification views/counts only.

- [ ] **Step 5: Run verification**

```powershell
node scripts/migrate-legacy-email-outbox.mjs --dry-run
supabase db reset
supabase db test supabase/tests/p1_23_email_outbox_rls.sql supabase/tests/p1_25_email_idempotency.sql
```

Expected: PASS and zero plaintext output.

- [ ] **Step 6: Review checkpoint**

Compare source/destination counts and unmigrated rows. Do not commit.

## Task 8: Add retention, user deletion, heartbeat, and readiness

- [ ] **Step 1: Write failing retention tests**

Prove:

- queue encrypted context is purged after 30 days
- accepted/suppressed/dead-letter rows purge after configured retention
- delivery logs purge after 90 days
- audit events purge after 180 days
- pending/claimed recent work is retained
- user deletion removes or transforms outbox, preferences, tokens, and test-recipient data
- maintenance is idempotent

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p1_26_email_retention.sql supabase/tests/p1_27_email_user_deletion.sql
```

Expected: FAIL.

- [ ] **Step 3: Create maintenance migration and RPCs**

`20260924000005_email_platform_maintenance.sql` creates `maintain_email_platform()` and `purge_email_for_user(user_id uuid)`. Purge functions update or delete rows in bounded loops and do not log recipient values.

- [ ] **Step 4: Update worker and readiness**

The worker calls maintenance once daily and heartbeat every interval. `/api/ready` reports non-secret queue age, heartbeat freshness, dead-letter count, and circuit state. Missing marketing/tenant campaign permissions do not make essential readiness fail.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/ready lib/email/__tests__/observability.test.ts
supabase db test supabase/tests/p1_26_email_retention.sql supabase/tests/p1_27_email_user_deletion.sql
```

Expected: PASS.

- [ ] **Step 6: Phase 2 checkpoint**

Run the full Phase 2 gate:

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
pnpm audit --prod --audit-level=high
node scripts/migrate-legacy-email-outbox.mjs --dry-run
git diff --check
git status --short
```

Confirm two-worker exclusivity, stale-fence rejection, duplicate-key collapse, encryption, retention, and disabled campaign lanes before Phase 3.
