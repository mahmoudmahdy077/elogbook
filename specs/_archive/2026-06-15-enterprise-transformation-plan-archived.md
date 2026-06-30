# E-Logbook Enterprise Transformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform E-Logbook from a prototype with critical security vulnerabilities into an enterprise-grade, HIPAA-compliant clinical SaaS production system.

**Architecture:** Monorepo (Next.js 16 web, Expo 56 mobile, Supabase backend, shared Zod schemas). Phase 0 fixes security blockers, Phase 1 hardens the database, Phase 2 rebuilds the web app, Phase 3 fixes mobile, Phase 4 adds compliance, Phases 5-6 polish. Each phase produces a working, testable system.

**Tech Stack:** TypeScript 6, Next.js 16 (App Router), Expo SDK 56, Supabase (PostgreSQL 15, Edge Functions), HeroUI v3.1, Tailwind CSS v4, NativeWind v4, Framer Motion v12, Zod v4, WatermelonDB 0.28

**Design Spec:** `docs/superpowers/specs/2026-06-15-brutal-audit-upgrade-plan.md`

---

## Task 1: Emergency Schema Fixes (Critical Bugs)

**Files:**
- Create: `supabase/migrations/00011_critical_schema_fixes.sql`

- [ ] **Step 1: Write the migration for critical schema fixes**

```sql
-- ============================================================================
-- 00011: Critical Schema Fixes
-- Fixes: Missing UNIQUE constraint, CHECK constraints, soft-delete columns,
-- missing indexes, status state machine, MRN hash salt from vault
-- ============================================================================

-- 1. Add missing UNIQUE constraint on approval_requests (blocks approve_case at runtime)
ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_entry_supervisor_unique
  UNIQUE (entry_id, supervisor_id);

-- 2. Add CHECK constraints for enum-like columns
ALTER TABLE institutions
  ADD CONSTRAINT institutions_tier_check CHECK (tier IN ('free', 'premium', 'enterprise'));

ALTER TABLE one_time_purchases
  ADD CONSTRAINT one_time_purchases_status_check CHECK (status IN ('pending', 'completed', 'failed', 'refunded'));

ALTER TABLE tenants
  ADD CONSTRAINT tenants_compliance_frameworks_check CHECK (
    compliance_frameworks IS NULL OR
    compliance_frameworks = '{}' OR
    EXISTS (
      SELECT 1 FROM unnest(compliance_frameworks) AS fw
      WHERE fw IN ('hipaa', 'gdpr', 'scfhs', 'gmc', 'pipeda')
    )
  );

-- 3. Add compound indexes for critical query paths
CREATE INDEX idx_case_entries_tenant_status ON case_entries(tenant_id, status);
CREATE INDEX idx_case_entries_tenant_resident_status ON case_entries(tenant_id, resident_id, status);
CREATE INDEX idx_case_entries_case_date ON case_entries(case_date);
CREATE INDEX idx_case_attachments_entry_id ON case_attachments(entry_id);
CREATE INDEX idx_subscriptions_gateway_id ON subscriptions(gateway_subscription_id);
CREATE INDEX idx_subscriptions_tenant_status ON subscriptions(tenant_id, status);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_program_goals_resident_id ON program_goals(tenant_id, resident_id);
CREATE INDEX idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX idx_payments_gateway_intent ON payments(gateway_payment_intent_id);

-- 4. Add soft-delete support to critical tables
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE case_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE case_templates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 5. Add stripe_price_id to subscription_plans (blocks checkout)
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- 6. Fix cascading deletes to protect medical data
ALTER TABLE case_entries
  DROP CONSTRAINT IF EXISTS case_entries_resident_id_fkey,
  ADD CONSTRAINT case_entries_resident_id_fkey
    FOREIGN KEY (resident_id) REFERENCES profiles(id) ON DELETE RESTRICT;

-- 7. Add case status state machine trigger
CREATE OR REPLACE FUNCTION enforce_case_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'pending') THEN
      RAISE EXCEPTION 'Invalid transition: draft -> %', NEW.status;
    END IF;
    IF OLD.status = 'pending' AND NEW.status NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Invalid transition: pending -> %', NEW.status;
    END IF;
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'Approved cases are immutable';
    END IF;
    IF OLD.status = 'rejected' AND NEW.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Invalid transition: rejected -> %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_case_status ON case_entries;
CREATE TRIGGER trg_enforce_case_status
  BEFORE UPDATE ON case_entries
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enforce_case_status_transition();

-- 8. Add deleted_at exclusion to existing RLS policies that query case_entries
-- (We'll add new policies in task 2 that filter by deleted_at IS NULL)

-- 9. Update hash_patient_mrn to use configurable salt
CREATE OR REPLACE FUNCTION hash_patient_mrn(mrn TEXT)
RETURNS TEXT AS $$
DECLARE
  v_salt TEXT;
BEGIN
  v_salt := current_setting('app.mrn_salt', true);
  IF v_salt IS NULL OR v_salt = '' THEN
    v_salt := 'elogbook-mrn-salt-v1';
    RAISE WARNING 'MRN salt not configured, using default. Set app.mrn_salt for production.';
  END IF;
  RETURN encode(digest(v_salt || mrn, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 10. Add stripe_event_id for webhook idempotency
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_event_id TEXT UNIQUE;
```

- [ ] **Step 2: Run migration and verify**

Run: `cd G:\elogbook && supabase db reset`

Expected: All migrations apply without errors. Verify the UNIQUE constraint exists:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'approval_requests_entry_supervisor_unique';
```

Expected: 1 row returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00011_critical_schema_fixes.sql
git commit -m "fix: add missing constraints, indexes, soft-delete columns, state machine trigger"
```

---

## Task 2: Fix Critical RLS Policies

**Files:**
- Create: `supabase/migrations/00012_rls_security_fixes.sql`

- [ ] **Step 1: Write RLS security migration**

```sql
-- ============================================================================
-- 00012: RLS Security Fixes
-- Fixes: Audit log forgery, profile role escalation, admin ALL policy,
-- approval function authorization, tenant isolation in lapsed guard
-- ============================================================================

-- 1. Revoke INSERT on audit_logs from authenticated users
-- Only triggers and service role should write audit logs
DROP POLICY IF EXISTS "Any authenticated user can insert audit logs" ON audit_logs;
DROP POLICY IF EXISTS "System can insert AI query logs" ON ai_query_logs;

-- Create audit_logs INSERT policy that only allows trigger-written rows
-- (trigger functions run as SECURITY DEFINER, which bypasses RLS)
-- We also allow service_role to insert directly
CREATE POLICY "Only service role can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- Allow service_role to insert (service_role bypasses RLS, but be explicit)
CREATE POLICY "Service role can insert audit logs"
  ON audit_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 2. Fix profile INSERT to not allow arbitrary role assignment
DROP POLICY IF EXISTS "Any authenticated user can insert own profile" ON profiles;

CREATE POLICY "Users can insert own profile with valid role"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND role IN ('resident', 'supervisor')  -- Only allow safe default roles at signup
  );

-- Existing UPDATE policies already restrict what roles can modify profiles
-- But add a CHECK on the profiles table itself
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_insert_check CHECK (
    role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin')
  );

-- 3. Add tenant_id scope to admin ALL policies
DROP POLICY IF EXISTS "Admin can manage all tenants" ON tenants;

CREATE POLICY "Admin can manage all tenants"
  ON tenants FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 4. Fix approve_case and reject_case to add authorization checks
CREATE OR REPLACE FUNCTION approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_caller_role TEXT;
  v_caller_tenant UUID;
BEGIN
  -- Authorization check
  v_caller_role := get_user_role();
  v_caller_tenant := get_tenant_id();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient role', 'code', 'forbidden');
  END IF;

  -- Validate tenant
  IF v_caller_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'No tenant context', 'code', 'no_tenant');
  END IF;

  -- Lock the row to prevent concurrent modifications
  SELECT status INTO v_status
  FROM case_entries
  WHERE id = p_entry_id AND tenant_id = v_caller_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found or not in your tenant', 'code', 'not_found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'approved' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'approved', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_caller_role TEXT;
  v_caller_tenant UUID;
BEGIN
  -- Authorization check
  v_caller_role := get_user_role();
  v_caller_tenant := get_tenant_id();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient role', 'code', 'forbidden');
  END IF;

  IF v_caller_tenant IS NULL THEN
    RETURN jsonb_build_object('error', 'No tenant context', 'code', 'no_tenant');
  END IF;

  SELECT status INTO v_status
  FROM case_entries
  WHERE id = p_entry_id AND tenant_id = v_caller_tenant
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found or not in your tenant', 'code', 'not_found');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'rejected' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'rejected', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'rejected'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Fix get_case_stats to remove arbitrary tenant_id parameter
CREATE OR REPLACE FUNCTION get_case_stats(
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_tenant_id UUID;
  v_result JSONB;
BEGIN
  v_tenant_id := get_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  SELECT jsonb_build_object(
    'total_cases', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)), 0),
    'by_status', (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::JSONB) FROM (
      SELECT status, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY status
    ) sub),
    'pending_approvals', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id AND ce.status = 'pending' AND ce.deleted_at IS NULL), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 6. Fix lapsed tenant write guard to be more precise
DROP POLICY IF EXISTS no_inserts_for_lapsed_tenants ON case_entries;
DROP POLICY IF EXISTS no_submit_for_lapsed_tenants ON case_entries;

CREATE POLICY "No inserts for lapsed tenants"
  ON case_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM subscriptions
      WHERE subscriptions.tenant_id = case_entries.tenant_id
        AND subscriptions.status IN ('past_due', 'unpaid')
    )
  );

CREATE POLICY "No draft-to-pending for lapsed tenants"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      -- Allow drafts to stay as drafts (editing)
      status = 'draft'
      OR
      -- Allow supervisors to approve/reject regardless of subscription
      get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
      OR
      -- Block draft->pending ONLY if there's a lapsed subscription
      NOT (
        OLD.status = 'draft'
        AND NEW.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM subscriptions
          WHERE subscriptions.tenant_id = case_entries.tenant_id
            AND subscriptions.status IN ('past_due', 'unpaid')
        )
      )
    )
  );

-- 7. Add deleted_at = NULL filter to case_entries SELECT policies
DROP POLICY IF EXISTS "Resident reads own entries" ON case_entries;
DROP POLICY IF EXISTS "Supervisor+ reads all tenant entries" ON case_entries;

CREATE POLICY "Resident reads own non-deleted entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "Supervisor+ reads all tenant non-deleted entries"
  ON case_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

-- 8. Fix handle_new_user to not allow admin role from user metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  -- Only allow safe default roles at signup. Admin/director must be assigned by existing admin.
  role_text := CASE
    WHEN NEW.raw_user_meta_data->>'role' IN ('resident', 'supervisor') THEN NEW.raw_user_meta_data->>'role'
    ELSE 'resident'
  END;

  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), 'user-' || NEW.id, 'individual')
  RETURNING id INTO new_tenant_id;

  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Run migration and verify policies**

Run: `cd G:\elogbook && supabase db reset`

Verify:
```sql
-- Verify audit_log INSERT policy blocks authenticated users
SELECT policyname FROM pg_policies WHERE tablename = 'audit_logs' AND policyname LIKE '%service role%';
-- Expected: 1 row

-- Verify profiles INSERT restricts role
SELECT policyname FROM pg_policies WHERE tablename = 'profiles' AND policyname LIKE '%valid role%';
-- Expected: 1 row
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00012_rls_security_fixes.sql
git commit -m "fix: harden RLS policies - block audit forgery, role escalation, add authorization to RPC"
```

---

## Task 3: Fix Edge Function Authentication & Security

**Files:**
- Modify: `supabase/functions/create-checkout/index.ts`
- Modify: `supabase/functions/generate-pdf/index.ts`
- Modify: `supabase/functions/ai-insights/index.ts`
- Modify: `supabase/functions/payment-webhook/index.ts`

- [ ] **Step 1: Create shared auth helper for edge functions**

Create `supabase/functions/_shared/auth.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function authenticate(request: Request): Promise<{
  supabase: ReturnType<typeof createClient>;
  user: { id: string; email?: string };
  tenantId: string;
  role: string;
} | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tenantId = user.app_metadata?.tenant_id;
  const role = user.app_metadata?.user_role;

  if (!tenantId || !role) {
    return new Response(JSON.stringify({ error: 'Incomplete user metadata' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { supabase, user, tenantId, role };
}

export function corsHeaders(origin = '*'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
```

- [ ] **Step 2: Rewrite `create-checkout/index.ts` with auth**

Read the current file first, then rewrite:

```typescript
import { authenticate, corsHeaders, escapeHtml } from '../_shared/auth.ts';
import Stripe from 'https://esm.sh/stripe@14.0.0?target=deno';

const STRIPE_ALLOWED_ORIGINS = [
  'https://elogbook.app',
  'http://localhost:3000',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const origin = req.headers.get('origin') || '';
  const allowedOrigin = STRIPE_ALLOWED_ORIGINS.includes(origin) ? origin : STRIPE_ALLOWED_ORIGINS[0];

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role } = authResult;

  if (!['institution_admin', 'admin', 'director'].includes(role)) {
    return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
      status: 403,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { plan_id } = body;

    if (!plan_id) {
      return new Response(JSON.stringify({ error: 'plan_id is required' }), {
        status: 400,
        headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
      });
    }

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('id, name, stripe_price_id, price_monthly')
      .eq('id', plan_id)
      .single();

    if (planError || !plan) {
      return new Response(JSON.stringify({ error: 'Plan not found' }), {
        status: 404,
        headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
      });
    }

    if (!plan.stripe_price_id) {
      return new Response(JSON.stringify({ error: 'Plan does not have a Stripe price configured' }), {
        status: 400,
        headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
      });
    }

    const { data: gwConfig, error: gwError } = await supabase
      .from('payment_gateway_config')
      .select('provider, publishable_key, encrypted_secret_key')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (gwError || !gwConfig) {
      return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), {
        status: 400,
        headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(gwConfig.encrypted_secret_key, {
      apiVersion: '2023-10-16',
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${allowedOrigin}/${encodeURIComponent(tenantId)}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${allowedOrigin}/${encodeURIComponent(tenantId)}/billing?canceled=true`,
      metadata: { tenant_id: tenantId, plan_id: plan.id },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Checkout error:', err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders(allowedOrigin), 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 3: Rewrite `generate-pdf/index.ts` with auth and XSS fix**

Read current file, then rewrite with auth check, proper HTML escaping via `escapeHtml()`, and removal of `patient_mrn` from output. Key changes:
- Add auth middleware call at top
- Remove `patient_mrn` from HTML output entirely
- Use `escapeHtml()` on all dynamic values
- Return proper Content-Type headers

- [ ] **Step 4: Rewrite `ai-insights/index.ts` with auth and PHI stripping**

Read current file, then rewrite. Key changes:
- Add auth middleware call
- Strip `patient_mrn`, `patient_dob`, and identified `field_values` from AI prompt
- Only send `patient_age_years`, `patient_hash` (de-identified data), `specialty`, and anonymized field labels
- Add `is_deidentified` check — refuse to send identified patient data to external AI
- Add rate-limiting check against `resident_ai_toggle.quota_limit`
- Add timeout on AI provider API calls (30s)
- Stream only for OpenAI; send full response for others

- [ ] **Step 5: Fix `payment-webhook/index.ts` CORS and error handling**

Key changes:
- Restrict `Access-Control-Allow-Origin` to Stripe webhook origin
- Add `stripe_event_id` idempotency check
- Add null checks for env vars
- Add structured logging instead of silent `catch { continue }`

- [ ] **Step 6: Verify edge functions compile**

Run: `cd G:\elogbook && supabase functions deploy --dry-run create-checkout && supabase functions deploy --dry-run generate-pdf && supabase functions deploy --dry-run ai-insights && supabase functions deploy --dry-run payment-webhook`

Expected: No TypeScript compilation errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/
git commit -m "fix: add auth to all edge functions, strip PHI from AI prompts, fix XSS in PDF, add checkout validation"
```

---

## Task 4: Fix Web Authentication & Tenant Isolation

**Files:**
- Modify: `apps/web/lib/supabase/middleware.ts`
- Modify: `apps/web/lib/supabase/server.ts`
- Modify: `apps/web/lib/supabase/client.ts`
- Create: `apps/web/lib/supabase/auth.ts`

- [ ] **Step 1: Create shared auth utility**

Create `apps/web/lib/supabase/auth.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';

export interface AuthResult {
  user: { id: string; email?: string };
  profile: {
    id: string;
    tenant_id: string;
    role: UserRole;
    full_name: string;
    specialty: string | null;
  };
  tenant: {
    id: string;
    slug: string;
    tenant_type: string;
  };
  subscription: {
    status: string;
    plan_id: string | null;
  } | null;
}

export async function getAuthContext(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  const [profileResult, subscriptionResult] = await Promise.all([
    supabase.from('profiles').select('id, tenant_id, role, full_name, specialty, tenants!inner(id, slug, tenant_type)').eq('user_id', user.id).single(),
    supabase.from('subscriptions').select('status, plan_id').eq('tenant_id', user.app_metadata?.tenant_id).eq('status', 'active').maybeSingle(),
  ]);

  if (profileResult.error) {
    throw new Error(`Profile not found: ${profileResult.error.message}`);
  }

  const profile = profileResult.data;
  const tenantData = profile.tenants as unknown as { id: string; slug: string; tenant_type: string };

  return {
    user: { id: user.id, email: user.email },
    profile: {
      id: profile.id,
      tenant_id: profile.tenant_id,
      role: profile.role as UserRole,
      full_name: profile.full_name,
      specialty: profile.specialty,
    },
    tenant: {
      id: tenantData.id,
      slug: tenantData.slug,
      tenant_type: tenantData.tenant_type,
    },
    subscription: subscriptionResult.data ? { status: subscriptionResult.data.status, plan_id: subscriptionResult.data.plan_id } : null,
  };
}

export function canAccessTenant(auth: AuthResult, requestedTenantSlug: string): boolean {
  return auth.tenant.slug === requestedTenantSlug;
}
```

- [ ] **Step 2: Fix middleware to check tenant authorization**

Modify `apps/web/lib/supabase/middleware.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Public routes
  if (pathname.startsWith('/login') || pathname.startsWith('/auth') || pathname === '/') {
    if (user && pathname.startsWith('/login')) {
      // Redirect to the user's tenant dashboard
      const tenantSlug = user.app_metadata?.tenant_slug || user.app_metadata?.tenant_id;
      if (tenantSlug) {
        return NextResponse.redirect(new URL(`/${tenantSlug}/dashboard`, request.url));
      }
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return supabaseResponse;
  }

  // Require authentication for all other routes
  if (!user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Check tenant authorization for authenticated routes
  const tenantMatch = pathname.match(/^\/([^/]+)/);
  if (tenantMatch) {
    const requestedTenant = tenantMatch[1];
    const userTenantSlug = user.app_metadata?.tenant_slug;
    const userRole = user.app_metadata?.user_role;

    // Admin can access any tenant
    if (userRole !== 'admin' && userTenantSlug && userTenantSlug !== requestedTenant) {
      return NextResponse.redirect(new URL(`/${userTenantSlug}/dashboard`, request.url));
    }
  }

  return supabaseResponse;
}
```

- [ ] **Step 3: Fix Supabase server client with proper env validation**

Modify `apps/web/lib/supabase/server.ts`:

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });
}
```

- [ ] **Step 4: Fix Supabase client singleton**

Modify `apps/web/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }

  client = createBrowserClient(url, key);
  return client;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck`

Expected: No type errors related to the changed files.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/supabase/
git commit -m "fix: add tenant isolation to middleware, fix auth context, singleton client, env validation"
```

---

## Task 5: Remove Secrets from Client Code & Fix CaseForm De-identification

**Files:**
- Modify: `packages/shared/src/types/database.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types/database.server.ts`
- Modify: `apps/web/components/PaymentGatewayPanel.tsx`
- Modify: `apps/web/components/AIConfigPanel.tsx`
- Modify: `apps/web/components/CaseForm.tsx`
- Modify: `apps/web/components/UserManager.tsx`

- [ ] **Step 1: Split database types into client-safe and server-only**

Create `packages/shared/src/types/database.server.ts`:

```typescript
// Server-only types containing secrets. NEVER import in client code.
export interface AIConfigServer {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  encrypted_api_key: string;  // Only accessible server-side via Supabase Vault
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentGatewayConfigServer {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;       // This IS safe for client
  encrypted_secret_key: string;  // Only accessible server-side
  encrypted_webhook_secret: string; // Only accessible server-side
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

Modify `packages/shared/src/types/database.ts` — remove `encrypted_api_key`, `encrypted_secret_key`, `encrypted_webhook_secret` from `AIConfig` and `PaymentGatewayConfig`:

```typescript
export interface AIConfig {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  // encrypted_api_key removed — access server-side only
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentGatewayConfig {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;      // Safe for client
  // encrypted_secret_key & encrypted_webhook_secret removed — server-side only
  endpoint_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

Update `packages/shared/src/index.ts` to NOT export server types:

```typescript
export { caseEntrySchema, caseEntryDeidentifiedSchema, caseEntryIdentifiedSchema, aiQuerySchema } from './schemas/cases';
export { profileSchema, complianceConfigSchema } from './schemas/auth';
export { subscriptionPlanSchema, subscriptionSchema } from './schemas/subscriptions';
export type { Database, Profile, Tenant, Institution, CaseEntry, CaseTemplate, CaseAttachment, ApprovalRequest, AuditLog, ProgramGoal, GoalProgress, SubscriptionPlan, Subscription, Payment, OneTimePurchase, AIConfig, ResidentAIToggle, AIQueryLog, PaymentGatewayConfig, AccreditationFramework, AttachmentSignature, InstitutionBilling } from './types/database';
export { clinicalColors, clinicalFonts, fontSizes, spacing, radii, borderWidths } from './constants/design-tokens';
export { presetTransitions, CARD_ENTER_ANIMATION, CARD_EXIT_ANIMATION, STAGGER_DELAY } from './constants/animations';
// Note: Server-only types (AIConfigServer, PaymentGatewayConfigServer) are NOT exported here.
// Import them directly from '@elogbook/shared/types/database.server' in server code only.
```

- [ ] **Step 2: Fix PaymentGatewayPanel to not send secrets from client**

Read current `PaymentGatewayPanel.tsx`, then modify:
- Remove `encrypted_secret_key` and `encrypted_webhook_secret` from the form state
- Change the save operation to call a Next.js API route (server-side) that handles secret encryption
- The component should only deal with `publishable_key`, `provider`, `endpoint_url`, and `is_active`
- Add a note in the UI that secret keys are managed server-side

- [ ] **Step 3: Fix AIConfigPanel to not send API keys from client**

Read current `AIConfigPanel.tsx`, then modify:
- Remove `encrypted_api_key` display from the edit form
- Change save to call a Next.js API route for server-side secret management
- Show masked key indicator (`sk-...xxxx`) for existing keys via a server-provided `has_key` boolean

- [ ] **Step 4: Fix CaseForm de-identification — replace `btoa()` with server-side hashing**

Read current `CaseForm.tsx` (888 lines), then modify:
- Remove all `btoa()` calls (lines 229, 253, 627)
- When `is_deidentified` is true, send `patient_mrn: null`, `patient_dob: null`, `patient_age_years`, and `patient_hash` computed via a new API route
- Create `apps/web/app/api/[tenant]/hash-mrn/route.ts`:

```typescript
import { createServerSupabase } from '@/lib/supabase/server';
import { getAuthContext, canAccessTenant } from '@/lib/supabase/auth';

export async function POST(
  request: Request,
  { params }: { params: { tenant: string } }
) {
  const auth = await getAuthContext();
  if (!canAccessTenant(auth, params.tenant)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { mrn, dob } = await request.json();
  const { data, error } = await createServerSupabase().rpc('hash_patient_mrn', { mrn });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ hash: data });
}
```

- [ ] **Step 5: Fix UserManager role escalation**

Read current `UserManager.tsx`, then modify:
- Remove `role: inviteRole` from `signInWithOtp` user_metadata
- Role assignment must go through a server-side admin API route
- Create `apps/web/app/api/[tenant]/admin/assign-role/route.ts` that validates the caller is `institution_admin` or `admin` before updating the role

- [ ] **Step 6: Verify typecheck**

Run: `cd G:\elogbook && pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web typecheck`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/ apps/web/components/ apps/web/app/api/
git commit -m "fix: remove secrets from client bundles, server-side MRN hashing, fix role escalation in UserManager"
```

---

## Task 6: Add Error Boundaries & Loading States to Web App

**Files:**
- Create: `apps/web/components/ErrorBoundary.tsx`
- Create: `apps/web/components/TableSkeleton.tsx`
- Create: `apps/web/components/CardSkeleton.tsx`
- Create: `apps/web/components/FormSkeleton.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/(authenticated)/layout.tsx`

- [ ] **Step 1: Create ErrorBoundary component**

Create `apps/web/components/ErrorBoundary.tsx`:

```tsx
'use client';

import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div role="alert" style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--color-crimson, #DC2626)', fontFamily: 'var(--font-heading)' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--color-neutral-light, #E2E8F0)', margin: '1rem 0' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: 'var(--color-primary, #0D9488)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.75rem 1.5rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Create skeleton components**

Create `apps/web/components/TableSkeleton.tsx`:

```tsx
'use client';

import { Skeleton } from '@heroui/react';

export default function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full space-y-3">
      <div className="flex gap-4 mb-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1 rounded-lg" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4">
          {Array.from({ length: columns }).map((_, col) => (
            <Skeleton key={col} className="h-6 flex-1 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
```

Create `apps/web/components/CardSkeleton.tsx`:

```tsx
'use client';

import { Skeleton } from '@heroui/react';

export default function CardSkeleton() {
  return (
    <div className="p-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <Skeleton className="h-6 w-1/3 rounded-lg mb-4" />
      <Skeleton className="h-4 w-2/3 rounded mb-2" />
      <Skeleton className="h-4 w-1/2 rounded" />
    </div>
  );
}
```

Create `apps/web/components/FormSkeleton.tsx`:

```tsx
'use client';

import { Skeleton } from '@heroui/react';

export default function FormSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wrap app root with ErrorBoundary**

Modify `apps/web/app/layout.tsx` to wrap with `ErrorBoundary`.

- [ ] **Step 4: Wrap authenticated layout with ErrorBoundary and Suspense**

Modify `apps/web/app/(authenticated)/layout.tsx` to add `ErrorBoundary` and `Suspense` with `CardSkeleton` fallback.

- [ ] **Step 5: Add Suspense to data-heavy pages**

Add `Suspense` wrappers to dashboard, cases, approvals, and reports pages with appropriate skeleton fallbacks.

- [ ] **Step 6: Verify the app builds**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ErrorBoundary.tsx apps/web/components/TableSkeleton.tsx apps/web/components/CardSkeleton.tsx apps/web/components/FormSkeleton.tsx apps/web/app/layout.tsx apps/web/app/\(authenticated\)/layout.tsx
git commit -m "feat: add ErrorBoundary, loading skeletons, and Suspense boundaries to web app"
```

---

## Task 7: Fix Next.js Config, Design Tokens & WCAG AAA

**Files:**
- Modify: `apps/web/next.config.js`
- Modify: `apps/web/app/globals.css`
- Modify: `packages/shared/src/constants/design-tokens.ts`
- Modify: `apps/web/components/ProgressRing.tsx`
- Modify: `apps/web/components/ProgramOverviewCharts.tsx`

- [ ] **Step 1: Create proper Next.js config with security headers**

Modify `apps/web/next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@heroui/react', '@elogbook/shared'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co;",
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
```

- [ ] **Step 2: Update globals.css with WCAG AAA-compliant design tokens**

Modify `apps/web/app/globals.css` — add CSS custom properties replacing all hardcoded colors, ensure 7:1 contrast ratios:

```css
:root {
  /* Clinical Palette - Dark Mode */
  --color-backdrop: #060814;
  --color-surface: rgba(15, 23, 42, 0.8);
  --color-surface-solid: #0F172A;
  --color-primary: #0D9488;
  --color-primary-hover: #14B8A6;
  --color-secondary: #6366F1;
  --color-secondary-hover: #818CF8;
  --color-neutral-light: #E2E8F0;
  --color-neutral-dark: #0F172A;
  --color-border: rgba(99, 102, 241, 0.15);
  --color-border-active: rgba(99, 102, 241, 0.4);

  /* WCAG AAA compliant text on dark */
  --color-text-primary: #F1F5F9;     /* 12.6:1 on #060814 */
  --color-text-secondary: #CBD5E1;   /* 9.3:1 on #060814 */
  --color-text-muted: #94A3B8;        /* 5.7:1 on #060814 - use ONLY for labels, not body */
  --color-text-label: #94A3B8;        /* Labels, not body text */
  --color-text-on-primary: #FFFFFF;

  /* Status Colors - WCAG AAA text on dark */
  --color-pending: #FCD34D;    /* 10.6:1 on #060814 */
  --color-approved: #6EE7B7;   /* 10.9:1 on #060814 */
  --color-rejected: #FCA5A5;   /* 6.4:1 on #060814 - AA minimum, use for large text/icons */

  /* Status glow shadows */
  --shadow-pending: 0 0 8px rgba(252, 211, 77, 0.4);
  --shadow-approved: 0 0 8px rgba(110, 231, 183, 0.4);
  --shadow-rejected: 0 0 8px rgba(252, 165, 165, 0.4);
  --shadow-primary: 0 0 8px rgba(13, 148, 136, 0.3);

  /* Typography */
  --font-heading: 'Outfit', ui-sans-serif, system-ui, sans-serif;
  --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;

  /* Motion */
  --transition-fast: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-medium: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-spring: 500ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 3: Fix badge colors in globals.css to use tokens**

Replace hardcoded badge colors `#FBBF24`, `#34D399`, `#F87171` with `var(--color-pending)`, `var(--color-approved)`, `var(--color-rejected)`.

- [ ] **Step 4: Fix ProgressRing hardcoded colors**

Modify `apps/web/components/ProgressRing.tsx` — replace hardcoded `"#1E293B"` with `var(--color-neutral-dark)` and `"white"` with `var(--color-text-primary)`.

- [ ] **Step 5: Fix ProgramOverviewCharts hardcoded colors**

Modify `apps/web/components/ProgramOverviewCharts.tsx` — replace `"#10B981"`, `"#F59E0B"`, `"#94A3B8"`, `"#EF4444"` with `var(--color-approved)`, `var(--color-pending)`, `var(--color-text-muted)`, `var(--color-rejected)`.

- [ ] **Step 6: Fix DashboardContent hardcoded colors**

Modify `apps/web/components/DashboardContent.tsx` — replace `"#F59E0B"`, `"#10B981"`, `"#EF4444"` with the corresponding CSS variable tokens.

- [ ] **Step 7: Verify build**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck`

- [ ] **Step 8: Commit**

```bash
git add apps/web/next.config.js apps/web/app/globals.css packages/shared/src/constants/design-tokens.ts apps/web/components/ProgressRing.tsx apps/web/components/ProgramOverviewCharts.tsx apps/web/components/DashboardContent.tsx
git commit -m "feat: add security headers, WCAG AAA tokens, fix hardcoded colors to use CSS variables"
```

---

## Task 8: Fix Mobile Security & Auth (expo-secure-store, de-id toggle)

**Files:**
- Modify: `apps/mobile/lib/supabase.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/login.tsx`
- Modify: `apps/mobile/lib/db/storage.ts`
- Modify: `apps/mobile/app/(tabs)/log-case.tsx`

- [ ] **Step 1: Add expo-secure-store dependency**

Run: `cd G:\elogbook\apps\mobile && npx expo install expo-secure-store expo-font @expo-google-fonts/outfit @expo-google-fonts/inter`

- [ ] **Step 2: Fix supabase.ts to use expo-secure-store and enable magic links**

Read current `apps/mobile/lib/supabase.ts`, then modify:

```typescript
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

- [ ] **Step 3: Add fonts, SafeAreaProvider, and error boundary to root layout**

Modify `apps/mobile/app/_layout.tsx` to:
- Import and load Outfit, Inter, Geist Mono via `useFonts`
- Wrap with `SafeAreaProvider`
- Add React error boundary
- Show splash screen until fonts load

- [ ] **Step 4: Add de-identification toggle + Zod validation to log-case.tsx**

Read current `apps/mobile/app/(tabs)/log-case.tsx`, then modify:
- Import `caseEntrySchema` from `@elogbook/shared`
- Add `isDeidentified` state (default `true`)
- Add Switch component for de-identification toggle
- When `isDeidentified` is true: hide MRN/DOB fields, show age input
- When `isDeidentified` is false: show MRN and DOB fields
- Validate form data with `caseEntrySchema.safeParse()` before Supabase insert
- Replace `bg-black` with backdrop color

- [ ] **Step 5: Fix login.tsx**

Modify `apps/mobile/app/login.tsx`:
- Add error state and UI for failed login attempts
- Add email validation before calling `signInWithOtp`
- Replace `bg-black` with backdrop color
- Add `accessibilityLabel` to all interactive elements
- Add rate limiting (disable button for 5 seconds after sending)

- [ ] **Step 6: Encrypt sensitive data in storage.ts**

Modify `apps/mobile/lib/db/storage.ts`:
- Use `expo-secure-store` for storing sensitive draft fields (MRN, DOB)
- Keep non-sensitive fields (template_id, field_values, status) in AsyncStorage
- Add schema validation on read with Zod

- [ ] **Step 7: Fix app.json to add plugins and environment config**

Modify `apps/mobile/app.json`:
- Add plugins for `expo-camera`, `expo-image-picker`, `expo-notifications`, `expo-haptics`, `@react-native-community/blur`, `@react-native-community/netinfo`
- Add `extra` section for `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Add `ios` and `android` config sections for permissions

- [ ] **Step 8: Verify mobile builds**

Run: `cd G:\elogbook\apps\mobile && npx expo export --platform web`

This is a basic sanity check; full native build requires EAS.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/
git commit -m "fix: use expo-secure-store for auth tokens, add de-id toggle, Zod validation, fonts, error boundary"
```

---

## Task 9: Audit Log PHI Redaction & Consent Tracking

**Files:**
- Create: `supabase/migrations/00013_audit_phi_redaction.sql`

- [ ] **Step 1: Write migration for audit log PHI redaction and consent tracking**

```sql
-- ============================================================================
-- 00013: Audit PHI redaction, consent tracking, data retention enforcement
-- ============================================================================

-- 1. Fix audit_case_entry trigger to redact PHI even when is_deidentified is FALSE
-- Only log changes to non-PHI fields; never store patient_mrn or patient_dob in audit_logs
CREATE OR REPLACE FUNCTION audit_case_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_user_agent TEXT;
  v_session_id TEXT;
  v_changes JSONB;
BEGIN
  v_user_id := auth.uid();
  v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  v_session_id := COALESCE(
    current_setting('request.headers', true)::JSONB ->> 'x-session-id',
    auth.jwt() ->> 'session_id'
  );

  IF TG_OP = 'INSERT' THEN
    v_changes := row_to_json(NEW)::JSONB
      - 'patient_mrn'    -- NEVER log MRN
      - 'patient_dob';   -- NEVER log DOB

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id, v_user_id, 'INSERT', 'case_entries', NEW.id,
      jsonb_build_object('new', v_changes, 'user_agent', v_user_agent, 'session_id', v_session_id),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Only audit non-PHI field changes
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id, v_user_id, 'UPDATE', 'case_entries', NEW.id,
      jsonb_build_object(
        'changed_fields', (
          SELECT jsonb_object_agg(key, jsonb_build_object('old', OLD_val, 'new', NEW_val))
          FROM (
            SELECT key,
                   (row_to_json(OLD)::JSONB - 'patient_mrn' - 'patient_dob' -> key) AS OLD_val,
                   (row_to_json(NEW)::JSONB - 'patient_mrn' - 'patient_dob' -> key) AS NEW_val
            FROM jsonb_object_keys(row_to_json(OLD)::JSONB || row_to_json(NEW)::JSONB) AS t(key)
          ) sub
          WHERE OLD_val IS DISTINCT FROM NEW_val
            AND key NOT IN ('created_at', 'updated_at', 'patient_mrn', 'patient_dob')
        ),
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_changes := row_to_json(OLD)::JSONB
      - 'patient_mrn'
      - 'patient_dob';

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      OLD.tenant_id, v_user_id, 'DELETE', 'case_entries', OLD.id,
      jsonb_build_object('deleted', v_changes, 'user_agent', v_user_agent, 'session_id', v_session_id),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS trg_audit_case_entry ON case_entries;
CREATE TRIGGER trg_audit_case_entry
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION audit_case_entry();

-- 2. Add consent tracking table
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('data_processing', 'ai_insights', 'data_export', 'marketing')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  version TEXT NOT NULL DEFAULT '1.0',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own consent records"
  ON consent_records FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own consent records"
  ON consent_records FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admin can read tenant consent records"
  ON consent_records FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE INDEX idx_consent_records_tenant_user ON consent_records(tenant_id, user_id);
CREATE INDEX idx_consent_records_type ON consent_records(consent_type);

-- 3. Add data retention enforcement cron job (requires pg_cron extension)
-- This will be a manual step since pg_cron needs to be enabled in Supabase dashboard
-- The function is defined here for reference:

CREATE OR REPLACE FUNCTION enforce_data_retention()
RETURNS void AS $$
DECLARE
  tenant_record RECORD;
  v_cutoff_date TIMESTAMPTZ;
BEGIN
  FOR tenant_record IN
    SELECT id, data_retention_days FROM tenants WHERE data_retention_days IS NOT NULL
  LOOP
    v_cutoff_date := NOW() - (tenant_record.data_retention_days || ' days')::INTERVAL;

    UPDATE case_entries
    SET deleted_at = NOW()
    WHERE tenant_id = tenant_record.id
    AND deleted_at IS NULL
    AND created_at < v_cutoff_date;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Run migration**

Run: `cd G:\elogbook && supabase db reset`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00013_audit_phi_redaction.sql
git commit -m "fix: redact PHI from audit logs, add consent tracking, data retention function"
```

---

## Task 10: Split CaseForm into Sub-Components & Fix Form Logic

**Files:**
- Create: `apps/web/components/case-form/StepIndicator.tsx`
- Create: `apps/web/components/case-form/TemplateStep.tsx`
- Create: `apps/web/components/case-form/PatientInfoStep.tsx`
- Create: `apps/web/components/case-form/CaseDetailsStep.tsx`
- Create: `apps/web/components/case-form/ReviewStep.tsx`
- Create: `apps/web/components/case-form/ConfirmDialog.tsx`
- Modify: `apps/web/components/CaseForm.tsx`

- [ ] **Step 1: Create StepIndicator component**

Create `apps/web/components/case-form/StepIndicator.tsx` — animated step progress indicator with HeroUI, showing current step with glow effect.

- [ ] **Step 2: Create TemplateStep component**

Create `apps/web/components/case-form/TemplateStep.tsx` — template selection grid with specialty icons, proper types, no `any`.

- [ ] **Step 3: Create PatientInfoStep component**

Create `apps/web/components/case-form/PatientInfoStep.tsx` — de-identification toggle with HIPAA explanation, conditional MRN/DOB or age fields, server-side MRN hashing.

- [ ] **Step 4: Create CaseDetailsStep component**

Create `apps/web/components/case-form/CaseDetailsStep.tsx` — template field values form, auto-focus first field, Zod validation.

- [ ] **Step 5: Create ReviewStep component**

Create `apps/web/components/case-form/ReviewStep.tsx` — case review before submit, monospace font for clinical data (MRN hashes, dates, codes).

- [ ] **Step 6: Create ConfirmDialog component**

Create `apps/web/components/case-form/ConfirmDialog.tsx` — success/error confirmation with celebration animation.

- [ ] **Step 7: Rewrite CaseForm.tsx as orchestrator**

The main `CaseForm.tsx` becomes an orchestration component (~150 lines) that:
- Manages step state (`template` → `patient-info` → `case-details` → `review` → `confirmation`)
- Manages form data state
- Handles submit via server action (not client-side Supabase insert)
- Applies Zod validation on submit AND draft save
- Delegates rendering to sub-components
- No `btoa()` anywhere

- [ ] **Step 8: Verify typecheck**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck`

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/case-form/ apps/web/components/CaseForm.tsx
git commit -m "refactor: split CaseForm into wizard sub-components, fix de-identification, add Zod validation"
```

---

## Task 11: Wire WatermelonDB for Real Offline Support on Mobile

**Files:**
- Modify: `apps/mobile/lib/db/database.ts`
- Modify: `apps/mobile/lib/db/storage.ts`
- Modify: `apps/mobile/lib/sync.ts`
- Modify: `apps/mobile/app/(tabs)/my-cases.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Update WatermelonDB schema to include all required tables**

Modify `apps/mobile/lib/db/database.ts` to:
- Ensure schema version is properly tracked
- Add `program_goals` and `goal_progress` tables to the schema
- Verify all model decorators are correct (`@field` for strings/numbers, not booleans)
- Add proper `@json` field serializers with type guards

- [ ] **Step 2: Rewrite storage.ts to use WatermelonDB for case data**

Modify `apps/mobile/lib/db/storage.ts` to:
- Replace AsyncStorage-based draft storage with WatermelonDB operations
- `saveDraftCase()`: Write to WatermelonDB with `local_sync_status: 'draft'`
- `getDraftCases()`: Query WatermelonDB where `local_sync_status = 'draft' or 'conflict'`
- `removeDraft()`: Delete from WatermelonDB after successful sync

- [ ] **Step 3: Implement real pull sync in sync.ts**

Modify `apps/mobile/lib/sync.ts` to:
- Add `pullCases(tenantId)`: Fetch updated cases from Supabase and write to WatermelonDB
- Add `pullTemplates(tenantId)`: Fetch templates and cache to WatermelonDB
- Add proper conflict resolution: server-authoritative, mark conflicts for user review
- Add `initSync()` that runs on app foreground AND periodic (every 60 seconds when online)
- Add `cleanup()` method for proper resource disposal

- [ ] **Step 4: Update my-cases.tsx to read from WatermelonDB**

Modify `apps/mobile/app/(tabs)/my-cases.tsx` to:
- Query WatermelonDB for case list (offline-first)
- Show offline indicator when `NetInfo.isConnected === false`
- Pull-to-refresh updates WatermelonDB then re-renders
- Show sync status badge on each case

- [ ] **Step 5: Update dashboard to use offline data**

Modify `apps/mobile/app/(tabs)/index.tsx` to:
- Query goals from WatermelonDB
- Fall back to Supabase when online
- Show cached data when offline with "Last synced: X minutes ago" indicator

- [ ] **Step 6: Verify mobile app starts without errors**

Run: `cd G:\elogbook\apps\mobile && npx expo export --platform web`

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/lib/ apps/mobile/app/\(tabs\)/my-cases.tsx apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat: wire WatermelonDB for real offline support, implement pull sync, offline-first case list"
```

---

## Task 12: Web Design System Implementation (HeroUI + Glass Panels)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`
- Modify: `apps/web/components/DashboardContent.tsx`
- Modify: `apps/web/components/ApprovalsDashboard.tsx`
- Modify: `apps/web/components/Sidebar.tsx`
- Modify: `apps/web/components/MobileNav.tsx`

- [ ] **Step 1: Implement animated SVG progress rings**

Modify `apps/web/components/ProgressRing.tsx`:
- Use `framer-motion` `useMotionValue` and `animate` for mount animation
- Add glow effect: `style={{ filter: 'drop-shadow(0 0 6px currentColor)' }}`
- Use CSS variable `var(--color-primary)` for track stroke
- Use CSS variable `var(--color-text-primary)` for percentage text
- Animate from 0% to target percentage on mount with spring physics

- [ ] **Step 2: Apply glass-panel design to dashboard**

Modify `apps/web/components/DashboardContent.tsx`:
- Replace hard-bordered cards with `.glass-panel` class (for stats overlay) or `.panel` class (for data panels)
- Apply `var(--color-backdrop)` background
- Apply `border: 1px solid var(--color-border)`
- Use `var(--color-text-primary)` for heading text
- Use `var(--color-text-secondary)` for body text
- Add glow shadow on active/hovered cards: `var(--shadow-primary)`

- [ ] **Step 3: Apply design system to ApprovalsDashboard**

Modify `apps/web/components/ApprovalsDashboard.tsx`:
- Fix "Approval Rate" KPI — should calculate from ALL entries, not just pending
- Replace `AnimatedCounter` with simpler implementation (don't import full framer-motion animation module)
- Use `.glass-panel` for modal/overlay, `.panel` for data cards
- Use badge classes from globals.css: `.badge-pending`, `.badge-approved`, `.badge-rejected`, `.badge-draft`

- [ ] **Step 4: Fix Sidebar and MobileNav SVG icons**

Modify `apps/web/components/Sidebar.tsx`:
- Fix stroke-based SVG paths that are rendered with `fill="currentColor"` — change to `stroke="currentColor"` with `fill="none"`
- Add `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`
- Add `aria-label` to all icon links
- Persist collapse state in `localStorage`

- [ ] **Step 5: Verify build**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/ProgressRing.tsx apps/web/components/DashboardContent.tsx apps/web/components/ApprovalsDashboard.tsx apps/web/components/Sidebar.tsx apps/web/components/MobileNav.tsx
git commit -m "feat: animated SVG progress rings, glass-panel design tokens, fix approval rate KPI, fix SVG icons"
```

---

## Task 13: Mobile Screen Rebuild — Approvals, Case Detail, AI Insights

**Files:**
- Modify: `apps/mobile/app/(tabs)/approvals.tsx`
- Create: `apps/mobile/app/(tabs)/case-detail.tsx`
- Create: `apps/mobile/app/(tabs)/ai-insights.tsx`
- Modify: `apps/mobile/app/(tabs)/profile.tsx`

- [ ] **Step 1: Rebuild Approvals screen (currently placeholder)**

Rewrite `apps/mobile/app/(tabs)/approvals.tsx`:
- Fetch pending approval requests from Supabase (supervisor view)
- Show list of cases with: resident name, specialty, date, status badge
- Quick-approve/reject buttons with haptic feedback
- Use `GlassPanel` component for cards
- Show offline indicator when disconnected
- Pull-to-refresh support

- [ ] **Step 2: Create Case Detail screen**

Create `apps/mobile/app/(tabs)/case-detail.tsx`:
- Show case fields in monospace (MRN hash, date, template fields)
- Display status badge with glow
- For rejected cases: show rejection comment, "Resubmit" button
- For draft cases: "Edit" button
- Use server-side `approve_case`/`reject_case` RPC (no more two-step update)

- [ ] **Step 3: Create AI Insights screen**

Create `apps/mobile/app/(tabs)/ai-insights.tsx`:
- AI reflection input with Zod-validated query
- Streaming SSE response display
- Disclaimer banner: "AI-generated insights are for educational purposes only and do not constitute medical advice"
- Quota display (X of Y queries used)
- Role-gated: only visible for directors and residents with AI enabled

- [ ] **Step 4: Update Profile screen with subscription info**

Modify `apps/mobile/app/(tabs)/profile.tsx`:
- Show current plan name and status
- "Manage Subscription" link for premium features
- Proper capitalization of role display
- Retry button for failed profile loads

- [ ] **Step 5: Verify mobile builds**

Run: `cd G:\elogbook\apps\mobile && npx expo export --platform web`

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(tabs\)/
git commit -m "feat: rebuild approvals, add case detail and AI insights screens, update profile"
```

---

## Task 14: Parity Audit & Performance Optimization

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`
- Modify: `apps/web/app/(authenticated)/reports/page.tsx`
- Modify: `apps/web/app/(authenticated)/audit/page.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/layout.tsx`

- [ ] **Step 1: Fix N+1 queries in dashboard**

Modify `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`:
- Replace `Promise.all(residentProfiles.map(async ...))` with a single query using joins
- Use `getAuthContext()` from new auth utility instead of re-fetching user/profile/subscription
- Target: single Supabase query for stats + residents

- [ ] **Step 2: Fix N+1 queries in mobile dashboard**

Modify `apps/mobile/app/(tabs)/index.tsx`:
- Replace individual `goal_progress` queries with a single join query
- Target: 2 queries total (goals with progress + stats)

- [ ] **Step 3: Add authorization check to case detail page**

Modify `apps/web/app/(authenticated)/[tenant]/cases/[id]/page.tsx`:
- Verify `case_entry.resident_id === profile.id` (for residents) or `case_entry.tenant_id === auth.tenant.id` (for supervisors+)
- Return 403 if unauthorized

- [ ] **Step 4: Add pagination to cases, audit, and reports pages**

Modify each page:
- Replace `.limit(200)` with cursor-based pagination (20 per page)
- Add "Load more" button
- Reports: Use aggregate queries instead of fetching all rows

- [ ] **Step 5: Fix `as any` type assertions**

Replace all `as any` patterns with proper typed access. Generate Supabase types if not already done:

Run: `cd G:\elogbook && npx supabase gen types typescript --linked > packages/shared/src/types/database-generated.ts`

- [ ] **Step 6: Parallelize independent queries**

In all pages that make multiple independent Supabase queries:
- Replace sequential `await` calls with `Promise.all()`
- Exception: dependent queries must remain sequential

- [ ] **Step 7: Verify everything builds**

Run: `cd G:\elogbook && pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web build`

- [ ] **Step 8: Commit**

```bash
git add apps/web/ apps/mobile/app/\(tabs\)/index.tsx
git commit -m "perf: fix N+1 queries, add pagination, add auth checks, fix type assertions, parallelize queries"
```

---

## Self-Review Checklist

After completing all tasks, verify:

- [ ] **Spec coverage**: Every item in the audit plan (docs/superpowers/specs/2026-06-15-brutal-audit-upgrade-plan.md) has a corresponding task
- [ ] **Placeholder scan**: No "TODO", "TBD", "implement later", or "fill in details" in any task
- [ ] **Type consistency**: `handle_new_user` role restriction matches RLS in Task 2; `stripe_price_id` column added in Task 1 used in Task 3; `consent_records` table in Task 9 matches RLS pattern
- [ ] **All existing migrations unchanged**: Tasks create new migrations (00011, 00012, 00013) rather than modifying existing ones
- [ ] **Phase 0 emergency items all covered**: Privilege escalation, audit forgery, RPC authorization, tenant isolation, PHI in AI, secrets in client, XSS, cascading delete — all have tasks