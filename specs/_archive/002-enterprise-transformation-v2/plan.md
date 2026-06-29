# E-Logbook Enterprise Transformation Plan v2

> **Generated**: 2026-06-24 | **Scope**: Full-stack enterprise hardening (second pass) | **Target**: Production-ready medical logbook
>
> **CRITICAL**: This app handles PHI (Protected Health Information). Every issue marked CRITICAL blocks production deployment.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    E-Logbook System                          │
├────────────────────┬──────────────────────┬─────────────────┤
│   Web App          │   Mobile App          │   Shared        │
│   (Next.js 16)     │   (Expo 56 / RN 0.85)│   (TS + Zod)    │
│                    │                       │                 │
│  ┌──────────────┐  │  ┌─────────────────┐  │ ┌─────────────┐ │
│  │ Pages/Routes  │  │  │ Expo Router tabs│  │ │ Types (24)  │ │
│  │ 14 pages      │  │  │ 8 screens       │  │ │ Zod Schemas │ │
│  │ API routes    │  │  │ FlatList + Nav  │  │ │ Components  │ │
│  └──────────────┘  │  └─────────────────┘  │ │ Constants   │ │
│  ┌──────────────┐  │  ┌─────────────────┐  │ └─────────────┘ │
│  │ Components   │  │  │ Components      │  └─────────────────┘
│  │ CaseForm      │  │  │ GlassPanel      │
│  │ Dashboard     │  │  │ StatusBadge     │     Supabase Backend
│  │ Sidebar       │  │  │ ProgressRing    │  ┌─────────────────┐
│  │ Approvals     │  │  └─────────────────┘  │ │ 18 tables      │
│  └──────────────┘  │  ┌─────────────────┐  │ │ 80+ RLS policies│
│  ┌──────────────┐  │  │ Data Layer      │  │ │ 25 migrations   │
│  │ Data Layer   │  │  │ WatermelonDB    │  │ │ 4 edge functions│
│  │ Supabase SSR │  │  │ Sync Service    │  │ └─────────────────┘
│  │ Auth context │  │  │ Offline storage │
│  └──────────────┘  │  └─────────────────┘  └─────────────────────
├────────────────────┴──────────────────────┴─────────────────┤
│                    Shared Infrastructure                      │
│  pnpm workspace · Tailwind v4 · TypeScript 6 · Zod 4         │
│  GitHub Actions · Docker · Vitest · ESLint 9                  │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
┌──────────┐    HTTP/HTTPS     ┌─────────────┐    RPC+RLS    ┌──────────┐
│  Web App  │ ──────────────── │ Supabase     │ ─────────── │ Database  │
│  (Client) │   Auth + Queries │ Edge Functions│   Queries   │ (18 tbls) │
└──────────┘                   └─────────────┘              └──────────┘
                                                               ▲
┌──────────┐    Offline/Online     ┌─────────────┐             │
│  Mobile   │ ─────────────────── │ Sync Service │ ────────────┘
│  App      │   Pull/Push/Conflicts  (WatermelonDB)  Direct RPC
└──────────┘                    ┌─────────────────┐
                                │ Local SQLite DB   │
                                │ (3 tables)        │
                                └─────────────────┘
```

### Auth Flow

```
User → Magic Link / Password → Supabase Auth → JWT Token
                                                    │
                    ┌───────────────────────────────┘
                    ▼
           app_metadata: { tenant_id, user_role }
                    │
                    ▼
         RLS Policy: tenant_id + role check
         Edge Functions: authenticate() middleware
```

### Offline Sync Flow

```
pull: Server → Local DB (batch upsert, skips unsynced locals)
push: Local → Server (draft/modified entries only)
conflict: If server.updated_at > local.updated_at → overwrite
          If local.updated_at ≥ server.updated_at → flag conflict
```

---

## What Was Already Fixed (v1, 67 tasks)

These issues were resolved in the first transformation pass and should NOT be re-listed:

### Phase 1: Critical Security
- ✅ Auth bypass: `user_metadata` fallback removed, anon-key client
- ✅ Consent records RLS: `p.id` → `p.user_id`
- ✅ `SET search_path = ''` on all 18 SECURITY DEFINER functions
- ✅ `hash_patient_mrn` IMMUTABLE → STABLE
- ✅ `stripe_events` table created
- ✅ `UNIQUE(tenant_id)` on subscriptions
- ✅ Rejected→draft transition allowed
- ✅ `quota_used` column + CHECK constraint
- ✅ Mobile sync: no overwrite unsynced, NetInfo null guard, `gte` timestamp, re-entrance guard, max retries, `Q.where()` queries
- ✅ WatermelonDB schema migration handler

### Phase 2: High-Severity
- ✅ 18 dead web components deleted
- ✅ CaseForm: `useCallback` closure fix + RPC error handling
- ✅ ApprovalActions: inline error display
- ✅ CSP hardened (`unsafe-eval` dev-only) + HSTS header
- ✅ SSRF protection in ai-insights (`isValidEndpoint`)
- ✅ Rate limiting (20 req/min per tenant+resident) + LRU cache
- ✅ `generate-pdf`: server-side ownership check via `case_ids[]`
- ✅ `payment-webhook`: tenant + plan validation
- ✅ CORS: exact match only (no `startsWith`)
- ✅ `tailwind.config.ts` ESM import, `@config` directive, `--font-heading`

### Phase 3: Medium-Severity
- ✅ `as unknown as` → typed casts (6 places)
- ✅ Shared types: Subscription, StripeEvent, Payment, OneTimePurchase, ResidentAIToggle
- ✅ Zod: nullable MRN/DOB, tenant_id on frameworks, stripe_price_id on plans
- ✅ ProgressRing/ClinicalText defaults aligned
- ✅ Shared deps → peerDependencies
- ✅ Dashboard: deduplicated tenant_id filter, count:exact head queries, UTC dates, mountedRef
- ✅ All hex colors → clinicalTokens.* (15+ files)
- ✅ Batch WatermelonDB writes (batchUpsertCaseEntries, etc.)

### Phase 4: Build/CI/CD
- ✅ Vitest + jsdom + coverage configured (71 tests)
- ✅ GitHub Actions CI workflow
- ✅ Multi-stage Dockerfile
- ✅ standalone output, poweredByHeader, compress
- ✅ ESLint `off` → `warn`
- ✅ Supabase `config.toml` fully populated
- ✅ Production `app.json` (iOS+Android)

### Phase 5: Polish
- ✅ APP_NAME / GLOBAL_TENANT_ID constants
- ✅ Light mode CSS variables
- ✅ Bundle analyzer
- ✅ Memoization: 3 FlatLists + ProgressRings + filteredCases
- ✅ DESIGN.md governance
- ✅ Migration rollback plan

---

## Remaining Issues (v2 — This Plan)

### Issue Severity Legend

| Icon | Severity | Meaning |
|------|----------|---------|
| 🔴 | **CRITICAL** | Data loss, PHI exposure, privilege escalation, or complete feature failure |
| 🟠 | **HIGH** | Potential security gap, data integrity risk, or major UX failure |
| 🟡 | **MEDIUM** | Code quality, performance, or minor UX issues |
| 🔵 | **LOW** | Polish, documentation, or nice-to-have improvements |

### How to Execute

1. Start from Phase 2 (Phase 1 already complete from v1)
2. Run `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` after EVERY task
3. Read the "Double-Check" section before marking any task done
4. Do NOT skip phases

---

# PHASE 1: CRITICAL SECURITY (Already Complete)

All critical security fixes from v1 are applied. See "What Was Already Fixed" above.

---

# PHASE 2: CRITICAL REMAINING

> These are the most dangerous remaining issues — any one could cause data leaks, billing failures, or production outages.

---

### T-101: Fix SSRF Protection Async Bug in ai-insights Edge Function

**Files**: `supabase/functions/ai-insights/index.ts` (lines 60-68)

**Severity**: 🔴 CRITICAL — Security

**What to do**:
1. Read the `isValidEndpoint()` function
2. Currently, `Deno.resolveDns()` is called with `.then()`/`.catch()` but NOT awaited — the function always returns `true` because execution continues before DNS resolves
3. Make `isValidEndpoint` async and properly await the DNS check:

```typescript
async function isValidEndpoint(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    // Block IP addresses
    const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    if (ipRegex.test(hostname)) return false;
    // Block private/internal domains
    if (['.internal', '.local', 'localhost'].some(s => hostname.endsWith(s) || hostname === s)) return false;
    // DNS resolve to check for private IPs (if configured)
    if (parsed.hostname.endsWith('.custom')) {
      try {
        const addresses = await Deno.resolveDns(hostname, 'A');
        for (const addr of addresses) {
          if (addr.startsWith('10.') || addr.startsWith('192.168.') || 
              addr.startsWith('127.') || addr.startsWith('169.254.') ||
              /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return false;
        }
      } catch { return false; }
    }
    return true;
  } catch { return false; }
}
```
4. Update the call site to use `await isValidEndpoint(url)` — the caller is in an async context
5. If the function is called in a non-async-compatible path, refactor to make it work

**Verification**:
- Read the modified file and confirm `await isValidEndpoint()` is used
- The function must use `async function` and the call site must use `await`

**Double-Check**:
- The current code does `.then(() => true).catch(() => true)` — this ALWAYS returns true regardless of DNS resolution
- After the fix, if a custom endpoint resolves to `127.0.0.1` (localhost), the function should return `false`
- Test with a known-bad URL like `https://localhost:8000` — should return false

---

### T-102: Fix stripe_events RLS Policy (Broken current_user Check)

**Files**: `supabase/migrations/00021_create_stripe_events.sql` (lines 22-23)

**Severity**: 🔴 CRITICAL — Security

**What to do**:
1. Create migration `00026` to fix the RLS policy on `stripe_events`
2. The current policy uses `USING (current_user = 'service_role')` — this compares the PostgreSQL role (which is always `authenticated` or `anon`), NOT the JWT role
3. Replace with `auth.role() = 'service_role'` which checks the JWT claim:

```sql
-- Migration 00026: Fix stripe_events RLS policy
-- The previous policy used current_user which never matches service_role

-- Drop broken policy
DROP POLICY IF EXISTS "Only service role can manage stripe_events" ON stripe_events;

-- Create corrected policy using auth.role()
CREATE POLICY "Only service role can manage stripe_events"
  ON stripe_events
  FOR ALL
  USING (auth.role() = 'service_role');
```

**Verification**:
- Read the migration file and confirm `auth.role()` is used, not `current_user`
- The `auth.role()` function checks the JWT claim `role` in the access token

**Double-Check**:
- In Supabase, `current_user` returns the database role (`authenticated`, `anon`) — NEVER `service_role`
- `auth.role()` returns the JWT `role` claim, which CAN be `service_role`
- Without this fix, the `stripe_events` table is completely inaccessible (all queries fail), breaking webhook idempotency

---

### T-103: Add RLS to ai_response_cache Table

**Files**: `supabase/migrations/00018_ai_response_cache.sql`

**Severity**: 🟠 HIGH — Security

**What to do**:
1. Create migration `00027` to enable RLS and add policies for `ai_response_cache`
2. Currently, the table has NO RLS — any authenticated user can read/write cached AI responses:

```sql
-- Migration 00027: Add RLS to ai_response_cache

ALTER TABLE ai_response_cache ENABLE ROW LEVEL SECURITY;

-- Resident can read own cached responses
CREATE POLICY "Residents read own AI cache"
  ON ai_response_cache
  FOR SELECT
  USING (
    resident_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- trigger/edge function can insert new cache entries
CREATE POLICY "Insert AI cache"
  ON ai_response_cache
  FOR INSERT
  WITH CHECK (
    resident_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Cleanup function needs to delete expired entries (service role)
CREATE POLICY "Service role manages AI cache"
  ON ai_response_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

**Verification**:
- Read the migration and confirm all 3 policies exist
- Verify no authenticated user without a matching `resident_id` can read entries

**Double-Check**:
- The cleanup function `cleanup_ai_response_cache()` runs as the authenticated user, not service_role — it will be blocked by the new RLS. Either:
  - Run it via a cron job with service_role, OR
  - Add a BYPASSRLS attribute to the function: `ALTER FUNCTION cleanup_ai_response_cache() SECURITY DEFINER SET search_path = '';` — but this needs to be careful about who can call it

---

### T-104: Create Missing import_map.json for Edge Functions

**Files**: `supabase/config.toml` (line 46), `supabase/import_map.json` (missing)

**Severity**: 🟠 HIGH — Build

**What to do**:
1. Check if `import_map.json` exists at `supabase/import_map.json`
2. If missing, create it with the standard Supabase edge function imports:

```json
{
  "imports": {
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2.39.0",
    "std/": "https://deno.land/std@0.177.0/",
    "stripe": "https://esm.sh/stripe@14.14.0?target=deno&no-check",
    "openai": "https://esm.sh/openai@4.20.0?target=deno&no-check"
  }
}
```

**Verification**:
- Run: `supabase functions serve ai-insights` — should start without import errors
- Read `config.toml` and confirm `import_map = "./import_map.json"` references the correct path

**Double-Check**:
- The import map versions must match what the edge functions actually use
- Check each edge function's `import` statements to verify all imports are covered
- Deno version must be compatible with the imports (Supabase uses Deno 1.x)

---

### T-105: Fix generate-pdf (Misnamed, Missing Status Filter, PHI Leak)

**Files**: `supabase/functions/generate-pdf/index.ts`

**Severity**: 🟠 HIGH — Security

**What to do**:
1. Read the function — it returns HTML, not PDF. Either rename it or add real PDF generation
2. Add filter to only return approved cases:
   ```typescript
   const { data: dbCases, error } = await supabase
     .from('case_entries')
     .select('*, templates:case_templates(*)')
     .in('id', caseIds)
     .eq('tenant_id', tenantId)
     .eq('status', 'approved');  // ADD THIS LINE
   ```
3. Remove unnecessary PHI fields from the fetch:
   ```typescript
   // Instead of .select('*'), use:
   .select('id, case_date, field_values, template_id, templates:case_templates(specialty, name, fields)')
   ```
4. Add empty array check:
   ```typescript
   if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
     return new Response(JSON.stringify({ error: 'No cases specified' }), {
       status: 400,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
   }
   ```
5. Add a max limit on case_ids (e.g., 100):
   ```typescript
   if (caseIds.length > 100) {
     return new Response(JSON.stringify({ error: 'Too many cases (max 100)' }), {
       status: 400,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
   }
   ```

**Verification**:
- Read the modified file and confirm all 4 changes are applied
- Run `supabase functions serve generate-pdf` and test with an invalid case_id (should get 403)

**Double-Check**:
- The function name `generate-pdf` implies PDF output. If the function still returns HTML, rename the function to `generate-report` in both the deployment config and the web API route that calls it
- `patient_mrn` should NOT be fetched even if cases are approved — PHI shouldn't be in generated reports unless absolutely necessary (and even then, it should be a conscious choice)

---

# PHASE 3: DATABASE & SCHEMA

---

### T-106: Add Missing Tenant Isolation for CaseAttachment, OneTimePurchase, ApprovalRequest

**Files**: `packages/shared/src/types/database.ts` (lines 146, 257, 154)

**Severity**: 🟠 HIGH — Data Integrity

**What to do**:
1. Update the TypeScript interfaces:
   - Add `tenant_id: string` to `CaseAttachment` interface (line 146-152)
   - Add `tenant_id: string` to `OneTimePurchase` interface (line 257)
   - Add `tenant_id: string` to `ApprovalRequest` interface (line 154)

2. Create migration `00028` to add the columns to the DB:

```sql
-- Migration 00028: Add missing tenant_id for tenant isolation

ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE one_time_purchases ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- Backfill tenant_id from related tables
UPDATE case_attachments ca
  SET tenant_id = ce.tenant_id
  FROM case_entries ce
  WHERE ca.entry_id = ce.id AND ca.tenant_id IS NULL;

UPDATE one_time_purchases otp
  SET tenant_id = p.tenant_id
  FROM profiles p
  WHERE otp.resident_id = p.id AND otp.tenant_id IS NULL;

UPDATE approval_requests ar
  SET tenant_id = ce.tenant_id
  FROM case_entries ce
  WHERE ar.entry_id = ce.id AND ar.tenant_id IS NULL;

-- Make tenant_id NOT NULL after backfill
ALTER TABLE case_attachments ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE one_time_purchases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE approval_requests ALTER COLUMN tenant_id SET NOT NULL;

-- Update RLS policies to use tenant_id
DROP POLICY IF EXISTS "Case attachments accessible by tenant" ON case_attachments;
CREATE POLICY "Case attachments accessible by tenant"
  ON case_attachments FOR ALL
  USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "One time purchases accessible by tenant" ON one_time_purchases;
CREATE POLICY "One time purchases accessible by tenant"
  ON one_time_purchases FOR ALL
  USING (tenant_id = get_tenant_id());

DROP POLICY IF EXISTS "Approval requests accessible by tenant" ON approval_requests;
CREATE POLICY "Approval requests accessible by tenant"
  ON approval_requests FOR ALL
  USING (tenant_id = get_tenant_id());
```
3. Update the WatermelonDB schema (mobile) if any of these types are synced locally

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass with the new fields
- Read the migration SQL and confirm ALL 3 tables get the treatment

**Double-Check**:
- Check existing RLS policies for these 3 tables — they currently use indirect tenant checks via JOINs. The new direct `tenant_id` column is simpler AND safer
- The backfill SQL assumes relationships exist (entry_id → case_entries → tenant_id, etc.) — run on a staging DB first to verify

---

### T-107: Add Missing CHECK Constraints and Indexes for Payments/OneTimePurchases

**Files**: `supabase/migrations/00001_schema.sql`

**Severity**: 🟡 MEDIUM — Data Integrity

**What to do**:
Create migration `00029`:

```sql
-- Missing CHECK constraints
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled'));

ALTER TABLE ai_query_logs ADD CONSTRAINT ai_query_logs_tokens_used_check
  CHECK (tokens_used >= 0);

-- Missing indexes for query performance
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_intent ON payments(gateway_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_one_time_purchases_resident ON one_time_purchases(resident_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_tenant_resident ON ai_query_logs(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created_at ON ai_query_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_case_attachments_entry_id ON case_attachments(entry_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entry_id ON approval_requests(entry_id);
```

**Verification**:
- Read the migration and confirm all constraints + indexes are created
- Run: `supabase db reset` — must succeed without errors

**Double-Check**:
- The `payments_status_check` must match the allowed values in `PaymentStatus` type union in `database.ts`
- Check that existing seed data doesn't violate the new constraint before deploying

---

### T-108: Fix CaseAttachment Type with Full Audit Fields

**Files**: `packages/shared/src/types/database.ts` (line 146-152)

**Severity**: 🟡 MEDIUM — Compliance

**What to do**:
Update the `CaseAttachment` interface to include full audit trail for HIPAA compliance:

```typescript
export interface CaseAttachment {
  id: string;
  entry_id: string;
  tenant_id: string;  // ADDED
  file_path: string;
  file_name: string;   // ADDED
  file_size: number;   // ADDED
  file_type: string;
  uploaded_by: string; // ADDED (references profiles.id)
  uploaded_at: string;
}
```

Then create migration `00030` to add the columns and backfill:

```sql
-- Migration 00030: Add audit columns to case_attachments
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES profiles(id);

-- Backfill from existing data
UPDATE case_attachments 
  SET file_name = SPLIT_PART(file_path, '/', array_length(string_to_array(file_path, '/'), 1)),
      uploaded_by = ce.resident_id
  FROM case_entries ce
  WHERE case_attachments.entry_id = ce.id;
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass
- Read the migration and confirm all columns are added

**Double-Check**:
- `file_name` extraction via `SPLIT_PART` is PostgreSQL-specific but works
- Check if the mobile app uploads attachments — if so, update the mobile types too

---

### T-109: Fix ProgramGoal Missing Timestamps

**Files**: `packages/shared/src/types/database.ts` (line 200)

**Severity**: 🔵 LOW — Completeness

**What to do**:
Add `updated_at` and `deleted_at` to `ProgramGoal`:

```typescript
export interface ProgramGoal {
  // ... existing fields ...
  created_at: string;
  updated_at: string | null;   // ADDED
  deleted_at: string | null;   // ADDED
}
```

Create migration `00031`:

```sql
ALTER TABLE program_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE program_goals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION set_program_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS set_program_goals_updated_at ON program_goals;
CREATE TRIGGER set_program_goals_updated_at
  BEFORE UPDATE ON program_goals
  FOR EACH ROW EXECUTE FUNCTION set_program_goals_updated_at();
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass
- Read the migration and confirm both columns and trigger exist

**Double-Check**:
- The mobile sync service syncs `ProgramGoal` — ensure the local schema matches: `apps/mobile/lib/db/schema.ts`

---

### T-110: Fix Institution.tier Type Collapse

**Files**: `packages/shared/src/types/database.ts` (line 12)

**Severity**: 🔵 LOW — Type Quality

**What to do**:
The union `'free' | 'premium' | 'enterprise' | string` collapses to just `string` in TypeScript. Fix:

```typescript
export interface Institution {
  id: string;
  name: string;
  slug: string;
  tier: 'free' | 'premium' | 'enterprise';  // Remove | string
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass

**Double-Check**:
- If any code does `institution.tier = someString`, it will now fail typecheck. Fix those assignments by casting to the union
- The DB has a CHECK constraint `tier IN ('free', 'premium', 'enterprise')` so runtime values are safe

---

# PHASE 4: EDGE FUNCTIONS

---

### T-111: Fix In-Memory Rate Limiting to Use DB (Cross-Instance)

**Files**: `supabase/functions/ai-insights/index.ts`

**Severity**: 🟡 MEDIUM — Security

**What to do**:
Replace the in-memory `rateLimitMap` with database-backed rate limiting. The current approach is bypassed when multiple edge function instances handle requests:

1. Remove the in-memory Map and `setInterval` cleanup
2. Instead, query the existing `ai_query_logs` table:

```typescript
async function checkRateLimitDb(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  residentId: string
): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supabase
    .from('ai_query_logs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('resident_id', residentId)
    .gte('created_at', since);

  if (error) {
    console.error('Rate limit check error:', error);
    return true; // Fail open — allow request on DB error
  }

  return (count ?? 0) < 20; // 20 requests per minute
}
```

3. Call this function instead of `checkRateLimit(user.id)` in the request handler
4. The function already uses the user-scoped Supabase client (from `authenticate()`), which has RLS restricting queries to the user's tenant

**Verification**:
- Read the modified file and confirm the DB-backed rate limiter is used
- The `rateLimitMap` and its `setInterval` cleanup should be removed

**Double-Check**:
- The `head: true` option ensures only the count is returned, not the rows — efficient
- The `gte('created_at', since)` uses the index from migration 00025 (BRIN index on created_at) for performance
- Remove the imports for `setInterval` and `Map` if they become unused

---

### T-112: Fix payment-webhook O(n) Gateway Config Iteration

**Files**: `supabase/functions/payment-webhook/index.ts`

**Severity**: 🟡 MEDIUM — Performance

**What to do**:
The current code fetches ALL active Stripe gateway configs and iterates through each one to verify the webhook signature. As the platform grows, this becomes O(n) per webhook call:

1. Add a Stripe webhook secret to the webhook event metadata or use a dedicated config per Stripe account
2. Alternative: cache the gateway configs with a last-fetched timestamp:

```typescript
let cachedConfigs: { id: string; secret: string; stripeAccountId?: string }[] | null = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 300_000; // 5 minutes

async function getGatewayConfigs(supabase: any) {
  const now = Date.now();
  if (cachedConfigs && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return cachedConfigs;
  }
  const { data } = await supabase
    .from('payment_gateway_config')
    .select('id, encrypted_webhook_secret, settings')
    .eq('is_active', true);
  cachedConfigs = (data ?? []).map((c: any) => ({
    id: c.id,
    secret: c.encrypted_webhook_secret,
    stripeAccountId: c.settings?.stripe_account_id,
  }));
  configCacheTime = now;
  return cachedConfigs;
}
```

3. Add Stripe Account ID to metadata for faster lookup (optional but recommended for multi-tenant Stripe)

**Verification**:
- Read the modified file and confirm caching is implemented
- The cache should have a reasonable TTL (5 minutes)

**Double-Check**:
- The cache only helps within a single edge function instance — across instances, each still does O(n). A DB-based approach with config keys indexed by `stripe_account_id` would be ideal but requires schema changes
- Cache invalidation: if a tenant updates their gateway config, it takes up to 5 minutes to take effect

---

### T-113: Add Timeout and Error Handling to export-pdf API Route

**Files**: `apps/web/app/api/[tenant]/export-pdf/route.ts`

**Severity**: 🟡 MEDIUM — Reliability

**What to do**:
1. Read the API route file
2. Add a timeout to the `supabase.functions.invoke` call:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30_000);

try {
  const pdfResponse = await supabase.functions.invoke('generate-pdf', {
    body: { case_ids, resident_name, tenant },
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  // ... rest of handling
} catch (err) {
  clearTimeout(timeoutId);
  if ((err as any)?.name === 'AbortError') {
    return new Response(JSON.stringify({ error: 'PDF generation timed out' }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'Failed to generate PDF' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}
```
3. Add proper error handling for undefined `pdfResponse`:
```typescript
if (!pdfResponse) {
  return new Response(JSON.stringify({ error: 'No response from PDF generator' }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

**Verification**:
- Read the modified file and confirm both timeout + null checks
- Try to hit the endpoint with an invalid body — should get a proper error response, not a crash

**Double-Check**:
- The `AbortController` timeout must be cleared in BOTH success and error paths to prevent memory leaks
- The timeout duration (30s) should match the edge function's execution limit

---

### T-114: Add Rate Limiting to create-checkout Endpoint

**Files**: `supabase/functions/create-checkout/index.ts`

**Severity**: 🔵 LOW — Security

**What to do**:
Add simple rate limiting to prevent abuse of checkout session creation:

```typescript
// At the top of the function body, after authentication:
const rateLimitKey = `checkout:${user.id}`;
const rateLimitWindow = 60_000; // 1 minute
const maxCheckouts = 5; // max 5 checkout sessions per minute

// Use the ai_query_logs pattern or a simple memory Map
// (Since this is a webhook-triggered action, per-user rate limiting in memory is acceptable)
```

**Verification**:
- Read the modified file and confirm rate limiting is in place
- Rapid requests should return 429

**Double-Check**:
- The rate limit prevents a malicious admin from creating hundreds of Stripe checkout sessions
- 5 per minute per user is generous for normal usage

---

# PHASE 5: MOBILE APP

---

### T-115: Remove Hardcoded Supabase Credentials from app.json

**Files**: `apps/mobile/app.json` (lines 55-56)

**Severity**: 🟠 HIGH — Security

**What to do**:
1. Read `apps/mobile/app.json` — the `extra` section contains hardcoded Supabase URL and anon key
2. Remove the hardcoded values:
```json
"extra": {
  "supabaseUrl": "",
  "supabaseAnonKey": ""
}
```
3. Verify that `apps/mobile/lib/supabase.ts` already has a fallback to `process.env.EXPO_PUBLIC_SUPABASE_URL` (it does, line 6)
4. Ensure `.env` file at `apps/mobile/.env` has:
```
EXPO_PUBLIC_SUPABASE_URL=<SUPABASE_PROJECT_ID>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```
5. Add `apps/mobile/.env` to `.gitignore` root (verify it's already there — check line ~20)
6. For EAS builds, configure secrets in the EAS dashboard or use `eas secret:create`

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- Read `lib/supabase.ts` and confirm the fallback chain: `expoConfig.extra` → `process.env.EXPO_PUBLIC_*`
- Verify `.env` is in `.gitignore`

**Double-Check**:
- The `app.json` `extra` values take precedence over env vars at build time in some Expo configurations
- If removed, developers MUST have the `.env` file or EAS secrets configured to build
- The anon key is designed to be public (RLS-protected), but committing it to git is still bad practice

---

### T-116: Add Mobile Test Framework

**Files**: `apps/mobile/package.json` (missing test config)

**Severity**: 🟠 HIGH — Process

**What to do**:
1. Add test dependencies:
```bash
pnpm --filter @elogbook/mobile add -D vitest @testing-library/react-native
```

2. Create `apps/mobile/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
  },
});
```

3. Add test scripts to `apps/mobile/package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

4. Create a basic smoke test `apps/mobile/__tests__/app.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Mobile App', () => {
  it('should load without crashing', () => {
    expect(true).toBe(true);
  });
});
```

5. Update root `package.json` test script to run all workspace tests:
```json
"test": "vitest run --reporter verbose"
```

**Verification**:
- `pnpm --filter @elogbook/mobile test` — must run and pass
- Root `pnpm test` — should run all workspace tests

**Double-Check**:
- `@testing-library/react-native` requires a React Native environment — for component tests, consider adding `react-native` mock to vitest config
- Pure unit tests (non-component) work with `environment: 'node'`

---

### T-117: Fix Stale Closure in log-case.tsx setTimeout

**Files**: `apps/mobile/app/(tabs)/log-case.tsx` (line 198)

**Severity**: 🟠 HIGH — Data Integrity

**What to do**:
1. Read the `handleSubmit` function around line 108-206
2. Find the `setTimeout` that resets state after 2 seconds (line 194-205)
3. The `confirmationSuccess` state is captured in a stale closure — use a ref instead:

```typescript
const confirmationTypeRef = useRef<'offline' | 'submitted' | null>(null);

// In handleSubmit, when showing confirmation:
confirmationTypeRef.current = isOnline ? 'submitted' : 'offline';

// In setTimeout:
setTimeout(() => {
  if (confirmationTypeRef.current === 'submitted') {
    setStep(0);
    setSelectedTemplate(null);
    setFieldValues({});
    setPatientMrn('');
    setPatientDob('');
    setPatientAgeYears('');
    setCaseDate('');
    setIsDeidentified(false);
    setConfirmationSuccess(false);
  } else if (confirmationTypeRef.current === 'offline') {
    setStep(0);
    setSelectedTemplate(null);
    setFieldValues({});
    setConfirmationSuccess(false);
  }
  confirmationTypeRef.current = null;
}, 2000);
```

**Verification**:
- Read the modified file and confirm a ref is used instead of stale state
- Trace the logic: handleSubmit → set confirmationTypeRef → timeout reads ref → correct value

**Double-Check**:
- The `useRef` import must be added (check if already imported at line 1)
- Refs don't trigger re-renders — the `confirmationSuccess` state still controls the modal visibility via JSX, only the timeout callback reads the ref

---

### T-118: Fix log-case Validation Error Not Displayed to User

**Files**: `apps/mobile/app/(tabs)/log-case.tsx` (lines 129-133)

**Severity**: 🟡 MEDIUM — UX

**What to do**:
1. Read the validation code — `const firstError = validation.error.issues[0]` is computed but never used
2. Add error state and display:

```typescript
// Add state:
const [validationError, setValidationError] = useState<string | null>(null);

// In handleSubmit, after validation failure:
if (!validation.success) {
  const firstError = validation.error.issues[0];
  setValidationError(firstError?.message ?? 'Invalid case data');
  return;
}

// Clear error on successful validation:
setValidationError(null);

// In the render, add error display (after the template selection or before submit button):
{validationError && (
  <View className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4">
    <Text className="text-red-400 text-sm" style={{ fontFamily: clinicalTokens.fonts.body }}>
      {validationError}
    </Text>
  </View>
)}
```

**Verification**:
- Read the modified file and confirm the validation error is displayed
- Test with intentionally invalid data (e.g., empty date) — should see the error message

**Double-Check**:
- Clear the error when the user makes a correction — `setValidationError(null)` should be called in field change handlers
- The first error message from Zod might not be user-friendly — consider mapping error paths to friendly messages

---

### T-119: Remove Dead Code (Self-Navigation in Profile, Unused Hook)

**Files**: 
- `apps/mobile/app/(tabs)/profile.tsx` (line 170-171)
- `apps/mobile/components/case-log/useTemplateLoader.ts` (entire file)

**Severity**: 🔵 LOW — Code Quality

**What to do**:
1. In `profile.tsx`, replace the dead "Manage Subscription" navigation:
```typescript
// Instead of:
// router.push('/(tabs)/profile' as any);

// Show a placeholder or open a URL:
const handleManageSubscription = () => {
  // TODO: Implement subscription management page
  // For now, show a message
  Alert.alert('Coming Soon', 'Subscription management will be available in a future update.');
};
```

2. Delete `apps/mobile/components/case-log/useTemplateLoader.ts` (confirmed unused — `log-case.tsx` loads templates inline)
3. Remove the unused `firstError` variable in `log-case.tsx` line 131 (if not already removed by T-118)

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- Search for any remaining imports of `useTemplateLoader` — should be 0

**Double-Check**:
- Before deleting `useTemplateLoader.ts`, confirm NO other file imports it: `grep -r "useTemplateLoader" apps/mobile/`
- The subscription management placeholder should be intentional — don't just silently hide the button

---

### T-120: Fix NetInfo null Handling in All Screens

**Files**: `apps/mobile/app/(tabs)/*.tsx` (all screens that use NetInfo)

**Severity**: 🟡 MEDIUM — Reliability

**What to do**:
1. Search for all instances of `state.isConnected === false` across mobile screens
2. Replace with `state.isConnected !== true` which correctly handles `null`:

```typescript
// Before (buggy — null treated as connected):
NetInfo.addEventListener((state) => {
  setIsOffline(state.isConnected === false);
});

// After (correct — null treated as offline):
NetInfo.addEventListener((state) => {
  setIsOffline(state.isConnected !== true);
});
```

Files to check:
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/my-cases.tsx`  
- `apps/mobile/app/(tabs)/case-detail.tsx`
- `apps/mobile/app/(tabs)/approvals.tsx`
- `apps/mobile/app/(tabs)/ai-insights.tsx`
- `apps/mobile/app/(tabs)/log-case.tsx`

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- Check all 6 files for the pattern

**Double-Check**:
- `NetInfoState.isConnected` is `boolean | null` — on first load, it's often `null`
- Treating `null` as "connected" (old code) means the app thinks it's online when it might not be — dangerous for a medical app that needs to sync data
- The `lib/sync.ts` already has this fixed (uses `!== true`)

---

### T-121: Fix case-detail to Load from Local DB First (Online-Only Bug)

**Files**: `apps/mobile/app/(tabs)/case-detail.tsx`

**Severity**: 🟡 MEDIUM — Offline Reliability

**What to do**:
Currently, `case-detail.tsx` fetches from Supabase directly — if the user is offline, they cannot view case details. Fix:

1. First, try to load from local WatermelonDB:

```typescript
// At the top of loadCase, add local fallback:
const db = getDatabase();
const localEntry = await db.get<CaseEntry>('case_entries')
  .find(caseId)
  .catch(() => null);

if (localEntry) {
  // Use local data as the base
  setCaseDetail(convertLocalEntryToDetail(localEntry));
  setLoading(false);
  // Optionally still try network refresh
}
```

2. If online, also fetch from Supabase and update local:
```typescript
if (isOnline) {
  const { data: entry, error } = await supabase
    .from('case_entries')
    .select('*, templates:case_templates(*), profiles!case_entries_resident_id_fkey(full_name, specialty), approval_requests!approval_requests_entry_id_fkey(status, comment, requested_at, profiles!approval_requests_supervisor_id_fkey(full_name))')
    .eq('id', caseId)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (entry && !error) {
    setCaseDetail(entry);
    // Sync to local DB for offline access
    await upsertCaseEntry(entry as Record<string, unknown>);
  }
}
```

**Verification**:
- Read the modified file and confirm local DB is checked first
- In airplane mode, previously-viewed cases should still be accessible

**Double-Check**:
- The `isOnline` state is already tracked via NetInfo in the component
- The `convertLocalEntryToDetail` function needs to map WatermelonDB fields to the Supabase join structure
- Full template/profiles data may not be in local DB — need to handle missing data gracefully

---

### T-122: Fix Hardcoded Foreign Key Names in Approvals and Case-Detail

**Files**: 
- `apps/mobile/app/(tabs)/approvals.tsx` (line 131)
- `apps/mobile/app/(tabs)/case-detail.tsx` (line 80-87)

**Severity**: 🟡 MEDIUM — Fragility

**What to do**:
The Supabase queries use hardcoded FK constraint names like `profiles!approval_requests_supervisor_id_fkey` — if Supabase generates different constraint names (which happens with different versions), the queries break silently.

Replace with proper Supabase join syntax that doesn't rely on FK names:

```typescript
// Instead of:
.profiles!approval_requests_supervisor_id_fkey(full_name)

// Use:
.profiles(full_name)
```

Actually, the correct Supabase JS join syntax for disambiguating multiple foreign keys is:
```typescript
.profiles!supervisor_id(full_name)
```

Or, if there's only one FK relationship from the table, just:
```typescript
.profiles(full_name)
```

**Verification**:
- Read both files and replace the hardcoded FK constraint names
- The query should still work — Supabase infers the correct FK relationship

**Double-Check**:
- If a table has multiple FKs to the same referenced table (e.g., `approval_requests` has both `supervisor_id` → `profiles.id` and maybe another FK), you need to specify which FK column to use
- Test the query against the actual database to ensure the join resolves correctly

---

# PHASE 6: WEB APP

---

### T-123: Fix CSP to Remove unsafe-inline in Production via Nonce

**Files**: `apps/web/next.config.js` (line 26)

**Severity**: 🟠 HIGH — Security

**What to do**:
1. Read `next.config.js` — the CSP currently allows `'unsafe-inline'` for scripts in production
2. Add a nonce-based CSP using Next.js's built-in support:

```javascript
const nextConfig = {
  // ... existing config
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // ... existing headers
          {
            key: 'Content-Security-Policy',
            value: process.env.NODE_ENV === 'development'
              ? `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co;`
              : `default-src 'self'; script-src 'self' 'strict-dynamic' 'nonce-${process.env.CSP_NONCE}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co;`,
          },
        ],
      },
    ];
  },
};
```

**Note**: Full nonce support requires integrating with Next.js's `next/script` component. A simpler interim fix:

```javascript
// Strip unsafe-inline for production, keeping only what's needed:
const scriptSrc = process.env.NODE_ENV === 'development'
  ? "'self' 'unsafe-eval' 'unsafe-inline'"
  : "'self'";  // Remove unsafe-inline — Next.js 16 handles inline scripts via SSR

// If inline scripts are needed, add nonce support via middleware:
// https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
```

**Verification**:
- Run `pnpm build:web` — must succeed
- Check the CSP header in browser devtools on production build

**Double-Check**:
- Removing `'unsafe-inline'` may break some Next.js features that rely on inline scripts
- Test thoroughly: client-side navigation, auth redirects, form submissions
- For a medical app, the security benefit of removing unsafe-inline outweighs minor compatibility concerns

---

### T-124: Fix N+1 Query Waterfall in Dashboard and Goals Pages

**Files**: 
- `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx` (line 88-97)
- `apps/web/app/(authenticated)/[tenant]/goals/page.tsx` (line 36-43)

**Severity**: 🟡 MEDIUM — Performance

**What to do**:
In `dashboard/page.tsx`:
```typescript
// Before (waterfall — goals fetched after Promise.all):
const [casesResult, goalResult, residentsResult] = await Promise.all([
  supabase.from('case_entries').select(/* ... */),
  supabase.from('program_goals').select(/* ... */),
  role === 'director' ? supabase.from('profiles').select(/* ... */) : Promise.resolve({ data: null }),
]);

// After (all in parallel — move the goal progress into the Promise.all):
const queries: Promise<any>[] = [
  supabase.from('case_entries').select(/* ... */),
  supabase.from('program_goals').select(/* ... */),
];
if (role === 'resident') {
  queries.push(supabase.from('goal_progress').select('current_count, goal_id').eq('resident_id', userId));
}
if (role === 'director') {
  queries.push(supabase.from('profiles').select(/* ... */));
}
const [casesResult, goalResult, progressResult, residentsResult] = await Promise.all(queries);
```

**Verification**:
- Read the modified files and confirm all DB queries are in a single `Promise.all`
- Count the number of sequential `await` calls — should be only 1 for data fetching

**Double-Check**:
- For `dashboard/page.tsx`, the goal progress query (line 88-93) currently runs AFTER `Promise.all`, creating a waterfall
- Moving it INTO the `Promise.all` reduces total page load time
- Handle the case where `progressResult` might be `undefined` (for non-resident roles)

---

### T-125: Fix Unsafe Type Casts (as unknown as, as any) in Pages

**Files**: Multiple — see list below

**Severity**: 🟡 MEDIUM — Type Safety

**What to do**:
Replace each `as unknown as` and unsafe `as` cast with proper typing:

1. **`apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`** (lines 71, 86):
   ```typescript
   // Before:
   (casesResult.data ?? []) as unknown as (CaseRow & { resident_id?: string })[]
   // After:
   (casesResult.data ?? []) satisfies (CaseRow & { resident_id?: string })[]
   ```
   Or create a properly typed variable and use `const` assertion.

2. **`apps/web/app/(authenticated)/[tenant]/layout.tsx`** (line 48):
   ```typescript
   // Before:
   auth.subscription?.status as 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled'
   // After:
   const VALID_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'canceled'] as const;
   type ValidStatus = typeof VALID_STATUSES[number];
   const subStatus = (VALID_STATUSES.includes(auth.subscription?.status as ValidStatus) 
     ? auth.subscription?.status 
     : 'active') as ValidStatus;
   ```

3. **`apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`** (line 72):
   ```typescript
   // Before:
   r.status as CaseStatus
   // After:
   if (!['draft', 'pending', 'approved', 'rejected'].includes(r.status)) {
     console.warn(`Unexpected case status: ${r.status}`);
     continue; // or handle gracefully
   }
   const status = r.status as CaseStatus;
   ```

4. **`apps/web/app/(authenticated)/[tenant]/reports/page.tsx`** (line 63)
5. **`apps/web/app/(authenticated)/[tenant]/billing/page.tsx`** (line 47)
6. **`apps/web/components/CaseForm.tsx`** (line 218)
7. **`apps/web/components/case-form/CaseDetailsStep.tsx`** (line 103)

Use proper Zod validation or at minimum use `satisfies` instead of `as` where possible.

**Verification**:
- `pnpm --filter @elogbook/web typecheck` — must pass
- Count of `as unknown as` in `apps/web/` should be 0

**Double-Check**:
- The `satisfies` keyword validates that a type matches without widening
- For Supabase query results, consider using the auto-generated types from `supabase gen types` or the existing Zod schemas with `.parse()`
- Each fix is independent — fix them one at a time to avoid cascading errors

---

### T-126: Fix Missing Error Handling in Submit Route

**Files**: `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts` (line 56)

**Severity**: 🟠 HIGH — Data Integrity

**What to do**:
1. Read the submit route — the approval requests INSERT has NO error handling
2. If the approval requests insert fails, the case status is already updated to 'pending' but nobody can approve it
3. Add error handling:

```typescript
// After updating case status to 'pending', add error handling for approval request creation:
const { error: approvalError } = await supabase
  .from('approval_requests')
  .insert(approvalRequests);

if (approvalError) {
  // Rollback the case status to 'draft'
  await supabase
    .from('case_entries')
    .update({ status: 'draft' })
    .eq('id', caseId);
  
  return new Response(JSON.stringify({ 
    error: 'Failed to create approval requests. Case has been returned to draft.' 
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
```

**Verification**:
- Read the modified file and confirm the approval error is handled
- If `approvalError` exists, the case should be rolled back to draft

**Double-Check**:
- This fix prevents the "case is pending but no one can approve it" data integrity bug
- Consider wrapping both operations (status update + approval insert) in a Supabase transaction function if possible
- The rollback could also fail — in that case, log the error and return a 500 anyway

---

### T-127: Fix Duplicate CSS Class .badge-draft in globals.css

**Files**: `apps/web/app/globals.css` (lines 138-146 and 181-189)

**Severity**: 🔵 LOW — Code Quality

**What to do**:
1. Read `globals.css` — `.badge-draft` is defined TWICE with identical content
2. Remove the second definition (lines 181-189):

```css
/* Remove this entire block (lines 181-189):
.badge-draft {
  background: color-mix(in srgb, var(--color-neutral-light) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-neutral-light) 20%, transparent);
  color: var(--color-neutral-light);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}
*/
```

**Verification**:
- `pnpm build:web` — must succeed
- Search for `.badge-draft {` in globals.css — should find only 1 definition

**Double-Check**:
- Removing a duplicate class definition has no visual effect — the first definition wins
- Check that no other class depends on the second definition's position in the cascade

---

### T-128: Fix Duplicate SimpleCounter Component

**Files**: 
- `apps/web/components/approvals/ApprovalsDashboard.tsx` (lines 10-31)
- `apps/web/components/approvals/SimpleCounter.tsx`
- `apps/web/components/approvals/index.ts`

**Severity**: 🔵 LOW — Code Quality

**What to do**:
1. The `ApprovalsDashboard.tsx` defines its own local `SimpleCounter` (lines 10-31), even though `SimpleCounter.tsx` exists as a separate file and is exported from `index.ts`
2. Remove the local version and use the imported one:

In `ApprovalsDashboard.tsx`:
```typescript
// Remove lines 10-31 (the local SimpleCounter definition)
// Keep the import from index.ts (or add it if missing):
import { SimpleCounter } from './SimpleCounter';
```

**Verification**:
- `pnpm --filter @elogbook/web typecheck` — must pass
- The ApprovalsDashboard should still render SimpleCounter correctly

**Double-Check**:
- The local version might have slight prop differences from the exported version — compare them before deleting
- If they're identical, the delete is safe; if different, keep the better one or merge them

---

# PHASE 7: SHARED PACKAGE

---

### T-129: Fix CaseTemplate Schema — Validate Required Fields Subset

**Files**: `packages/shared/src/schemas/cases.ts` (line 11-16)

**Severity**: 🟡 MEDIUM — Data Integrity

**What to do**:
Add a `.refine()` to `caseTemplateSchema` to validate that `required_fields` is a subset of `fields[*].key`:

```typescript
export const caseTemplateSchema = z.object({
  specialty: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
  required_fields: z.array(z.string()),
}).refine(
  (data) => {
    const fieldKeys = new Set(data.fields.map(f => f.key));
    return data.required_fields.every(k => fieldKeys.has(k));
  },
  {
    message: 'All required_fields must exist in fields[].key',
    path: ['required_fields'],
  }
);
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass
- `pnpm test` — the existing tests should still pass (and may need a new test for the refine)

**Double-Check**:
- The `.refine()` runs on the PARSED data, after schema validations pass
- An invalid template (required_fields referring to non-existent keys) will now fail validation
- Update the tests in `__tests__/cases.test.ts` to test the refine

---

### T-130: Add Min Length to caseEntryDeidentifiedSchema.patient_hash

**Files**: `packages/shared/src/schemas/cases.ts` (line 28)

**Severity**: 🔵 LOW — Data Quality

**What to do**:
Add `.min(1)` constraint to `patient_hash`:

```typescript
patient_hash: z.string().min(1).max(128),
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass
- `pnpm test` — must pass

**Double-Check**:
- An empty patient_hash would bypass the current validation (only `.max(128)` is set)
- The hash is used for de-identified patient matching — an empty hash would match everything

---

### T-131: Align inviteUserSchema.specialty with profileSchema Constraint

**Files**: `packages/shared/src/schemas/auth.ts` (line 12)

**Severity**: 🔵 LOW — Consistency

**What to do**:
Add `.max(100)` to match `profileSchema`:

```typescript
specialty: z.string().max(100).optional(),
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass

**Double-Check**:
- The `profileSchema` has `.max(100)` on specialty — the invite schema should match
- This prevents inviting a user with an unreasonably long specialty name

---

### T-132: Remove Redundant clinicalColors Duplicate in Design Tokens

**Files**: `packages/shared/src/constants/design-tokens.ts` (lines 46-56)

**Severity**: 🔵 LOW — Maintainability

**What to do**:
1. The `clinicalColors` object at line 46 duplicates a subset of `clinicalTokens.colors`
2. Remove `clinicalColors` and update all consumers to use `clinicalTokens.colors.*` directly:

```typescript
// Remove these lines (46-56):
export const clinicalColors = {
  backdrop: clinicalTokens.colors.backdrop.dark,
  surface: clinicalTokens.colors.neutral.dark,
  primary: clinicalTokens.colors.primary.DEFAULT,
  secondary: clinicalTokens.colors.secondary.DEFAULT,
  border: clinicalTokens.colors.border.DEFAULT,
  text: {
    primary: clinicalTokens.colors.text.primary,
    secondary: clinicalTokens.colors.text.secondary,
    muted: clinicalTokens.colors.text.muted,
  },
} as const;
```

3. Search for all imports of `clinicalColors` across the codebase:
```bash
grep -r "clinicalColors" apps/ packages/
```

4. Replace each usage with the equivalent `clinicalTokens.colors.*` path

**Verification**:
- `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass

**Double-Check**:
- `clinicalColors` is used in various components — find ALL references before removing
- Common replacements: `clinicalColors.backdrop` → `clinicalTokens.colors.backdrop.dark`, etc.
- This change removes a maintenance burden (duplicate token definitions must be kept in sync)

---

### T-133: Remove design-tokens.config.js Duplicate

**Files**: `packages/shared/design-tokens.config.js`

**Severity**: 🔵 LOW — Maintainability

**What to do**:
1. Verify that `apps/web/tailwind.config.ts` already imports from the TypeScript source (it does — `@elogbook/shared/src/constants/design-tokens`)
2. If no other file imports `design-tokens.config.js`, delete it:

```bash
# Check for references:
grep -r "design-tokens.config.js" apps/ packages/ supabase/
```

3. If no references found, delete the file
4. If references exist, update them to import from the TS source instead

**Verification**:
- `pnpm build:web` — must succeed
- `pnpm --filter @elogbook/web typecheck` — must pass

**Double-Check**:
- The JS file was needed when Tailwind config used CJS `require()` — since it's now ESM `import`, the JS file is redundant
- Deleting it reduces the maintenance burden of keeping two token definitions in sync

---

### T-134: Fix ProgressRing Native Font Size Divergence

**Files**: `packages/shared/src/components/ProgressRing.native.tsx` (line 121)

**Severity**: 🟡 MEDIUM — Visual Consistency

**What to do**:
Align the native ProgressRing font size with the web version:

```typescript
// Native: current (line 121)
fontSize: size * 0.18,

// Web: (line 86 in web version)
fontSize: size * 0.22,

// Fix native to match web:
fontSize: size * 0.22,
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck` — must pass
- The progress rings should now have identical text sizing on both platforms

**Double-Check**:
- The native version uses `SVG Text` while the web version uses HTML `<text>` — font rendering differs between platforms even at the same `fontSize` value
- Consider testing on both platforms to verify visual parity
- If the rendered size still looks different, adjust to `size * 0.20` as a middle ground

---

### T-135: Fix Native StatusBadge — Implement Glow and Align Border Source

**Files**: `packages/shared/src/components/StatusBadge.native.tsx`

**Severity**: 🟡 MEDIUM — Visual Consistency

**What to do**:
1. Currently the `glow` property is computed but never rendered (dead code)
2. Add the glow effect to the native StatusBadge:

```typescript
// In the container style, add the shadow (iOS) or elevation (Android):
const containerStyle: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: 999,
  backgroundColor: config.bg,
  borderWidth: 1,
  borderColor: config.border,  // Use dedicated border color like web
};

// Add glow on iOS:
if (Platform.OS === 'ios' && config.glow) {
  containerStyle.shadowColor = config.glow;
  containerStyle.shadowOffset = { width: 0, height: 0 };
  containerStyle.shadowRadius = 6;
  containerStyle.shadowOpacity = 0.5;
}
```

3. Update the `statusColors` to include a `border` property (matching the web pattern), not reuse `dot` for border:

```typescript
const statusColors: Record<string, { dot: string; bg: string; border: string; glow?: string }> = {
  draft: {
    dot: '#94A3B8',
    bg: 'rgba(148, 163, 184, 0.1)',
    border: 'rgba(148, 163, 184, 0.2)',
  },
  pending: {
    dot: '#FCD34D',
    bg: 'rgba(252, 211, 77, 0.15)',
    border: 'rgba(252, 211, 77, 0.3)',
    glow: 'rgba(252, 211, 77, 0.4)',
  },
  // ... etc for approved, rejected
};
```

**Verification**:
- `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/mobile typecheck` — must pass

**Double-Check**:
- React Native doesn't support `boxShadow` on Android; use `elevation: 4` as an alternative
- The `Platform.OS` check prevents iOS-only shadow props from crashing on Android
- The glow effect is subtle — a soft colored shadow around the badge, matching the web appearance

---

# PHASE 8: BUILD & CI/CD

---

### T-136: Fix CI Pipeline — Add Dependency Caching and Supabase Checks

**Files**: `.github/workflows/ci.yml`

**Severity**: 🟡 MEDIUM — Process

**What to do**:
1. Add a pnpm store cache to avoid downloading packages 4 times:

```yaml
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - run: pnpm --filter @elogbook/shared typecheck
      - run: pnpm --filter @elogbook/web typecheck
      - run: pnpm --filter @elogbook/mobile typecheck
```

2. Add a `validate-migrations` job that checks migration files:

```yaml
  validate-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate migration order
        run: |
          # Check that migration numbers are sequential
          for f in supabase/migrations/*.sql; do
            echo "Found: $f"
          done
          # Check for migrations after the latest that aren't applied yet
          echo "Migration file validation passed"
```

3. Add `needs:` constraints to ensure tests pass before building:

```yaml
  build:
    needs: [typecheck, lint, test]
    runs-on: ubuntu-latest
    # ...
```

**Verification**:
- Verify the YAML syntax is valid (can be checked with `node -e "require('js-yaml').load(fs.readFileSync('.github/workflows/ci.yml','utf8'))"`)
- Push a branch and check that CI runs

**Double-Check**:
- Using `needs:` means the build job waits for typecheck/lint/test to pass
- The pnpm store cache reduces install time from ~30s to ~5s per job
- The migration validation job is a simple file check — can be enhanced later

---

### T-137: Add .dockerignore File

**Files**: `.dockerignore` (missing)

**Severity**: 🟡 MEDIUM — Build

**What to do**:
Create `.dockerignore` to reduce Docker build context size:

```
.git
.gitignore
node_modules
.next
.expo
coverage
.superpowers
.opencode
.specify
README.md
DESIGN.md
docs
pnpm-lock.yaml
*.md
.vscode
.idea
.env
.env.local
```

**Verification**:
- `docker build -t elogbook-web .` — should build faster with much less context sent to the Docker daemon

**Double-Check**:
- Without `.dockerignore`, the entire project directory (including `node_modules/` which can be 1GB+) is sent as build context
- The `pnpm-lock.yaml` is excluded because it's copied explicitly in the Dockerfile (layer caching)
- `.git` at 50-100MB is the biggest unnecessary file — excluding it saves significant time

---

### T-138: Pin pnpm Version in Dockerfile

**Files**: `Dockerfile` (line 2)

**Severity**: 🔵 LOW — Build Reliability

**What to do**:
Replace `pnpm@latest` with a specific major version:

```dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm@10
```

**Verification**:
- `docker build -t elogbook-web .` — must succeed

**Double-Check**:
- `pnpm@latest` can break the build when pnpm releases a major version with breaking changes
- Pin to the current major version (10 or 11 depending on what's installed)
- Check `pnpm --version` to determine the current major version

---

### T-139: Add Root tsconfig.json with Project References

**Files**: `tsconfig.json` (root — missing)

**Severity**: 🔵 LOW — Developer Experience

**What to do**:
Create a root `tsconfig.json` that enables project references for the monorepo:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "references": [
    { "path": "packages/shared" },
    { "path": "apps/web" },
    { "path": "apps/mobile" }
  ],
  "exclude": ["node_modules"]
}
```

Update each package's `tsconfig.json` to add `"composite": true`:
- `packages/shared/tsconfig.json`: add `"composite": true` in compilerOptions
- `apps/web/tsconfig.json`: add `"composite": true` in compilerOptions
- `apps/mobile/tsconfig.json`: add `"composite": true` in compilerOptions

**Verification**:
- `tsc --build` from root — should build all packages with project references
- `pnpm -r typecheck` — should still work

**Double-Check**:
- Adding `composite: true` requires that the `include` pattern only matches files meant for compilation — test files should be excluded
- Project references enable incremental builds — changing shared code only rebuilds shared, not web+mobile
- VS Code uses the root tsconfig.json for project-wide IntelliSense

---

### T-140: Add Typecheck Script to Root package.json

**Files**: `package.json` (root)

**Severity**: 🔵 LOW — Developer Experience

**What to do**:
Add a root-level typecheck script:

```json
"scripts": {
  "typecheck": "pnpm -r typecheck",
  // ... existing scripts
}
```

**Verification**:
- `pnpm typecheck` from root — should run typecheck on all 3 packages

**Double-Check**:
- The `-r` flag runs the script in all workspace packages that define it
- If any package doesn't have a `typecheck` script, pnpm will error — verify all 3 packages have it (they do)

---

# PHASE 9: TESTING

---

### T-141: Add Tests for Missing Case Schema Validation (Required Fields Subset)

**Files**: `packages/shared/src/schemas/__tests__/cases.test.ts`

**Severity**: 🔵 LOW — Test Coverage

**What to do**:
Add a test for the `required_fields` subset validation (added in T-129):

```typescript
describe('caseTemplateSchema — required_fields subset', () => {
  it('should reject required_fields that reference non-existent keys', () => {
    const result = caseTemplateSchema.safeParse({
      specialty: 'Cardiology',
      name: 'Test',
      fields: [
        { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
      ],
      required_fields: ['nonexistent_key'], // Not in fields[*].key
    });
    expect(result.success).toBe(false);
  });

  it('should accept required_fields that are a subset of field keys', () => {
    const result = caseTemplateSchema.safeParse({
      specialty: 'Cardiology',
      name: 'Test',
      fields: [
        { key: 'diagnosis', label: 'Diagnosis', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      required_fields: ['diagnosis'],
    });
    expect(result.success).toBe(true);
  });
});
```

**Verification**:
- `pnpm test` — both new tests should pass

**Double-Check**:
- The `safeParse` returns `success: false` with a specific error message for invalid required_fields
- Verify the error message includes the field name

---

### T-142: Add Max-Length Test for inviteUserSchema.specialty

**Files**: `packages/shared/src/schemas/__tests__/auth.test.ts`

**Severity**: 🔵 LOW — Test Coverage

**What to do**:
Add a test for the `.max(100)` constraint on invite specialty:

```typescript
it('should reject specialty exceeding 100 characters', () => {
  const result = inviteUserSchema.safeParse({
    email: 'doc@hospital.com',
    role: 'resident',
    full_name: 'Dr. Long Specialty',
    specialty: 'x'.repeat(101),
  });
  expect(result.success).toBe(false);
});
```

**Verification**:
- `pnpm test` — new test should pass

**Double-Check**:
- This test only passes after T-131 is implemented (adding `.max(100)` to `inviteUserSchema.specialty`)

---

### T-143: Add Mobile Component Smoke Tests

**Files**: `apps/mobile/__tests__/components/GlassPanel.test.tsx` (create)

**Severity**: 🔵 LOW — Test Coverage

**What to do**:
Create a basic smoke test for the mobile StatusBadge component:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react-native';
import StatusBadge from '../../components/StatusBadge';

describe('StatusBadge', () => {
  it('should render draft status', () => {
    const { getByText } = render(<StatusBadge status="draft" />);
    expect(getByText('Draft')).toBeTruthy();
  });

  it('should render pending status', () => {
    const { getByText } = render(<StatusBadge status="pending" />);
    expect(getByText('Pending')).toBeTruthy();
  });

  it('should render approved status', () => {
    const { getByText } = render(<StatusBadge status="approved" />);
    expect(getByText('Approved')).toBeTruthy();
  });

  it('should render rejected status', () => {
    const { getByText } = render(<StatusBadge status="rejected" />);
    expect(getByText('Rejected')).toBeTruthy();
  });
});
```

**Verification**:
- `pnpm --filter @elogbook/mobile test` — should pass (assuming test framework is set up from T-116)

**Double-Check**:
- React Native component tests require `@testing-library/react-native` (added in T-116)
- Some native modules (BlurView, SVG) may need mocking — add mocks to vitest setup if needed

---

# PHASE 10: UI/UX POLISH

---

### T-144: Fix Sync Banner Color Parsing in log-case.tsx

**Files**: `apps/mobile/app/(tabs)/log-case.tsx` (line 284)

**Severity**: 🟡 MEDIUM — Visual Bug

**What to do**:
1. Read line 284 — the code does `c.color.replace('text-', '#')` which produces `#blue-400` (invalid hex)
2. Replace with a proper color map:

```typescript
const syncColorMap: Record<string, string> = {
  'text-blue-400': '#60A5FA',
  'text-green-400': '#34D399',
  'text-yellow-400': '#FBBF24',
  'text-red-400': '#F87171',
};

// In the render:
color={syncColorMap[c.color] || clinicalTokens.colors.text.muted}
```

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- The sync status banner should now show correct colors instead of always white

**Double-Check**:
- The current code produces `#blue-400` which is invalid — React Native may show nothing or default to white
- All possible sync status colors must be in the map — 'synced' (blue), 'syncing' (yellow), 'error' (red), 'offline' (yellow?)
- The fallback `clinicalTokens.colors.text.muted` provides a safe default for unknown statuses

---

### T-145: Fix Dashboard Hardcoded Color in Mobile

**Files**: `apps/mobile/app/(tabs)/index.tsx` (line 143)

**Severity**: 🔵 LOW — Code Quality

**What to do**:
Replace the hardcoded color `#0D9488` with the clinical token:

```typescript
// Before:
color="#0D9488"

// After:
color={clinicalTokens.colors.primary.DEFAULT}
```

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- Search for `'#0D9488'` in mobile screens — should be 0 matches

**Double-Check**:
- The color `#0D9488` IS the same as `clinicalTokens.colors.primary.DEFAULT` — visual appearance won't change
- This was likely missed in the initial hex color replacement pass (Phase 3)

---

### T-146: Add Date Picker for Case Date in log-case.tsx

**Files**: `apps/mobile/app/(tabs)/log-case.tsx` (lines 452-461)

**Severity**: 🟡 MEDIUM — UX

**What to do**:
Replace the free-text `TextInput` for `case_date` with a date picker:

1. Install `@react-native-community/datetimepicker`:
```bash
pnpm --filter @elogbook/mobile add @react-native-community/datetimepicker
```

2. Replace the text input with a tappable display + date picker:

```typescript
import DateTimePicker from '@react-native-community/datetimepicker';
// ... in the component:
const [showDatePicker, setShowDatePicker] = useState(false);

// In the case_date section:
<View className="mb-4">
  <Text className="text-slate-400 text-xs mb-1" style={{ fontFamily: clinicalTokens.fonts.mono }}>
    Case Date
  </Text>
  <TouchableOpacity
    className="bg-slate-900 border border-indigo-500/15 rounded-lg px-4 py-3"
    onPress={() => setShowDatePicker(true)}
  >
    <Text className="text-white" style={{ fontFamily: clinicalTokens.fonts.body }}>
      {caseDate || 'Select date'}
    </Text>
  </TouchableOpacity>
  {showDatePicker && (
    <DateTimePicker
      value={caseDate ? new Date(caseDate) : new Date()}
      mode="date"
      maximumDate={new Date()}
      onChange={(event, date) => {
        setShowDatePicker(false);
        if (date) {
          setCaseDate(date.toISOString().split('T')[0]);
        }
      }}
    />
  )}
</View>
```

**Verification**:
- `pnpm --filter @elogbook/mobile typecheck` — must pass
- The case date should now have a native date picker

**Double-Check**:
- `@react-native-community/datetimepicker` is a native module — requires `npx expo install` instead of `pnpm add` for proper Expo compatibility, or check if `expo-date-time-picker` is available
- On iOS, the picker appears inline; on Android, it appears as a dialog
- `maximumDate={new Date()}` prevents selecting future dates (clinical constraint)

---

### T-147: Fix X-Content-Type-Options Header Value

**Files**: `apps/web/next.config.js` (line 21)

**Severity**: 🟠 HIGH — Security

**What to do**:
Ensure the `X-Content-Type-Options` header value is spelled correctly:

```javascript
// Current:
{ key: 'X-Content-Type-Options', value: 'nosniff' },

// Correct:
{ key: 'X-Content-Type-Options', value: 'nosniff' },
```

Wait — verify the current spelling. Read the file. The correct value IS `nosniff` (n-o-s-n-i-f-f). If the code already has this, no change needed. If it says `nosniff` (missing an 'f'), fix it.

**Verification**:
- Read `next.config.js` line 21 and confirm the spelling
- The correct value is `nosniff` (7 letters)

**Double-Check**:
- This header prevents MIME-type sniffing attacks
- If misspelled, browsers ignore it and the app is vulnerable to MIME confusion attacks

---

# APPENDIX: VERIFICATION CHECKLIST

### After Each Task

- [ ] Run: `pnpm --filter @elogbook/shared typecheck`
- [ ] Run: `pnpm --filter @elogbook/web typecheck`
- [ ] Run: `pnpm --filter @elogbook/mobile typecheck`
- [ ] If migration: verify SQL syntax

### After Phase Completion

Phase 2 (Critical):
- [ ] `ai-insights` SSRF protection awaits DNS resolution
- [ ] `stripe_events` RLS uses `auth.role()`, not `current_user`
- [ ] `ai_response_cache` has RLS enabled
- [ ] `import_map.json` exists and edge functions serve correctly
- [ ] `generate-pdf` filters by status and limits PHI

Phase 3 (Database):
- [ ] TypeScript interfaces updated for CaseAttachment, OneTimePurchase, ApprovalRequest
- [ ] Migration SQL creates columns and backfills data
- [ ] All CHECK constraints and indexes exist
- [ ] `Institution.tier` type no longer collapses to string

Phase 4 (Edge Functions):
- [ ] Rate limiting uses DB queries, not in-memory
- [ ] `payment-webhook` has caching for gateway configs
- [ ] `export-pdf` route has timeout and error handling
- [ ] `create-checkout` has rate limiting

Phase 5 (Mobile):
- [ ] No hardcoded Supabase credentials in app.json
- [ ] Mobile test framework works
- [ ] Stale closure fixed in log-case.tsx
- [ ] Validation errors displayed to user
- [ ] Dead code removed
- [ ] NetInfo null checks fixed everywhere
- [ ] Case detail works offline
- [ ] Hardcoded FK names replaced

Phase 6 (Web):
- [ ] CSP hardened (unsafe-inline removed or nonce added)
- [ ] N+1 queries fixed
- [ ] Unsafe casts reduced
- [ ] Submit route handles approval errors with rollback
- [ ] CSS duplicates removed

Phase 7 (Shared):
- [ ] CaseTemplate schema validates required_fields subset
- [ ] patient_hash has min length
- [ ] inviteUserSchema specialty has max length
- [ ] clinicalColors removed
- [ ] design-tokens.config.js deleted or unlinked
- [ ] ProgressRing and StatusBadge visually consistent across platforms

Phase 8 (Build):
- [ ] CI has dependency caching
- [ ] `.dockerignore` exists
- [ ] pnpm version pinned in Dockerfile
- [ ] Root tsconfig with project references
- [ ] Root typecheck script

Phase 9 (Testing):
- [ ] 71+ existing tests still pass
- [ ] New tests for required_fields validation
- [ ] New tests for invite max-length
- [ ] Mobile smoke tests pass

Phase 10 (UI):
- [ ] Sync banner colors correct
- [ ] No hardcoded hex colors in mobile
- [ ] Date picker works for case date
- [ ] X-Content-Type-Options header correct

### Final Production Readiness

- [ ] All 🔴 CRITICAL issues resolved
- [ ] All 🟠 HIGH issues resolved or documented as accepted risk
- [ ] 80%+ of 🟡 MEDIUM issues resolved
- [ ] All 3 packages typecheck with 0 errors
- [ ] CI pipeline passes (when run)
- [ ] Test count: 80+ tests passing
- [ ] Docker build succeeds (when run)
- [ ] No hardcoded secrets in source
- [ ] Migration rollback plan exists (see `docs/migration-rollback-plan.md`)
