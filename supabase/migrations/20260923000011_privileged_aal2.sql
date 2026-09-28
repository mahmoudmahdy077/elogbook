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
    CASE
      WHEN auth.jwt() ->> 'aal' IN ('aal1', 'aal2') THEN auth.jwt() ->> 'aal'
      ELSE NULL
    END
  FROM public.get_authoritative_principal() AS principal
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_principal_with_aal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authoritative_principal_with_aal() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_active_principal(
  p_allowed_roles TEXT[],
  p_tenant_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_is_platform_admin BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL
     OR COALESCE(auth.role(), 'authenticated') IS DISTINCT FROM 'authenticated'
     OR p_allowed_roles IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.role IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS NULL
     OR v_principal.role <> ALL (p_allowed_roles) THEN
    RETURN FALSE;
  END IF;

  IF v_principal.role = 'admin' THEN
    v_is_platform_admin := public.is_platform_admin();
    IF NOT v_is_platform_admin THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF p_tenant_id IS NOT NULL
     AND p_tenant_id IS DISTINCT FROM v_principal.tenant_id
     AND NOT v_is_platform_admin THEN
    RETURN FALSE;
  END IF;

  IF p_tenant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.tenants AS target_tenant
       WHERE target_tenant.id = p_tenant_id
         AND target_tenant.status = 'active'
         AND public.tenant_is_not_deleted(to_jsonb(target_tenant))
     ) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_privileged_principal(
  p_allowed_roles TEXT[],
  p_tenant_id UUID DEFAULT NULL,
  p_require_aal2 BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
BEGIN
  IF NOT public.require_active_principal(p_allowed_roles, p_tenant_id) THEN
    RETURN FALSE;
  END IF;

  IF NOT p_require_aal2 THEN
    RETURN TRUE;
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  RETURN FOUND
     AND v_principal.aal IS NOT DISTINCT FROM 'aal2';
END;
$$;

REVOKE ALL ON FUNCTION public.require_active_principal(TEXT[], UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.require_privileged_principal(TEXT[], UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_active_principal(TEXT[], UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_privileged_principal(TEXT[], UUID, BOOLEAN) TO authenticated, service_role;

ALTER FUNCTION public.approve_case(UUID, UUID, TEXT) RENAME TO __a2_approve_case;
ALTER FUNCTION public.reject_case(UUID, UUID, TEXT) RENAME TO __a2_reject_case;
ALTER FUNCTION public.get_dashboard_data(UUID, UUID, TEXT) RENAME TO __a2_get_dashboard_data;
ALTER FUNCTION public.get_analytics_data(UUID) RENAME TO __a2_get_analytics_data;
ALTER FUNCTION public.get_report_counts(UUID, TEXT, TEXT) RENAME TO __a2_get_report_counts;
ALTER FUNCTION public.get_duty_4wk_violations(UUID) RENAME TO __a2_get_duty_4wk_violations;
ALTER FUNCTION public.get_template_usage_counts(UUID, UUID) RENAME TO __a2_get_template_usage_counts;
ALTER FUNCTION public.check_case_quota(UUID) RENAME TO __a2_check_case_quota;
ALTER FUNCTION public.set_data_retention(UUID, INTEGER, BOOLEAN) RENAME TO __a2_set_data_retention;
ALTER FUNCTION public.grant_ai_quota(UUID, INTEGER, BOOLEAN) RENAME TO __a2_grant_ai_quota;
ALTER FUNCTION public.store_ai_config(TEXT, TEXT, TEXT, TEXT, BOOLEAN) RENAME TO __a2_store_ai_config;
ALTER FUNCTION public.store_payment_gateway_secret(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) RENAME TO __a2_store_payment_gateway_secret;
ALTER FUNCTION public.store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) RENAME TO __a2_store_tenant_webhook;
ALTER FUNCTION public.relabel_case_mode(UUID, BOOLEAN, TEXT) RENAME TO __a2_relabel_case_mode;
ALTER FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) RENAME TO __a2_submit_case_operation;
ALTER FUNCTION public.soft_delete_case(UUID) RENAME TO __a2_soft_delete_case;

REVOKE ALL ON FUNCTION public.__a2_approve_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_reject_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_get_dashboard_data(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_get_analytics_data(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_get_report_counts(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_get_duty_4wk_violations(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_get_template_usage_counts(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_check_case_quota(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_set_data_retention(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_grant_ai_quota(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_store_ai_config(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_store_payment_gateway_secret(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_relabel_case_mode(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.__a2_soft_delete_case(UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_approve_case(p_entry_id, p_supervisor_id, p_comment);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_reject_case(p_entry_id, p_supervisor_id, p_comment);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id UUID,
  p_resident_id UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
BEGIN
  IF p_tenant_id IS NULL
     OR NOT public.require_active_principal(
       ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF v_principal.role <> 'resident'
     AND NOT public.require_privileged_principal(
       ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN public.__a2_get_dashboard_data(p_tenant_id, p_resident_id, p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_analytics_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_tenant_id IS NULL
     OR NOT public.require_privileged_principal(
       ARRAY['director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_get_analytics_data(p_tenant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_report_counts(
  p_tenant_id UUID,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
BEGIN
  IF p_tenant_id IS NULL
     OR NOT public.require_active_principal(
       ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF v_principal.role <> 'resident'
     AND NOT public.require_privileged_principal(
       ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN public.__a2_get_report_counts(p_tenant_id, p_date_from, p_date_to);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_duty_4wk_violations(p_tenant_id UUID)
RETURNS TABLE (
  tenant_id UUID,
  resident_id UUID,
  window_start DATE,
  window_end DATE,
  avg_hours NUMERIC,
  weeks_in_window BIGINT,
  week_hours NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
BEGIN
  IF NOT public.require_active_principal(
    ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF v_principal.role <> 'resident'
     AND NOT public.require_privileged_principal(
       ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public.__a2_get_duty_4wk_violations(p_tenant_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_template_usage_counts(
  p_tenant_id UUID,
  p_resident_id UUID
)
RETURNS TABLE(template_id UUID, personal_count BIGINT, tenant_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
BEGIN
  IF p_tenant_id IS NULL OR p_resident_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT public.require_active_principal(
    ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF v_principal.role = 'resident' THEN
    IF v_principal.profile_id IS DISTINCT FROM p_resident_id
       OR v_principal.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    template.id,
    COUNT(entry.id) FILTER (WHERE entry.resident_id = p_resident_id),
    CASE
      WHEN v_principal.role = 'resident'
        THEN COUNT(entry.id) FILTER (WHERE entry.resident_id = p_resident_id)
      ELSE COUNT(entry.id)
    END
  FROM public.case_templates AS template
  LEFT JOIN public.case_entries AS entry
    ON entry.template_id = template.id
   AND entry.tenant_id = p_tenant_id
   AND entry.deleted_at IS NULL
  WHERE template.tenant_id IN (p_tenant_id, '00000000-0000-0000-0000-000000000000')
  GROUP BY template.id;
END;
$$;

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
  v_trusted_database_context BOOLEAN;
BEGIN
  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';

  IF auth.role() = 'service_role' OR v_trusted_database_context THEN
    RETURN QUERY
    SELECT * FROM public.__a2_check_case_quota(p_tenant_id);
    RETURN;
  END IF;

  IF p_tenant_id IS NULL
     OR NOT public.require_active_principal(
       ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF v_principal.role <> 'resident'
     AND NOT public.require_privileged_principal(
       ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT * FROM public.__a2_check_case_quota(p_tenant_id);
END;
$$;

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
BEGIN
  IF p_tenant_id IS NULL
     OR NOT public.require_privileged_principal(
       ARRAY['director', 'institution_admin', 'admin']::TEXT[],
       p_tenant_id,
       TRUE
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_set_data_retention(p_tenant_id, p_data_retention_days, p_purge_now);
END;
$$;

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
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_grant_ai_quota(p_resident_id, p_new_limit, p_reset);
END;
$$;

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
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_store_ai_config(p_provider, p_model, p_api_key, p_endpoint_url, p_is_active);
END;
$$;

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
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_store_payment_gateway_secret(
    p_provider,
    p_publishable_key,
    p_secret_key,
    p_webhook_secret,
    p_endpoint_url,
    p_mode
  );
END;
$$;

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
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_store_tenant_webhook(
    p_url,
    p_events,
    p_secret,
    p_description,
    p_is_active,
    p_webhook_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.relabel_case_mode(
  p_row_id UUID,
  p_to_deidentified BOOLEAN,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN public.__a2_relabel_case_mode(p_row_id, p_to_deidentified, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_case_operation(
  p_op_id TEXT,
  p_action TEXT,
  p_row_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_target_resident_id UUID;
BEGIN
  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS NULL
     OR v_principal.role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_principal.role <> 'resident' THEN
    IF NOT public.require_privileged_principal(
      ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
      v_principal.tenant_id,
      TRUE
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_principal.aal NOT IN ('aal1', 'aal2') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_row_id IS NOT NULL THEN
      SELECT entry.resident_id
      INTO v_target_resident_id
      FROM public.case_entries AS entry
      WHERE entry.id = p_row_id
        AND entry.tenant_id = v_principal.tenant_id;
      IF v_target_resident_id IS DISTINCT FROM v_principal.profile_id THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN public.__a2_submit_case_operation(p_op_id, p_action, p_row_id, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_case(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_resident_id UUID;
BEGIN
  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_principal.role <> 'resident' THEN
    IF NOT public.require_privileged_principal(
      ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
      v_principal.tenant_id,
      TRUE
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT entry.resident_id
    INTO v_resident_id
    FROM public.case_entries AS entry
    WHERE entry.id = p_entry_id
      AND entry.tenant_id = v_principal.tenant_id;
    IF v_resident_id IS DISTINCT FROM v_principal.profile_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN public.__a2_soft_delete_case(p_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_analytics_data(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_duty_4wk_violations(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_template_usage_counts(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_case_quota(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_data_retention(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_ai_quota(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_ai_config(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_payment_gateway_secret(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.relabel_case_mode(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.soft_delete_case(UUID) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.approve_case(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_case(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_duty_4wk_violations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_template_usage_counts(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_case_quota(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_data_retention(UUID, INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ai_quota(UUID, INTEGER, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_ai_config(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_payment_gateway_secret(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relabel_case_mode(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_case(UUID) TO authenticated;
