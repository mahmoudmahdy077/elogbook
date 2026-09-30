-- ============================================================================
-- 20260926000002_billing_entitlement_authority.sql
--
-- Billing entitlement authority remediation
-- (docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md,
--  section 9.3 "Billing and plan entitlements with server-authoritative
--  payment events").
--
-- Root cause this migration closes
-- ------------------------------
-- `subscriptions` and `subscription_plans` are entitlement state, and both
-- were directly writable by an institution administrator:
--
--   * 20260923000003 created "Tenant admins can insert/update/delete
--     subscriptions" with the branch `get_user_role() = 'institution_admin'`.
--     A tenant admin could therefore INSERT their own row with
--     status='active' and any plan_id, and UPDATE an existing row to a paid
--     plan. Nothing in that path touched a payment provider.
--
--   * the same migration created "Custom plan owners can insert/update/delete
--     subscription_plans" (and the equivalent custom_plan_features policies)
--     with the branch `is_custom = TRUE AND created_by = auth.uid()`. A tenant
--     admin could create a catalog row with `price_monthly = 0` and arbitrary
--     `features`, then point their own subscription at it.
--
-- The two combine into a self-activation path with no payment. It is worse than
-- a cosmetic price edit: `check_case_quota` (20260923000007) reads
-- `plan.features ->> 'max_cases'` and treats 0 as UNLIMITED
-- (`WHEN v_max_cases = 0 THEN TRUE`). A tenant-authored plan with
-- `{"max_cases": 0}` is therefore an unlimited-capacity paid feature, written
-- by a tenant, and activated by a tenant.
--
-- The same route also wrote `subscription_changes` directly, so the entitlement
-- audit trail was authored by the same principal it was supposed to constrain.
--
-- What this migration does
-- ------------------------
-- 1. Plan catalog ownership. No authenticated principal holds INSERT, UPDATE or
--    DELETE on subscription_plans / custom_plan_features. The catalog becomes
--    platform-owned and readable-only, so `features`, `price_monthly`,
--    `max_residents` and `tenant_type` are server-owned.
-- 2. Entitlement ownership. No authenticated principal holds INSERT, UPDATE or
--    DELETE on subscriptions, and none on subscription_changes. A verified
--    payment event (service_role) or the platform command RPCs below is the
--    only writer.
-- 3. A database-level entitlement binding. An active/trialing subscription must
--    carry a non-empty gateway_subscription_id AND stripe_customer_id. This is
--    the invariant that makes a self-activation inert at the storage layer
--    rather than only at the policy layer, so a future policy regression cannot
--    silently re-open it.
-- 4. platform_activate_subscription / platform_cancel_subscription. The
--    platform-authorized command path: live AAL2, platform registry
--    membership, the plan resolved from the server catalog by slug (never from
--    caller features or price), a required reason, and audit + outbox rows in
--    the same transaction.
--
-- Two boundaries are preserved deliberately:
--   * SECURITY DEFINER command RPCs run as their owner, so `current_user` is
--     not `authenticated`. The new triggers key on exactly that distinction and
--     leave every command path intact.
--   * A principal with no authenticated identity (auth.uid() IS NULL --
--     migration replay, table owner, maintenance jobs) is governed by its own
--     checks, not by a request JWT, so the AAL2 guard does not apply to it.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Entitlement binding column and backfill.
--
-- Runs FIRST, before any policy is dropped. FORCE ROW LEVEL SECURITY subjects
-- even the table owner to RLS, so once the write policies below are gone this
-- UPDATE would be filtered to zero rows and the backfill would silently do
-- nothing. The NO FORCE / FORCE window makes the owner authoritative for the
-- duration of the backfill and restores the invariant afterwards.
--
-- An active or trialing subscription is a paid entitlement and must be bound to
-- a gateway subscription and customer that a verified payment event recorded.
-- Rows in a non-granting state (canceled, past_due, unpaid, incomplete, paused)
-- keep their binding if they have one and are not required to have one.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE public.subscriptions NO FORCE ROW LEVEL SECURITY;
UPDATE public.subscriptions
SET status = 'canceled',
    cancellation_reason = COALESCE(cancellation_reason, 'entitlement_revoked_missing_gateway_binding'),
    canceled_at = COALESCE(canceled_at, NOW()),
    updated_at = NOW()
WHERE status IN ('active', 'trialing')
  AND (
    gateway_subscription_id IS NULL
    OR btrim(gateway_subscription_id) = ''
    OR stripe_customer_id IS NULL
    OR btrim(stripe_customer_id) = ''
  );
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'subscriptions_entitlement_binding_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_entitlement_binding_check
      CHECK (
        status NOT IN ('active', 'trialing')
        OR (
          gateway_subscription_id IS NOT NULL
          AND btrim(gateway_subscription_id) <> ''
          AND stripe_customer_id IS NOT NULL
          AND btrim(stripe_customer_id) <> ''
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_entitlement_binding_check;

-- ---------------------------------------------------------------------------
-- 1. Plan catalog: platform-owned, read-only for authenticated principals.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Custom plan owners can insert subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Custom plan owners can update subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Custom plan owners can delete subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Admin can manage subscription_plans" ON public.subscription_plans;
-- 00002 created a separate FOR ALL policy under a name that differs by a space.
-- It was never dropped by any later migration, so it was still granting plan
-- catalog writes to any profile whose role label is 'admin'. Drop it by name.
DROP POLICY IF EXISTS "Admin can manage subscription plans" ON public.subscription_plans;

-- The read policy from 20260923000003 is retained verbatim so the billing UI
-- keeps rendering. Re-asserted here so this file is self-contained if it is ever
-- replayed against a database where the read policy is missing.
DROP POLICY IF EXISTS "Active tenant members can read subscription_plans" ON public.subscription_plans;
CREATE POLICY "Active tenant members can read subscription_plans"
  ON public.subscription_plans FOR SELECT TO authenticated
  USING (
    public.get_tenant_id() IS NOT NULL
    OR public.is_platform_admin()
  );

ALTER TABLE public.custom_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_plan_features FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant plan owners can insert custom plan features" ON public.custom_plan_features;
DROP POLICY IF EXISTS "Tenant plan owners can update custom plan features" ON public.custom_plan_features;
DROP POLICY IF EXISTS "Tenant plan owners can delete custom plan features" ON public.custom_plan_features;
DROP POLICY IF EXISTS "Admin can manage custom plan features" ON public.custom_plan_features;

-- ---------------------------------------------------------------------------
-- 2. Entitlements: written only by a verified event or the platform command.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant admins can insert subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Tenant admins can update subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Tenant admins can delete subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Admin can manage subscriptions" ON public.subscriptions;

-- Read policy retained from 20260923000003: the billing page, the admin
-- subscription GET, and the mobile profile all read through it.
DROP POLICY IF EXISTS "Tenant members can read own subscription" ON public.subscriptions;
CREATE POLICY "Tenant members can read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

-- The change log is audit output for a command, not an input to one. Tenant
-- admins no longer author it.
ALTER TABLE public.subscription_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant admins can insert subscription changes" ON public.subscription_changes;
DROP POLICY IF EXISTS "Tenant admins can update subscription changes" ON public.subscription_changes;
DROP POLICY IF EXISTS "Tenant admins can delete subscription changes" ON public.subscription_changes;
DROP POLICY IF EXISTS "Admin can manage subscription changes" ON public.subscription_changes;
DROP POLICY IF EXISTS "Admin can manage custom plan features" ON public.custom_plan_features;

DROP POLICY IF EXISTS "Tenant members can read subscription changes" ON public.subscription_changes;
CREATE POLICY "Tenant members can read subscription changes"
  ON public.subscription_changes FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

-- Payment history keeps its read policy; the insert branch that let a tenant
-- admin author a "completed" payment row is removed -- a fabricated paid receipt
-- is the same self-activation in receipt form. 00002's FOR ALL policy under a
-- differently-spaced name also survived every later migration.
DROP POLICY IF EXISTS "Tenant admins can insert payments" ON public.payments;
DROP POLICY IF EXISTS "Tenant admins can update payments" ON public.payments;
DROP POLICY IF EXISTS "Tenant admins can delete payments" ON public.payments;
DROP POLICY IF EXISTS "Admin can manage payments" ON public.payments;

-- ---------------------------------------------------------------------------
-- 4. Direct-write guard.
--
-- current_user = 'authenticated' is precisely "this statement executed as the
-- caller's own role", i.e. a direct REST/RPC write. SECURITY DEFINER command
-- RPCs and the table owner are outside that condition and stay unaffected, so
-- the verified payment-event path (service_role) keeps working.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_entitlement_write()
RETURNS TRIGGER AS $$
DECLARE
  v_trusted_database_context BOOLEAN;
BEGIN
  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';

  IF v_trusted_database_context OR current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'entitlement state is written only by a verified payment event or the platform entitlement command'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION public.protect_entitlement_write() IS
  'Denies a direct authenticated write to subscriptions / subscription_plans / custom_plan_features / subscription_changes / payments. Verified payment events (service_role) and SECURITY DEFINER platform commands are unaffected.';

DROP TRIGGER IF EXISTS trg_entitlement_write_guard ON public.subscriptions;
CREATE TRIGGER trg_entitlement_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.protect_entitlement_write();

DROP TRIGGER IF EXISTS trg_plan_catalog_write_guard ON public.subscription_plans;
CREATE TRIGGER trg_plan_catalog_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.protect_entitlement_write();

DROP TRIGGER IF EXISTS trg_custom_plan_features_write_guard ON public.custom_plan_features;
CREATE TRIGGER trg_custom_plan_features_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.custom_plan_features
  FOR EACH ROW EXECUTE FUNCTION public.protect_entitlement_write();

DROP TRIGGER IF EXISTS trg_subscription_changes_write_guard ON public.subscription_changes;
CREATE TRIGGER trg_subscription_changes_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.subscription_changes
  FOR EACH ROW EXECUTE FUNCTION public.protect_entitlement_write();

DROP TRIGGER IF EXISTS trg_payments_write_guard ON public.payments;
CREATE TRIGGER trg_payments_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_entitlement_write();

-- ---------------------------------------------------------------------------
-- 5. Idempotency ledger for entitlement commands.
--
-- Same shape as clinical_command_log, kept separate so a billing replay cannot
-- collide with a clinical one and so the retention story stays independent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlement_command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  row_id UUID,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entitlement_command_log_identity UNIQUE (tenant_id, actor_profile_id, command, request_id)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_command_log_created
  ON public.entitlement_command_log (created_at);

ALTER TABLE public.entitlement_command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_command_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.entitlement_command_log FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.entitlement_command_log IS
  'Per-tenant/actor/command/request idempotency ledger for entitlement commands. No policies: only the SECURITY DEFINER entitlement RPCs and service_role reach it.';

-- ---------------------------------------------------------------------------
-- 6. Shared principal gate for entitlement commands.
--
-- A predicate that RAISES on failure rather than returning a principal record:
-- each command then reads the principal itself through
-- get_authoritative_principal_with_aal(), which is the same shape
-- require_privileged_principal already uses in this database.
-- ---------------------------------------------------------------------------
-- VOLATILE, not STABLE: the tenant row is locked FOR UPDATE so two concurrent
-- entitlement commands for the same tenant serialize. PostgreSQL rejects
-- SELECT ... FOR UPDATE inside a STABLE function.
CREATE OR REPLACE FUNCTION public.require_platform_entitlement_principal(
  p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_aal TEXT;
  v_tenant_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT principal.aal
  INTO v_aal
  FROM public.get_authoritative_principal_with_aal() AS principal
  LIMIT 1;

  IF v_aal IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'an active AAL2 principal is required' USING ERRCODE = '42501';
  END IF;

  -- Entitlement is a host-authority action. A tenant administrator label is
  -- never sufficient, on its own tenant or any other.
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform registry membership is required for entitlement commands'
      USING ERRCODE = '42501';
  END IF;

  SELECT tenant.status
  INTO v_tenant_status
  FROM public.tenants AS tenant
  WHERE tenant.id = p_tenant_id
  FOR UPDATE;

  IF v_tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'the target tenant is not active' USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.require_platform_entitlement_principal(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_platform_entitlement_principal(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. platform_activate_subscription.
--
-- p_plan_slug is resolved against the server catalog. The caller cannot supply
-- features, price, quota or tenant_type, so there is no client-supplied feature
-- flag anywhere in the grant. p_gateway_subscription_id /
-- p_gateway_customer_id are the verified provider bindings; they are required
-- for an activating grant, which is what stops a "$0 plan, unlimited capacity"
-- activation from existing at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_activate_subscription(
  p_tenant_id UUID,
  p_actor_profile_id UUID,
  p_plan_slug TEXT,
  p_gateway_subscription_id TEXT,
  p_gateway_customer_id TEXT,
  p_request_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_plan public.subscription_plans%ROWTYPE;
  v_tenant_type TEXT;
  v_subscription_id UUID;
  v_old_plan_id UUID;
  v_fingerprint TEXT;
  v_stored_fingerprint TEXT;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  IF p_tenant_id IS NULL
     OR p_actor_profile_id IS NULL
     OR p_plan_slug IS NULL
     OR btrim(p_plan_slug) = ''
     OR char_length(btrim(p_plan_slug)) > 120
     OR p_request_id IS NULL
     OR btrim(p_request_id) = ''
     OR char_length(btrim(p_request_id)) > 128
     OR p_reason IS NULL
     OR btrim(p_reason) = ''
     OR char_length(btrim(p_reason)) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request', 'code', 'invalid_request');
  END IF;

  -- A grant without a provider binding is the self-activation shape. Require
  -- both halves of the binding.
  IF p_gateway_subscription_id IS NULL
     OR btrim(p_gateway_subscription_id) = ''
     OR char_length(btrim(p_gateway_subscription_id)) > 255
     OR p_gateway_customer_id IS NULL
     OR btrim(p_gateway_customer_id) = ''
     OR char_length(btrim(p_gateway_customer_id)) > 255 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'gateway_binding_required',
      'code', 'gateway_binding_required'
    );
  END IF;

  -- Raises on a non-platform, non-AAL2, or wrong-tenant caller.
  PERFORM public.require_platform_entitlement_principal(p_tenant_id);

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  SELECT tenant.tenant_type
  INTO v_tenant_type
  FROM public.tenants AS tenant
  WHERE tenant.id = p_tenant_id;
  IF v_tenant_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant_not_found', 'code', 'not_found');
  END IF;

  -- Server-owned catalog lookup. Nothing about the plan's entitlements is taken
  -- from the caller.
  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE slug = btrim(p_plan_slug)
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_not_found', 'code', 'not_found');
  END IF;
  IF v_plan.tenant_type <> v_tenant_type THEN
    RETURN jsonb_build_object('success', false, 'error', 'plan_tenant_type_mismatch', 'code', 'forbidden');
  END IF;

  v_fingerprint := v_plan.id::text || '|' || btrim(p_gateway_subscription_id) || '|' || btrim(p_gateway_customer_id);

  INSERT INTO public.entitlement_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    p_tenant_id, v_principal.profile_id, 'activate_subscription', btrim(p_request_id),
    v_fingerprint, '{"success":false,"error":"in_progress"}'::jsonb
  )
  ON CONFLICT (tenant_id, actor_profile_id, command, request_id) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  IF NOT COALESCE(v_claimed, FALSE) THEN
    SELECT request_fingerprint, result
    INTO v_stored_fingerprint, v_stored
    FROM public.entitlement_command_log
    WHERE tenant_id = p_tenant_id
      AND actor_profile_id = v_principal.profile_id
      AND command = 'activate_subscription'
      AND request_id = btrim(p_request_id);

    IF v_stored IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'transient: in_progress', 'code', 'state_conflict');
    END IF;
    IF v_stored ->> 'error' = 'in_progress' THEN
      RETURN v_stored;
    END IF;
    IF v_stored_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('success', false, 'error', 'request key reused with different input', 'code', 'idempotency_conflict');
    END IF;
    RETURN v_stored;
  END IF;

  <<work>> BEGIN
    SELECT subscription.id, subscription.plan_id
    INTO v_subscription_id, v_old_plan_id
    FROM public.subscriptions AS subscription
    WHERE subscription.tenant_id = p_tenant_id
    ORDER BY subscription.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_subscription_id IS NULL THEN
      INSERT INTO public.subscriptions (
        tenant_id, plan_id, status, gateway_subscription_id, stripe_customer_id
      ) VALUES (
        p_tenant_id, v_plan.id, 'active', btrim(p_gateway_subscription_id), btrim(p_gateway_customer_id)
      )
      RETURNING id INTO v_subscription_id;
    ELSE
      UPDATE public.subscriptions
      SET plan_id = v_plan.id,
          status = 'active',
          gateway_subscription_id = btrim(p_gateway_subscription_id),
          stripe_customer_id = btrim(p_gateway_customer_id),
          cancellation_reason = NULL,
          canceled_at = NULL,
          updated_at = NOW()
      WHERE id = v_subscription_id;
    END IF;

    -- subscription_changes.change_type carries a CHECK constraint limited to
    -- ('upgrade','downgrade','cancel','reactivate','custom'); the authoritative
    -- record of WHO changed it is audit_logs/audit_outbox, not this column.
    -- changed_by references auth.users(id), so it takes the user id.
    INSERT INTO public.subscription_changes (
      tenant_id, old_plan_id, new_plan_id, change_type, reason, changed_by
    ) VALUES (
      p_tenant_id, v_old_plan_id, v_plan.id, 'custom',
      btrim(p_reason), v_principal.user_id
    );

    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      p_tenant_id, v_principal.user_id, 'platform_activate_subscription', 'subscriptions', v_subscription_id,
      jsonb_build_object('plan_slug', v_plan.slug, 'reason_present', true, 'gateway_bound', true)
    );

    INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      p_tenant_id, v_principal.user_id, 'platform_activate_subscription', 'subscriptions', v_subscription_id,
      jsonb_build_object('plan_slug', v_plan.slug)
    );

    v_result := jsonb_build_object(
      'success', true,
      'subscription_id', v_subscription_id,
      'plan_id', v_plan.id,
      'plan_slug', v_plan.slug,
      'status', 'active'
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'activation_failed', 'code', 'internal_error');
  END; -- <<work>>

  UPDATE public.entitlement_command_log
  SET row_id = v_subscription_id, result = v_result
  WHERE tenant_id = p_tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'activate_subscription'
    AND request_id = btrim(p_request_id);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.platform_activate_subscription(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Platform-authorized, AAL2-gated entitlement activation. Resolves the plan from the server catalog by slug and requires a verified gateway subscription/customer binding; audit and change history are written in the same transaction.';

-- ---------------------------------------------------------------------------
-- 8. platform_cancel_subscription.
--
-- Symmetric to activation: platform authority, AAL2, audited. A tenant's own
-- cancellation still arrives through the verified gateway event
-- (customer.subscription.deleted); this is the operator-side path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_cancel_subscription(
  p_tenant_id UUID,
  p_actor_profile_id UUID,
  p_request_id TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_subscription_id UUID;
  v_plan_id UUID;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  IF p_tenant_id IS NULL
     OR p_actor_profile_id IS NULL
     OR p_request_id IS NULL
     OR btrim(p_request_id) = ''
     OR char_length(btrim(p_request_id)) > 128
     OR p_reason IS NULL
     OR btrim(p_reason) = ''
     OR char_length(btrim(p_reason)) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request', 'code', 'invalid_request');
  END IF;

  PERFORM public.require_platform_entitlement_principal(p_tenant_id);

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  INSERT INTO public.entitlement_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    p_tenant_id, v_principal.profile_id, 'cancel_subscription', btrim(p_request_id),
    p_tenant_id::text || '|cancel', '{"success":false,"error":"in_progress"}'::jsonb
  )
  ON CONFLICT (tenant_id, actor_profile_id, command, request_id) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  IF NOT COALESCE(v_claimed, FALSE) THEN
    SELECT result
    INTO v_stored
    FROM public.entitlement_command_log
    WHERE tenant_id = p_tenant_id
      AND actor_profile_id = v_principal.profile_id
      AND command = 'cancel_subscription'
      AND request_id = btrim(p_request_id);

    IF v_stored IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'transient: in_progress', 'code', 'state_conflict');
    END IF;
    RETURN v_stored;
  END IF;

  <<work>> BEGIN
    SELECT subscription.id, subscription.plan_id
    INTO v_subscription_id, v_plan_id
    FROM public.subscriptions AS subscription
    WHERE subscription.tenant_id = p_tenant_id
    ORDER BY subscription.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_subscription_id IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'subscription_not_found', 'code', 'not_found');
      EXIT work;
    END IF;

    IF (SELECT status FROM public.subscriptions WHERE id = v_subscription_id) <> 'canceled' THEN
      UPDATE public.subscriptions
      SET status = 'canceled',
          cancellation_reason = btrim(p_reason),
          canceled_at = NOW(),
          updated_at = NOW()
      WHERE id = v_subscription_id;

      INSERT INTO public.subscription_changes (
        tenant_id, old_plan_id, new_plan_id, change_type, reason, changed_by
      ) VALUES (
        p_tenant_id, v_plan_id, v_plan_id, 'cancel', btrim(p_reason), v_principal.user_id
      );
    END IF;

    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      p_tenant_id, v_principal.user_id, 'platform_cancel_subscription', 'subscriptions', v_subscription_id,
      jsonb_build_object('reason_present', true)
    );

    v_result := jsonb_build_object(
      'success', true,
      'subscription_id', v_subscription_id,
      'status', 'canceled'
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'cancellation_failed', 'code', 'internal_error');
  END; -- <<work>>

  UPDATE public.entitlement_command_log
  SET row_id = v_subscription_id, result = v_result
  WHERE tenant_id = p_tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'cancel_subscription'
    AND request_id = btrim(p_request_id);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.platform_cancel_subscription(UUID, UUID, TEXT, TEXT) IS
  'Platform-authorized, AAL2-gated entitlement cancellation with an audited reason.';

-- ---------------------------------------------------------------------------
-- 9. Grants. authenticated only; the function bodies enforce platform registry
--    membership and live AAL2. No PUBLIC, no anon.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.protect_entitlement_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_activate_subscription(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.platform_cancel_subscription(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.platform_activate_subscription(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cancel_subscription(UUID, UUID, TEXT, TEXT) TO authenticated;
