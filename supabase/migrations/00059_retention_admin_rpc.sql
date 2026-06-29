-- ============================================================================
-- 00059_retention_admin_rpc.sql
--
-- Phase 6 / P6.5
--
-- Adds a SECURITY DEFINER RPC that lets institution_admin / director /
-- admin set the per-tenant `tenants.data_retention_days` policy and
-- trigger a manual purge via `enforce_data_retention()`.
--
-- The existing `enforce_data_retention()` function is restricted to the
-- service_role (P2.21). This migration exposes a thin, audited wrapper
-- that:
--   1. Verifies the caller is a privileged role for the target tenant
--   2. Validates the new retention window against the schema bounds
--   3. Writes the new value to `tenants.data_retention_days`
--   4. Optionally calls `enforce_data_retention()` to soft-delete now
--
-- Returns a small JSON document so the admin UI can show a forecast.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_data_retention(
  p_tenant_id UUID,
  p_data_retention_days INTEGER,
  p_purge_now BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role TEXT;
  v_old_value INTEGER;
  v_purged_count INTEGER := 0;
  v_forecast_count INTEGER;
  v_forecast_date DATE;
BEGIN
  -- Resolve the caller's role.
  v_actor_id := auth.uid();
  SELECT role INTO v_actor_role
    FROM public.profiles
   WHERE user_id = v_actor_id
     AND tenant_id = p_tenant_id
   LIMIT 1;

  -- Fall back: platform admin may operate across tenants.
  IF v_actor_role IS NULL THEN
    SELECT role INTO v_actor_role
      FROM public.profiles
     WHERE user_id = v_actor_id
       AND role = 'admin'
     LIMIT 1;
  END IF;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'forbidden: requires director, institution_admin, or admin role';
  END IF;

  -- Enforce schema bounds (complianceConfigSchema: 365-3650 days).
  IF p_data_retention_days IS NULL
     OR p_data_retention_days < 365
     OR p_data_retention_days > 3650 THEN
    RAISE EXCEPTION 'invalid: data_retention_days must be between 365 and 3650';
  END IF;

  -- Capture the old value for the audit event.
  SELECT data_retention_days INTO v_old_value
    FROM public.tenants
   WHERE id = p_tenant_id
   FOR UPDATE;
  IF v_old_value IS NULL THEN
    RAISE EXCEPTION 'tenant not found: %', p_tenant_id;
  END IF;

  -- Forecast: how many cases would be soft-deleted at the new retention?
  SELECT COUNT(*) INTO v_forecast_count
    FROM public.case_entries
   WHERE tenant_id = p_tenant_id
     AND deleted_at IS NULL
     AND created_at < (NOW() - (p_data_retention_days || ' days')::INTERVAL);
  v_forecast_date := CURRENT_DATE + (p_data_retention_days - v_old_value);

  -- Apply the policy.
  UPDATE public.tenants
     SET data_retention_days = p_data_retention_days,
         updated_at = NOW()
   WHERE id = p_tenant_id;

  -- Optional immediate purge (soft-delete only — never hard delete).
  IF p_purge_now THEN
    WITH purged AS (
      UPDATE public.case_entries
         SET deleted_at = NOW()
       WHERE tenant_id = p_tenant_id
         AND deleted_at IS NULL
         AND created_at < (NOW() - (p_data_retention_days || ' days')::INTERVAL)
       RETURNING 1
    )
    SELECT COUNT(*) INTO v_purged_count FROM purged;
  END IF;

  -- Audit (PHI is not included; just policy metadata).
  INSERT INTO public.audit_logs (tenant_id, action, resource_type, resource_id, user_id, metadata)
  VALUES (
    p_tenant_id,
    'data_retention_update',
    'tenant',
    p_tenant_id,
    v_actor_id,
    jsonb_build_object(
      'old_days', v_old_value,
      'new_days', p_data_retention_days,
      'purged', v_purged_count,
      'forecast_count', v_forecast_count
    )
  );

  RETURN jsonb_build_object(
    'old_days', v_old_value,
    'new_days', p_data_retention_days,
    'forecast_count', v_forecast_count,
    'forecast_date', v_forecast_date,
    'purged', v_purged_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_data_retention(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_data_retention(UUID, INTEGER, BOOLEAN) TO authenticated;
