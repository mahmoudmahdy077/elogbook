CREATE OR REPLACE FUNCTION public.get_authoritative_principal()
RETURNS TABLE (
  user_id UUID,
  profile_id UUID,
  tenant_id UUID,
  role TEXT,
  profile_status TEXT,
  tenant_status TEXT,
  tenant_slug TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    profile.user_id,
    profile.id,
    profile.tenant_id,
    profile.role,
    profile.status,
    tenant.status,
    tenant.slug
  FROM public.profiles AS profile
  INNER JOIN public.tenants AS tenant ON tenant.id = profile.tenant_id
  WHERE profile.user_id = auth.uid()
    AND profile.deleted_at IS NULL
    AND tenant.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.is_account_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal() AS principal
    WHERE principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal() AS principal
    WHERE principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
$$;

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
      AND platform_profile.deleted_at IS NULL
      AND platform_tenant.status = 'active'
      AND platform_tenant.deleted_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.get_case_stats(
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
         AND resident_profile.status = 'active'
         AND resident_profile.deleted_at IS NULL
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
          AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
          AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
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
          AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
          AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
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
        AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
        AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
    ), 0),
    'rejection_rate', CASE
      WHEN (
        SELECT COUNT(*)
        FROM public.case_entries AS entry
        WHERE entry.tenant_id = v_tenant_id
          AND entry.deleted_at IS NULL
          AND (v_role <> 'resident' OR entry.resident_id = v_profile_id)
          AND (v_resident_id IS NULL OR entry.resident_id = v_resident_id)
          AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
          AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
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
            AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
            AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
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
            AND (p_from_date IS NULL OR entry.case_date >= p_from_date)
            AND (p_to_date IS NULL OR entry.case_date <= p_to_date)
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
  v_target_tenant_id UUID;
  v_new_used INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role operations context required'
      USING ERRCODE = '42501';
  END IF;

  IF p_resident_id IS NULL OR p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota request'
      USING ERRCODE = '22023';
  END IF;

  SELECT target_tenant.id
  INTO v_target_tenant_id
  FROM public.profiles AS target_profile
  INNER JOIN public.tenants AS target_tenant
    ON target_tenant.id = target_profile.tenant_id
  WHERE target_profile.id = p_resident_id
    AND target_profile.role = 'resident'
    AND target_profile.status = 'active'
    AND target_profile.deleted_at IS NULL
    AND target_tenant.status = 'active'
    AND target_tenant.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
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
GRANT EXECUTE ON FUNCTION public.release_ai_quota(uuid, integer) TO service_role;

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
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_remaining_admins BIGINT;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NOT v_is_service_role THEN
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
  END IF;

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
    OR (v_old -> 'last_login_at') IS DISTINCT FROM (v_new -> 'last_login_at')
    OR (v_old -> 'deleted_at') IS DISTINCT FROM (v_new -> 'deleted_at');

  IF v_identity_changed AND NOT v_is_service_role THEN
    IF NOT v_platform_admin THEN
      RAISE EXCEPTION 'profile identity columns are immutable'
        USING ERRCODE = '42501';
    END IF;

    IF v_principal.aal IS DISTINCT FROM 'aal2' THEN
      RAISE EXCEPTION 'AAL2 is required for profile identity changes'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_authority_changed THEN
    IF NOT v_is_service_role AND v_principal.aal IS DISTINCT FROM 'aal2' THEN
      RAISE EXCEPTION 'AAL2 is required for profile authorization changes'
        USING ERRCODE = '42501';
    END IF;

    v_actor_can_change := v_is_service_role OR v_platform_admin OR (
      v_principal.tenant_id = OLD.tenant_id
      AND v_principal.role = 'institution_admin'
      AND OLD.role = 'resident'
      AND NEW.role <> 'admin'
    );

    IF NOT v_actor_can_change THEN
      RAISE EXCEPTION 'profile authorization columns require administrator authorization'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF OLD.role IN ('admin', 'institution_admin')
     AND OLD.status = 'active'
     AND OLD.deleted_at IS NULL
     AND (
       NEW.role NOT IN ('admin', 'institution_admin')
       OR NEW.status IS DISTINCT FROM 'active'
       OR NEW.deleted_at IS NOT NULL
     ) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(OLD.tenant_id::TEXT, 0)
    );

    PERFORM 1
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL
    ORDER BY admin_profile.id
    FOR UPDATE;

    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL;

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
     AND OLD.deleted_at IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(OLD.tenant_id::TEXT, 0)
    );

    PERFORM 1
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL
    ORDER BY admin_profile.id
    FOR UPDATE;

    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = OLD.tenant_id
      AND admin_profile.id <> OLD.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL;

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
  AND deleted_at IS NULL
);

CREATE POLICY "Active privileged users can read active tenant profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND deleted_at IS NULL
  AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
);

CREATE POLICY "Platform administrators can read active profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND public.is_platform_admin()
);

CREATE POLICY "Only platform administrators can create profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_platform_admin()
  AND user_id = auth.uid()
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
  AND EXISTS (
    SELECT 1
    FROM public.tenants AS tenant
    WHERE tenant.id = profiles.tenant_id
      AND tenant.status = 'active'
      AND tenant.deleted_at IS NULL
  )
);

CREATE POLICY "Active users can update their own mutable profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND user_id = auth.uid()
  AND deleted_at IS NULL
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
  AND deleted_at IS NULL
  AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
)
WITH CHECK (
  tenant_id = public.get_tenant_id()
  AND (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND role IN ('resident', 'supervisor', 'director', 'institution_admin')
    )
    OR (
      public.get_user_role() IN ('supervisor', 'director')
      AND role = 'resident'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
);

CREATE POLICY "Platform administrators can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
)
WITH CHECK (
  public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
);

CREATE POLICY "Tenant administrators can delete resident profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND role = 'resident'
  AND deleted_at IS NULL
  AND public.get_user_role() IN ('institution_admin', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
);

CREATE POLICY "Platform administrators can delete active profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  deleted_at IS NULL
  AND public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
  )
);

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
  config.api_key_enc IS NOT NULL AS has_api_key,
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
  config.secret_key_enc IS NOT NULL AS has_secret_key,
  config.webhook_secret_enc IS NOT NULL AS has_webhook_secret,
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
  webhook.secret_enc IS NOT NULL AS has_secret,
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

DO $$
DECLARE
  function_record RECORD;
BEGIN
  FOR function_record IN
    SELECT function_entry.oid::regprocedure AS signature
    FROM pg_proc AS function_entry
    JOIN pg_namespace AS schema_entry
      ON schema_entry.oid = function_entry.pronamespace
    WHERE schema_entry.nspname = 'public'
      AND function_entry.prosecdef
      AND function_entry.prokind = 'f'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      function_record.signature
    );
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', function_record.signature);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', function_record.signature);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM service_role', function_record.signature);
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.decrypt_with_version(bytea, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_data_retention() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_tenant_webhook_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_event_failed(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_site_page(uuid, uuid, uuid, boolean, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_benchmark_mv() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_encryption_key(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_mrn_salt(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_tenant_webhook_secrets(jsonb) TO service_role;
