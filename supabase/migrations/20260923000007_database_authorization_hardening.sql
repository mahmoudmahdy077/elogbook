CREATE OR REPLACE FUNCTION public.get_authoritative_principal_with_aal()
RETURNS TABLE (
  user_id UUID,
  profile_id UUID,
  tenant_id UUID,
  role TEXT,
  profile_status TEXT,
  tenant_status TEXT,
  tenant_slug TEXT,
  aal TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    principal.user_id,
    principal.profile_id,
    principal.tenant_id,
    principal.role,
    principal.profile_status,
    principal.tenant_status,
    principal.tenant_slug,
    COALESCE(
      NULLIF(auth.jwt() ->> 'aal', ''),
      CASE
        WHEN auth.jwt() -> 'amr' @> '["mfa"]'::JSONB
          OR auth.jwt() -> 'amr' @> '["totp"]'::JSONB
        THEN 'aal2'
        ELSE NULL
      END
    ) AS aal
  FROM public.get_authoritative_principal() AS principal
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_principal_with_aal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_authoritative_principal_with_aal() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins AS platform_operator
    INNER JOIN public.profiles AS platform_profile
      ON platform_profile.user_id = platform_operator.user_id
    INNER JOIN public.tenants AS platform_tenant
      ON platform_tenant.id = platform_profile.tenant_id
    WHERE platform_operator.user_id = auth.uid()
      AND platform_operator.status = 'active'
      AND platform_profile.status = 'active'
      AND platform_tenant.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_case_stats(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS public.get_case_stats(uuid, date, date);
DROP FUNCTION IF EXISTS public.get_case_stats(uuid, uuid);

DO $$
DECLARE
  function_record RECORD;
BEGIN
  FOR function_record IN
    SELECT function_entry.oid::regprocedure AS signature
    FROM pg_proc AS function_entry
    INNER JOIN pg_namespace AS schema_entry ON schema_entry.oid = function_entry.pronamespace
    WHERE schema_entry.nspname = 'public'
      AND function_entry.proname = 'get_case_stats'
  LOOP
    EXECUTE format('DROP FUNCTION %s', function_record.signature);
  END LOOP;
END
$$;

CREATE FUNCTION public.get_case_stats(
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_resident_id UUID;
  v_aal TEXT;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
    RAISE EXCEPTION 'active authenticated principal required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.role IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active account and tenant are required'
      USING ERRCODE = '42501';
  END IF;

  v_profile_id := v_principal.profile_id;
  v_tenant_id := v_principal.tenant_id;
  v_role := v_principal.role;
  v_aal := v_principal.aal;

  IF v_aal IS NULL OR v_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION 'verified authentication assurance is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'unknown principal role'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'admin' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform administrator registry membership required'
      USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'resident' AND v_aal IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 is required for tenant-wide case statistics'
      USING ERRCODE = '42501';
  END IF;

  IF p_resident_id IS NOT NULL THEN
    v_resident_id := p_resident_id;
  ELSIF v_role = 'resident' THEN
    v_resident_id := v_profile_id;
  ELSE
    v_resident_id := NULL;
  END IF;

  IF v_role = 'resident' AND v_resident_id IS DISTINCT FROM v_profile_id THEN
    RAISE EXCEPTION 'residents may only request their own case statistics'
      USING ERRCODE = '42501';
  END IF;

  IF p_resident_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.profiles AS resident_profile
       WHERE resident_profile.id = v_resident_id
         AND resident_profile.tenant_id = v_tenant_id
         AND resident_profile.role = 'resident'
     ) THEN
    RAISE EXCEPTION 'resident argument is outside the active tenant'
      USING ERRCODE = '42501';
  END IF;

  IF p_from_date IS NOT NULL
     AND p_to_date IS NOT NULL
     AND p_from_date > p_to_date THEN
    RAISE EXCEPTION 'invalid case statistics date range'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'total_cases', COALESCE((
      SELECT COUNT(*)
      FROM public.case_entries AS entry
      WHERE entry.tenant_id = v_tenant_id
        AND entry.deleted_at IS NULL
        AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
        AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
        AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
        AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
    ), 0),
    'by_status', COALESCE((
      SELECT jsonb_object_agg(status_group.status, status_group.count)
      FROM (
        SELECT entry.status, COUNT(*) AS count
        FROM public.case_entries AS entry
        WHERE entry.tenant_id = v_tenant_id
          AND entry.deleted_at IS NULL
          AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
          AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
        GROUP BY entry.status
      ) AS status_group
    ), '{}'::JSONB),
    'by_specialty', COALESCE((
      SELECT jsonb_object_agg(specialty_group.specialty, specialty_group.count)
      FROM (
        SELECT template.specialty, COUNT(*) AS count
        FROM public.case_entries AS entry
        INNER JOIN public.case_templates AS template ON template.id = entry.template_id
        WHERE entry.tenant_id = v_tenant_id
          AND entry.deleted_at IS NULL
          AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
          AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
        GROUP BY template.specialty
      ) AS specialty_group
    ), '{}'::JSONB),
    'by_month', COALESCE((
      SELECT jsonb_object_agg(month_group.month, month_group.count)
      FROM (
        SELECT to_char(entry.case_date, 'YYYY-MM') AS month, COUNT(*) AS count
        FROM public.case_entries AS entry
        WHERE entry.tenant_id = v_tenant_id
          AND entry.deleted_at IS NULL
          AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
          AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
          AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
          AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
        GROUP BY to_char(entry.case_date, 'YYYY-MM')
        ORDER BY to_char(entry.case_date, 'YYYY-MM')
      ) AS month_group
    ), '{}'::JSONB),
    'pending_approvals', COALESCE((
      SELECT COUNT(*)
      FROM public.case_entries AS entry
      WHERE entry.tenant_id = v_tenant_id
        AND entry.deleted_at IS NULL
        AND entry.status = 'pending'
        AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
        AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
    ), 0),
    'rejection_rate', CASE
      WHEN (
        SELECT COUNT(*)
        FROM public.case_entries AS entry
        WHERE entry.tenant_id = v_tenant_id
          AND entry.deleted_at IS NULL
          AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
          AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
          AND entry.status IN ('approved', 'rejected')
      ) > 0 THEN
      ROUND(
        (
          SELECT COUNT(*)
          FROM public.case_entries AS entry
          WHERE entry.tenant_id = v_tenant_id
            AND entry.deleted_at IS NULL
            AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
            AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
            AND entry.status = 'rejected'
        )::NUMERIC
        /
        (
          SELECT COUNT(*)
          FROM public.case_entries AS entry
          WHERE entry.tenant_id = v_tenant_id
            AND entry.deleted_at IS NULL
            AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
            AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
            AND entry.status IN ('approved', 'rejected')
        )::NUMERIC
        * 100,
        2
      )
      ELSE 0
    END
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_case_stats(uuid, date, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_case_stats(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_data_retention(
  p_tenant_id UUID,
  p_data_retention_days INTEGER,
  p_purge_now BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_actor_id UUID;
  v_actor_role TEXT;
  v_actor_tenant_id UUID;
  v_aal TEXT;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_old_value INTEGER;
  v_purged_count INTEGER := 0;
  v_forecast_count BIGINT;
  v_forecast_date DATE;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant is required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RAISE EXCEPTION 'active authenticated principal required'
        USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.tenant_id IS NULL
       OR v_principal.role IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    v_actor_id := v_principal.user_id;
    v_actor_role := v_principal.role;
    v_actor_tenant_id := v_principal.tenant_id;
    v_aal := v_principal.aal;

    IF v_actor_role NOT IN ('director', 'institution_admin', 'admin') THEN
      RAISE EXCEPTION 'privileged tenant role required'
        USING ERRCODE = '42501';
    END IF;

    IF v_actor_role = 'admin' AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'platform administrator registry membership required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS DISTINCT FROM v_actor_tenant_id AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'cross-tenant retention change denied'
        USING ERRCODE = '42501';
    END IF;

    IF v_aal IS DISTINCT FROM 'aal2' THEN
      RAISE EXCEPTION 'AAL2 is required for retention changes'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_data_retention_days IS NULL
     OR p_data_retention_days < 365
     OR p_data_retention_days > 3650 THEN
    RAISE EXCEPTION 'invalid data retention days'
      USING ERRCODE = '22023';
  END IF;

  SELECT tenant.data_retention_days
  INTO v_old_value
  FROM public.tenants AS tenant
  WHERE tenant.id = p_tenant_id
    AND tenant.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'active tenant not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*)
  INTO v_forecast_count
  FROM public.case_entries AS entry
  WHERE entry.tenant_id = p_tenant_id
    AND entry.deleted_at IS NULL
    AND entry.created_at < (NOW() - (p_data_retention_days || ' days')::INTERVAL);

  v_forecast_date := CURRENT_DATE + (p_data_retention_days - COALESCE(v_old_value, p_data_retention_days));

  UPDATE public.tenants
  SET data_retention_days = p_data_retention_days,
      updated_at = NOW()
  WHERE id = p_tenant_id
    AND status = 'active';

  IF p_purge_now THEN
    WITH purged AS (
      UPDATE public.case_entries AS entry
      SET deleted_at = NOW()
      WHERE entry.tenant_id = p_tenant_id
        AND entry.deleted_at IS NULL
        AND entry.created_at < (NOW() - (p_data_retention_days || ' days')::INTERVAL)
      RETURNING 1
    )
    SELECT COUNT(*)
    INTO v_purged_count
    FROM purged;
  END IF;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes
  )
  VALUES (
    p_tenant_id,
    v_actor_id,
    'data_retention_update',
    'tenant',
    p_tenant_id,
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

REVOKE ALL ON FUNCTION public.set_data_retention(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_data_retention(uuid, integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_resident_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_aal TEXT;
  v_target_tenant_id UUID;
  v_target_profile_status TEXT;
  v_target_tenant_status TEXT;
  v_new_used INTEGER;
  v_limit INTEGER;
BEGIN
  IF p_resident_id IS NULL OR p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota request'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RETURN jsonb_build_object('success', false, 'error', 'unauthenticated', 'code', 'auth');
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND OR v_principal.profile_id IS NULL OR v_principal.tenant_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'principal_not_found', 'code', 'auth');
    END IF;

    IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'account_suspended', 'code', 'account_suspended');
    END IF;

    IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'tenant_suspended', 'code', 'tenant_suspended');
    END IF;

    v_profile_id := v_principal.profile_id;
    v_tenant_id := v_principal.tenant_id;
    v_role := v_principal.role;
    v_aal := v_principal.aal;

  END IF;

  SELECT
    target_tenant.id,
    target_profile.status,
    target_tenant.status
  INTO v_target_tenant_id, v_target_profile_status, v_target_tenant_status
  FROM public.profiles AS target_profile
  INNER JOIN public.tenants AS target_tenant ON target_tenant.id = target_profile.tenant_id
  WHERE target_profile.id = p_resident_id
    AND target_profile.role = 'resident';

  IF NOT FOUND
     OR v_target_profile_status IS DISTINCT FROM 'active'
     OR v_target_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  IF NOT v_is_service_role THEN
    IF v_target_tenant_id IS DISTINCT FROM v_tenant_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'cross_tenant_quota', 'code', 'forbidden');
    END IF;

    IF p_resident_id IS DISTINCT FROM v_profile_id THEN
      IF v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin')
         OR v_aal IS DISTINCT FROM 'aal2'
         OR (v_role = 'admin' AND NOT public.is_platform_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
      END IF;
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_used = quota_used + p_count
  WHERE resident_id = p_resident_id
    AND tenant_id = v_target_tenant_id
    AND enabled = TRUE
    AND (quota_limit = 0 OR quota_used + p_count <= quota_limit)
  RETURNING quota_used, quota_limit
  INTO v_new_used, v_limit;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'quota_exceeded_or_ai_disabled',
      'code', 'quota_exceeded',
      'quota_used', 0,
      'quota_limit', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'quota_used', v_new_used,
    'quota_limit', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_ai_quota(
  p_resident_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_aal TEXT;
  v_target_tenant_id UUID;
  v_target_profile_status TEXT;
  v_target_tenant_status TEXT;
  v_new_used INTEGER;
BEGIN
  IF p_resident_id IS NULL OR p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota request'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RETURN jsonb_build_object('success', false, 'error', 'unauthenticated', 'code', 'auth');
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND OR v_principal.profile_id IS NULL OR v_principal.tenant_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'principal_not_found', 'code', 'auth');
    END IF;

    IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'account_suspended', 'code', 'account_suspended');
    END IF;

    IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'tenant_suspended', 'code', 'tenant_suspended');
    END IF;

    v_profile_id := v_principal.profile_id;
    v_tenant_id := v_principal.tenant_id;
    v_role := v_principal.role;
    v_aal := v_principal.aal;

  END IF;

  SELECT
    target_tenant.id,
    target_profile.status,
    target_tenant.status
  INTO v_target_tenant_id, v_target_profile_status, v_target_tenant_status
  FROM public.profiles AS target_profile
  INNER JOIN public.tenants AS target_tenant ON target_tenant.id = target_profile.tenant_id
  WHERE target_profile.id = p_resident_id
    AND target_profile.role = 'resident';

  IF NOT FOUND
     OR v_target_profile_status IS DISTINCT FROM 'active'
     OR v_target_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  IF NOT v_is_service_role THEN
    IF v_target_tenant_id IS DISTINCT FROM v_tenant_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'cross_tenant_quota', 'code', 'forbidden');
    END IF;

    IF p_resident_id IS DISTINCT FROM v_profile_id THEN
      IF v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin')
         OR v_aal IS DISTINCT FROM 'aal2'
         OR (v_role = 'admin' AND NOT public.is_platform_admin()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
      END IF;
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_used = GREATEST(0, quota_used - p_count)
  WHERE resident_id = p_resident_id
    AND tenant_id = v_target_tenant_id
  RETURNING quota_used
  INTO v_new_used;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'quota_used', v_new_used
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_ai_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_ai_quota(
  p_resident_id UUID,
  p_new_limit INTEGER,
  p_reset BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_aal TEXT;
  v_target_tenant_id UUID;
  v_target_profile_status TEXT;
  v_target_tenant_status TEXT;
BEGIN
  IF p_resident_id IS NULL
     OR p_new_limit IS NULL
     OR p_new_limit < 0
     OR p_new_limit > 1000000 THEN
    RAISE EXCEPTION 'invalid quota grant'
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RETURN jsonb_build_object('success', false, 'error', 'unauthenticated', 'code', 'auth');
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND OR v_principal.profile_id IS NULL OR v_principal.tenant_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'principal_not_found', 'code', 'auth');
    END IF;

    IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'account_suspended', 'code', 'account_suspended');
    END IF;

    IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
      RETURN jsonb_build_object('success', false, 'error', 'tenant_suspended', 'code', 'tenant_suspended');
    END IF;

    v_profile_id := v_principal.profile_id;
    v_tenant_id := v_principal.tenant_id;
    v_role := v_principal.role;
    v_aal := v_principal.aal;

    IF v_role NOT IN ('director', 'institution_admin', 'admin')
       OR v_aal IS DISTINCT FROM 'aal2'
       OR (v_role = 'admin' AND NOT public.is_platform_admin()) THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
    END IF;
  END IF;

  SELECT
    target_tenant.id,
    target_profile.status,
    target_tenant.status
  INTO v_target_tenant_id, v_target_profile_status, v_target_tenant_status
  FROM public.profiles AS target_profile
  INNER JOIN public.tenants AS target_tenant ON target_tenant.id = target_profile.tenant_id
  WHERE target_profile.id = p_resident_id
    AND target_profile.role = 'resident';

  IF NOT FOUND
     OR v_target_profile_status IS DISTINCT FROM 'active'
     OR v_target_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  IF NOT v_is_service_role AND v_target_tenant_id IS DISTINCT FROM v_tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_tenant_quota', 'code', 'forbidden');
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_limit = p_new_limit,
      quota_used = CASE WHEN p_reset THEN 0 ELSE quota_used END,
      enabled = TRUE
  WHERE resident_id = p_resident_id
    AND tenant_id = v_target_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'resident_id', p_resident_id,
    'quota_limit', p_new_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_ai_quota(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_quota(uuid, integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_case_quota(p_tenant_id UUID)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count BIGINT,
  max_cases INTEGER,
  plan_slug TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_tenant_id UUID;
  v_plan_id UUID;
  v_features JSONB;
  v_max_cases INTEGER;
  v_current_count BIGINT;
  v_plan_slug TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant is required'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL
     AND session_user IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon') THEN
    v_tenant_id := p_tenant_id;
  ELSIF NOT v_is_service_role THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RAISE EXCEPTION 'active authenticated principal required'
        USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.tenant_id IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant quota access denied'
        USING ERRCODE = '42501';
    END IF;

    v_tenant_id := v_principal.tenant_id;
  ELSE
    v_tenant_id := p_tenant_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tenants AS tenant
    WHERE tenant.id = v_tenant_id
      AND tenant.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active tenant not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT subscription.plan_id
  INTO v_plan_id
  FROM public.subscriptions AS subscription
  WHERE subscription.tenant_id = v_tenant_id
    AND subscription.status = 'active'
  ORDER BY subscription.created_at DESC
  LIMIT 1;

  SELECT plan.features
  INTO v_features
  FROM public.subscription_plans AS plan
  WHERE plan.id = v_plan_id;

  v_features := COALESCE(v_features, '{"max_cases":20}'::JSONB);
  v_max_cases := COALESCE(NULLIF(v_features ->> 'max_cases', '')::INTEGER, 20);
  v_plan_slug := (
    SELECT plan.slug
    FROM public.subscription_plans AS plan
    WHERE plan.id = v_plan_id
  );

  SELECT COUNT(*)
  INTO v_current_count
  FROM public.case_entries AS entry
  WHERE entry.tenant_id = v_tenant_id
    AND entry.deleted_at IS NULL;

  RETURN QUERY
  SELECT
    CASE
      WHEN v_max_cases = 0 THEN TRUE
      ELSE v_current_count < v_max_cases
    END,
    v_current_count,
    v_max_cases,
    v_plan_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.check_case_quota(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_case_quota(uuid) TO authenticated, service_role;

REVOKE ALL ON TABLE public.resident_ai_toggle FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.resident_ai_toggle TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.resident_ai_toggle TO service_role;

DO $$
DECLARE
  table_name TEXT;
  policy_record RECORD;
  column_record RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ai_config',
    'payment_gateway_config',
    'tenant_webhooks',
    'tenant_webhook_deliveries',
    'tenant_sso_configs'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_record.policyname, table_name);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);

    FOR column_record IN
      SELECT attribute_entry.attname
      FROM pg_attribute AS attribute_entry
      WHERE attribute_entry.attrelid = to_regclass(format('public.%I', table_name))
        AND attribute_entry.attnum > 0
        AND NOT attribute_entry.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_record.attname,
        column_record.attname,
        column_record.attname,
        column_record.attname,
        table_name
      );
    END LOOP;

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I TO service_role',
      table_name
    );
  END LOOP;
END
$$;

DROP VIEW IF EXISTS public.secret_ai_config;
DROP VIEW IF EXISTS public.secret_payment_gateway_config;
DROP VIEW IF EXISTS public.secret_tenant_webhooks;

CREATE VIEW public.secret_ai_config AS
SELECT
  config.id,
  config.tenant_id,
  config.provider,
  config.model,
  config.endpoint_url,
  config.is_active,
  config.key_version,
  config.created_at,
  config.updated_at
FROM public.ai_config AS config
WHERE auth.role() = 'service_role'
   OR EXISTS (
     SELECT 1
     FROM public.get_authoritative_principal_with_aal() AS principal
     WHERE principal.tenant_id = config.tenant_id
       AND principal.profile_status = 'active'
       AND principal.tenant_status = 'active'
       AND principal.aal = 'aal2'
       AND principal.role IN ('institution_admin', 'admin')
       AND (principal.role <> 'admin' OR public.is_platform_admin())
   );

CREATE VIEW public.secret_payment_gateway_config AS
SELECT
  config.id,
  config.tenant_id,
  config.provider,
  config.publishable_key,
  config.is_active,
  config.mode,
  config.endpoint_url,
  config.key_version,
  config.created_at,
  config.updated_at
FROM public.payment_gateway_config AS config
WHERE auth.role() = 'service_role'
   OR EXISTS (
     SELECT 1
     FROM public.get_authoritative_principal_with_aal() AS principal
     WHERE principal.tenant_id = config.tenant_id
       AND principal.profile_status = 'active'
       AND principal.tenant_status = 'active'
       AND principal.aal = 'aal2'
       AND principal.role IN ('director', 'institution_admin', 'admin')
       AND (principal.role <> 'admin' OR public.is_platform_admin())
   );

CREATE VIEW public.secret_tenant_webhooks AS
SELECT
  webhook.id,
  webhook.tenant_id,
  webhook.url,
  webhook.events,
  webhook.description,
  webhook.is_active,
  webhook.created_at,
  webhook.updated_at
FROM public.tenant_webhooks AS webhook
WHERE auth.role() = 'service_role'
   OR EXISTS (
     SELECT 1
     FROM public.get_authoritative_principal_with_aal() AS principal
     WHERE principal.tenant_id = webhook.tenant_id
       AND principal.profile_status = 'active'
       AND principal.tenant_status = 'active'
       AND principal.aal = 'aal2'
       AND principal.role IN ('director', 'institution_admin', 'admin')
       AND (principal.role <> 'admin' OR public.is_platform_admin())
   );

ALTER VIEW public.secret_ai_config SET (security_barrier = true);
ALTER VIEW public.secret_payment_gateway_config SET (security_barrier = true);
ALTER VIEW public.secret_tenant_webhooks SET (security_barrier = true);

REVOKE ALL ON public.secret_ai_config FROM PUBLIC, anon;
REVOKE ALL ON public.secret_payment_gateway_config FROM PUBLIC, anon;
REVOKE ALL ON public.secret_tenant_webhooks FROM PUBLIC, anon;
GRANT SELECT ON public.secret_ai_config TO authenticated, service_role;
GRANT SELECT ON public.secret_payment_gateway_config TO authenticated, service_role;
GRANT SELECT ON public.secret_tenant_webhooks TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_ai_config(
  p_provider TEXT,
  p_model TEXT,
  p_api_key TEXT,
  p_endpoint_url TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_tenant_id UUID;
  v_key TEXT;
  v_id UUID;
BEGIN
  IF auth.role() = 'service_role' THEN
    RAISE EXCEPTION 'tenant-scoped store_ai_config context is required'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
    RAISE EXCEPTION 'active authenticated principal required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active account and tenant are required'
      USING ERRCODE = '42501';
  END IF;

  IF v_principal.role NOT IN ('institution_admin', 'admin')
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR (v_principal.role = 'admin' AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'AAL2 tenant administrator authorization required'
      USING ERRCODE = '42501';
  END IF;

  v_tenant_id := v_principal.tenant_id;

  IF p_provider IS NULL OR btrim(p_provider) = '' OR p_model IS NULL OR btrim(p_model) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_configuration');
  END IF;

  IF p_api_key IS NULL OR char_length(p_api_key) < 8 OR char_length(p_api_key) > 4096 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_secret');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  INSERT INTO public.ai_config (
    tenant_id,
    provider,
    model,
    endpoint_url,
    is_active,
    api_key_enc,
    key_version
  )
  VALUES (
    v_tenant_id,
    p_provider,
    p_model,
    p_endpoint_url,
    p_is_active,
    extensions.pgp_sym_encrypt(p_api_key, v_key),
    1
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      endpoint_url = EXCLUDED.endpoint_url,
      is_active = EXCLUDED.is_active,
      api_key_enc = EXCLUDED.api_key_enc,
      key_version = public.ai_config.key_version + 1,
      updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.store_ai_config(text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_ai_config(text, text, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_payment_gateway_secret(
  p_provider TEXT,
  p_publishable_key TEXT,
  p_secret_key TEXT,
  p_webhook_secret TEXT,
  p_endpoint_url TEXT DEFAULT NULL,
  p_mode TEXT DEFAULT 'test'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_tenant_id UUID;
  v_key TEXT;
  v_id UUID;
BEGIN
  IF auth.role() = 'service_role' THEN
    RAISE EXCEPTION 'tenant-scoped store_payment_gateway_secret context is required'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
    RAISE EXCEPTION 'active authenticated principal required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active account and tenant are required'
      USING ERRCODE = '42501';
  END IF;

  IF v_principal.role NOT IN ('director', 'institution_admin', 'admin')
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR (v_principal.role = 'admin' AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'AAL2 tenant administrator authorization required'
      USING ERRCODE = '42501';
  END IF;

  v_tenant_id := v_principal.tenant_id;

  IF p_provider IS NULL OR btrim(p_provider) = ''
     OR p_publishable_key IS NULL OR btrim(p_publishable_key) = ''
     OR p_mode IS NULL
     OR p_mode NOT IN ('test', 'live') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_configuration');
  END IF;

  IF p_secret_key IS NULL OR char_length(p_secret_key) < 8 OR char_length(p_secret_key) > 4096
     OR p_webhook_secret IS NULL OR char_length(p_webhook_secret) < 8 OR char_length(p_webhook_secret) > 4096 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_secret');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  INSERT INTO public.payment_gateway_config (
    tenant_id,
    provider,
    publishable_key,
    secret_key_enc,
    webhook_secret_enc,
    endpoint_url,
    is_active,
    mode,
    key_version
  )
  VALUES (
    v_tenant_id,
    p_provider,
    p_publishable_key,
    extensions.pgp_sym_encrypt(p_secret_key, v_key),
    extensions.pgp_sym_encrypt(p_webhook_secret, v_key),
    p_endpoint_url,
    p_mode = 'live',
    p_mode,
    1
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET provider = EXCLUDED.provider,
      publishable_key = EXCLUDED.publishable_key,
      secret_key_enc = EXCLUDED.secret_key_enc,
      webhook_secret_enc = EXCLUDED.webhook_secret_enc,
      endpoint_url = EXCLUDED.endpoint_url,
      is_active = EXCLUDED.is_active,
      mode = EXCLUDED.mode,
      key_version = public.payment_gateway_config.key_version + 1,
      updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.store_payment_gateway_secret(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_payment_gateway_secret(text, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.store_tenant_webhook(
  p_url TEXT,
  p_events TEXT[],
  p_secret TEXT,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_webhook_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_tenant_id UUID;
  v_key TEXT;
  v_id UUID;
BEGIN
  IF auth.role() = 'service_role' THEN
    RAISE EXCEPTION 'tenant-scoped store_tenant_webhook context is required'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
    RAISE EXCEPTION 'active authenticated principal required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active account and tenant are required'
      USING ERRCODE = '42501';
  END IF;

  IF v_principal.role NOT IN ('director', 'institution_admin', 'admin')
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR (v_principal.role = 'admin' AND NOT public.is_platform_admin()) THEN
    RAISE EXCEPTION 'AAL2 tenant administrator authorization required'
      USING ERRCODE = '42501';
  END IF;

  v_tenant_id := v_principal.tenant_id;

  IF p_url IS NULL OR btrim(p_url) = ''
     OR array_length(p_events, 1) IS NULL
     OR array_length(p_events, 1) = 0
     OR (
       p_webhook_id IS NULL
       AND (
         p_secret IS NULL
         OR char_length(p_secret) < 8
         OR char_length(p_secret) > 4096
       )
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_webhook');
  END IF;

  IF current_setting('app.environment', true) = 'production'
     AND p_url NOT ILIKE 'https://%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'https_required');
  END IF;

  IF p_webhook_id IS NOT NULL
     AND p_secret IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenant_webhooks AS existing_webhook
       WHERE existing_webhook.id = p_webhook_id
         AND existing_webhook.tenant_id = v_tenant_id
         AND existing_webhook.secret_enc IS NOT NULL
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF p_secret IS NOT NULL AND (v_key IS NULL OR v_key = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  IF p_webhook_id IS NULL THEN
    IF (
      SELECT COUNT(*)
      FROM public.tenant_webhooks
      WHERE tenant_id = v_tenant_id
    ) >= 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'webhook_limit');
    END IF;

    INSERT INTO public.tenant_webhooks (
      tenant_id,
      url,
      events,
      secret,
      secret_enc,
      description,
      is_active
    )
    VALUES (
      v_tenant_id,
      p_url,
      p_events,
      '[ENCRYPTED]',
      extensions.pgp_sym_encrypt(p_secret, v_key),
      p_description,
      p_is_active
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tenant_webhooks
    SET url = p_url,
        events = p_events,
        secret = CASE
          WHEN p_secret IS NULL THEN secret
          ELSE '[ENCRYPTED]'
        END,
        secret_enc = CASE
          WHEN p_secret IS NULL THEN secret_enc
          ELSE extensions.pgp_sym_encrypt(p_secret, v_key)
        END,
        description = p_description,
        is_active = p_is_active,
        updated_at = NOW()
    WHERE id = p_webhook_id
      AND tenant_id = v_tenant_id
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.store_tenant_webhook(text, text[], text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_tenant_webhook(text, text[], text, text, boolean, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rotate_tenant_webhook_secrets(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_key TEXT;
  v_count INTEGER;
  v_rotated INTEGER := 0;
  v_item JSONB;
  v_webhook_id UUID;
  v_tenant_id UUID;
  v_tenant_status TEXT;
  v_secret TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR COALESCE(auth.role(), 'authenticated') IN ('anon', 'service_role') THEN
      RAISE EXCEPTION 'service-role operations context required'
        USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_principal
    FROM public.get_authoritative_principal_with_aal()
    LIMIT 1;

    IF NOT FOUND
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active'
       OR v_principal.role NOT IN ('director', 'institution_admin', 'admin')
       OR v_principal.aal IS DISTINCT FROM 'aal2'
       OR (v_principal.role = 'admin' AND NOT public.is_platform_admin()) THEN
      RAISE EXCEPTION 'AAL2 tenant administrator authorization required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'invalid_items');
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 100 THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'invalid_batch_size');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'encryption_unavailable');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    v_webhook_id := NULLIF(v_item ->> 'webhook_id', '')::UUID;
    v_tenant_id := NULLIF(v_item ->> 'tenant_id', '')::UUID;
    v_secret := v_item ->> 'secret';

    IF v_webhook_id IS NULL
       OR v_tenant_id IS NULL
       OR v_secret IS NULL
       OR char_length(v_secret) < 8
       OR char_length(v_secret) > 4096 THEN
      RAISE EXCEPTION 'invalid rotation item'
        USING ERRCODE = '22023';
    END IF;

    SELECT tenant.status
    INTO v_tenant_status
    FROM public.tenants AS tenant
    WHERE tenant.id = v_tenant_id;

    IF v_tenant_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'rotation tenant is not active'
        USING ERRCODE = '42501';
    END IF;

    IF auth.role() IS DISTINCT FROM 'service_role'
       AND v_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant secret rotation denied'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.tenant_webhooks
    SET secret = '[ENCRYPTED]',
        secret_enc = extensions.pgp_sym_encrypt(v_secret, v_key),
        updated_at = NOW()
    WHERE id = v_webhook_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'rotation target not found'
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      resource_type,
      resource_id,
      changes
    )
    VALUES (
      v_tenant_id,
      auth.uid(),
      'tenant_webhook_secret_rotation',
      'tenant_webhooks',
      v_webhook_id,
      jsonb_build_object(
        'changed_fields',
        jsonb_build_array('secret', 'secret_enc')
      )
    );

    v_rotated := v_rotated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'rotated',
    'count', v_rotated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_tenant_webhook_secrets(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_tenant_webhook_secrets(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_tenant_webhook_secret(p_webhook_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_secret_enc BYTEA;
  v_key TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role operations context required'
      USING ERRCODE = '42501';
  END IF;

  SELECT webhook.secret_enc
  INTO v_secret_enc
  FROM public.tenant_webhooks AS webhook
  INNER JOIN public.tenants AS tenant ON tenant.id = webhook.tenant_id
  WHERE webhook.id = p_webhook_id
    AND tenant.status = 'active';

  IF NOT FOUND OR v_secret_enc IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'webhook encryption key is not configured'
      USING ERRCODE = '42501';
  END IF;

  RETURN extensions.pgp_sym_decrypt(v_secret_enc, v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_webhook_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_webhook_secret(uuid) TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.protect_profile_authorization_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
  v_principal RECORD;
  v_platform_admin BOOLEAN := FALSE;
  v_identity_changed BOOLEAN;
  v_authority_changed BOOLEAN;
  v_actor_can_change BOOLEAN := FALSE;
  v_remaining_admins BIGINT;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     AND (auth.role() IS NULL OR auth.role() = 'postgres') THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active account and tenant are required'
      USING ERRCODE = '42501';
  END IF;

  v_platform_admin := public.is_platform_admin();

  v_identity_changed :=
    (v_old -> 'id') IS DISTINCT FROM (v_new -> 'id')
    OR (v_old -> 'user_id') IS DISTINCT FROM (v_new -> 'user_id')
    OR (v_old -> 'tenant_id') IS DISTINCT FROM (v_new -> 'tenant_id')
    OR (v_old -> 'created_at') IS DISTINCT FROM (v_new -> 'created_at')
    OR (v_old -> 'updated_at') IS DISTINCT FROM (v_new -> 'updated_at');

  v_authority_changed :=
    (v_old -> 'role') IS DISTINCT FROM (v_new -> 'role')
    OR (v_old -> 'status') IS DISTINCT FROM (v_new -> 'status')
    OR (v_old -> 'invited_by') IS DISTINCT FROM (v_new -> 'invited_by')
    OR (v_old -> 'deactivated_at') IS DISTINCT FROM (v_new -> 'deactivated_at')
    OR (v_old -> 'last_login_at') IS DISTINCT FROM (v_new -> 'last_login_at');

  IF v_identity_changed AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'profile identity columns are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF v_authority_changed THEN
    v_actor_can_change := v_platform_admin OR (
      v_principal.tenant_id = OLD.tenant_id
      AND OLD.role = 'resident'
      AND v_principal.role IN ('director', 'institution_admin', 'admin')
    );

    IF NOT v_actor_can_change THEN
      RAISE EXCEPTION 'profile authorization columns require administrator authorization'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.role IN ('admin', 'institution_admin')
     AND OLD.status = 'active'
     AND to_jsonb(OLD) ->> 'deleted_at' IS NULL
     AND (
       NEW.role NOT IN ('admin', 'institution_admin')
       OR NEW.status IS DISTINCT FROM 'active'
     ) THEN
    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND to_jsonb(admin_profile) ->> 'deleted_at' IS NULL;

    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'the last active tenant administrator cannot be removed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_admin_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_remaining_admins BIGINT;
BEGIN
  IF OLD.role IN ('admin', 'institution_admin')
     AND OLD.status = 'active'
     AND to_jsonb(OLD) ->> 'deleted_at' IS NULL THEN
    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND to_jsonb(admin_profile) ->> 'deleted_at' IS NULL;

    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'the last active tenant administrator cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_authorization_guard ON public.profiles;
DROP TRIGGER IF EXISTS aaa_profile_authorization_guard ON public.profiles;
CREATE TRIGGER aaa_profile_authorization_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_authorization_columns();

DROP TRIGGER IF EXISTS trg_profile_admin_guard ON public.profiles;
CREATE TRIGGER trg_profile_admin_guard
BEFORE DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_admin_deletion();

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', policy_record.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Active users can read their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  );

CREATE POLICY "Active privileged users can read tenant profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Platform administrators can read profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "Only platform administrators can create profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenants AS tenant
      WHERE tenant.id = profiles.tenant_id
        AND tenant.status = 'active'
    )
  );

CREATE POLICY "Active users can update their own mutable profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  );

CREATE POLICY "Tenant supervisors and administrators can update resident profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND role = 'resident'
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Platform administrators can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Tenant administrators can delete resident profiles"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND role = 'resident'
    AND public.get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Platform administrators can delete profiles"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

DO $$
DECLARE
  function_record RECORD;
  v_signature TEXT;
  v_function_oid OID;
  v_case_stats_signature REGPROCEDURE := to_regprocedure('public.get_case_stats(uuid,date,date)');
BEGIN
  FOR function_record IN
    SELECT
      function_entry.oid::regprocedure AS signature,
      function_entry.oid AS function_oid
    FROM pg_proc AS function_entry
    INNER JOIN pg_namespace AS schema_entry ON schema_entry.oid = function_entry.pronamespace
    WHERE schema_entry.nspname = 'public'
      AND function_entry.prosecdef
      AND function_entry.prokind = 'f'
  LOOP
    v_signature := function_record.signature::TEXT;
    v_function_oid := function_record.function_oid;

    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      v_signature
    );
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_signature);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', v_signature);
    END IF;

    IF v_case_stats_signature IS NULL OR v_function_oid <> v_case_stats_signature::OID THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
      END IF;
    END IF;
  END LOOP;
END
$$;
