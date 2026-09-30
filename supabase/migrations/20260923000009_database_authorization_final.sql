CREATE OR REPLACE FUNCTION public.profile_is_not_deleted(p_profile JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_profile IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_entry
        WHERE attribute_entry.attrelid = pg_catalog.to_regclass('public.profiles')
          AND attribute_entry.attname = 'deleted_at'
          AND NOT attribute_entry.attisdropped
      )
      OR p_profile ->> 'deleted_at' IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.tenant_is_not_deleted(p_tenant JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_tenant IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_entry
        WHERE attribute_entry.attrelid = pg_catalog.to_regclass('public.tenants')
          AND attribute_entry.attname = 'deleted_at'
          AND NOT attribute_entry.attisdropped
      )
      OR p_tenant ->> 'deleted_at' IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.profile_row_is_active(p_profile JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.profile_is_not_deleted(p_profile)
    AND p_profile ->> 'status' = 'active';
$$;

CREATE OR REPLACE FUNCTION public.tenant_row_is_active(p_tenant JSONB)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.tenant_is_not_deleted(p_tenant)
    AND p_tenant ->> 'status' = 'active';
$$;

CREATE OR REPLACE FUNCTION public.has_aal2()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'aal', ''),
    CASE
      WHEN COALESCE(auth.jwt() -> 'amr', '[]'::JSONB) @> '["mfa"]'::JSONB
        OR COALESCE(auth.jwt() -> 'amr', '[]'::JSONB) @> '["totp"]'::JSONB
      THEN 'aal2'
      ELSE ''
    END,
    ''
  ) = 'aal2';
$$;

REVOKE ALL ON FUNCTION public.profile_is_not_deleted(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_is_not_deleted(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.profile_row_is_active(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_row_is_active(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_is_not_deleted(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_is_not_deleted(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_row_is_active(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_row_is_active(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_aal2() TO authenticated, service_role;

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
    AND public.profile_is_not_deleted(to_jsonb(profile))
    AND public.tenant_is_not_deleted(to_jsonb(tenant))
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
      AND public.profile_is_not_deleted(to_jsonb(platform_profile))
      AND platform_tenant.status = 'active'
      AND public.tenant_is_not_deleted(to_jsonb(platform_tenant))
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
         AND public.profile_is_not_deleted(to_jsonb(resident_profile))
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
        AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
          AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
          AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
          AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
        AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
          AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
            AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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
            AND to_jsonb(entry) ->> 'deleted_at' IS NULL
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

REVOKE ALL ON FUNCTION public.get_case_stats(UUID, DATE, DATE) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_case_stats(UUID, DATE, DATE) TO authenticated;

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
    AND public.profile_is_not_deleted(to_jsonb(target_profile))
    AND target_tenant.status = 'active'
    AND public.tenant_is_not_deleted(to_jsonb(target_tenant));

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

REVOKE ALL ON FUNCTION public.release_ai_quota(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(UUID, INTEGER) TO service_role;

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
  v_profiles_table REGCLASS := pg_catalog.to_regclass('public.profiles');
  v_tenants_table REGCLASS := pg_catalog.to_regclass('public.tenants');
  v_profiles_deleted_at BOOLEAN := FALSE;
  v_tenants_deleted_at BOOLEAN := FALSE;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_trusted_database_context BOOLEAN;
  v_has_aal2 BOOLEAN := FALSE;
  v_old_tenant_id UUID := (v_old ->> 'tenant_id')::UUID;
  v_new_tenant_id UUID := (v_new ->> 'tenant_id')::UUID;
  v_new_is_same_active_admin BOOLEAN;
  v_lock_tenant_id UUID;
  v_locked_tenant_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_entry
    WHERE attribute_entry.attrelid = v_profiles_table
      AND attribute_entry.attname = 'deleted_at'
      AND NOT attribute_entry.attisdropped
  ) INTO v_profiles_deleted_at;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_entry
    WHERE attribute_entry.attrelid = v_tenants_table
      AND attribute_entry.attname = 'deleted_at'
      AND NOT attribute_entry.attisdropped
  ) INTO v_tenants_deleted_at;

  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';

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

  IF v_identity_changed OR v_authority_changed THEN
    IF v_trusted_database_context THEN
      v_actor_can_change := TRUE;
    ELSIF v_is_service_role THEN
      v_has_aal2 := public.has_aal2();
      IF NOT v_has_aal2 THEN
        RAISE EXCEPTION 'AAL2 is required for service-role profile authorization changes'
          USING ERRCODE = '42501';
      END IF;
      v_actor_can_change := TRUE;
    ELSE
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

      v_has_aal2 := v_principal.aal IS NOT DISTINCT FROM 'aal2';
      IF NOT v_has_aal2 THEN
        RAISE EXCEPTION 'AAL2 is required for profile authorization changes'
          USING ERRCODE = '42501';
      END IF;

      v_platform_admin := public.is_platform_admin();

      IF v_identity_changed AND NOT v_platform_admin THEN
        RAISE EXCEPTION 'profile identity columns are immutable'
          USING ERRCODE = '42501';
      END IF;

      v_actor_can_change := v_platform_admin OR (
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
  END IF;

  IF (v_old ->> 'role') IN ('admin', 'institution_admin')
     AND (v_old ->> 'status') = 'active'
     AND public.profile_is_not_deleted(v_old) THEN
    v_new_is_same_active_admin :=
      (v_new ->> 'role') IN ('admin', 'institution_admin')
      AND (v_new ->> 'status') = 'active'
      AND public.profile_is_not_deleted(v_new)
      AND (v_old -> 'id') IS NOT DISTINCT FROM (v_new -> 'id')
      AND (v_old -> 'user_id') IS NOT DISTINCT FROM (v_new -> 'user_id')
      AND (v_old -> 'tenant_id') IS NOT DISTINCT FROM (v_new -> 'tenant_id');

    IF NOT v_new_is_same_active_admin THEN
      IF v_tenants_table IS NOT NULL THEN
        FOR v_lock_tenant_id IN
          SELECT DISTINCT candidate.tenant_id
          FROM (
            VALUES (v_old_tenant_id), (v_new_tenant_id)
          ) AS candidate(tenant_id)
          WHERE candidate.tenant_id IS NOT NULL
          ORDER BY candidate.tenant_id
        LOOP
          EXECUTE 'SELECT id FROM public.tenants WHERE id = $1 FOR UPDATE'
          INTO v_locked_tenant_id
          USING v_lock_tenant_id;

          IF v_locked_tenant_id IS NULL THEN
            RAISE EXCEPTION 'tenant row required for last-administrator protection'
              USING ERRCODE = '42501';
          END IF;
        END LOOP;
      END IF;

      SELECT COUNT(*)
      INTO v_remaining_admins
      FROM public.profiles AS admin_profile
      WHERE admin_profile.tenant_id = v_old_tenant_id
        AND admin_profile.id <> (v_old ->> 'id')::UUID
        AND admin_profile.role IN ('admin', 'institution_admin')
        AND admin_profile.status = 'active'
        AND (
          NOT v_profiles_deleted_at
          OR to_jsonb(admin_profile) ->> 'deleted_at' IS NULL
        );

      IF v_remaining_admins = 0 THEN
        RAISE EXCEPTION 'the last active tenant administrator cannot be removed'
          USING ERRCODE = '42501';
      END IF;
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
  v_old JSONB := to_jsonb(OLD);
  v_principal RECORD;
  v_remaining_admins BIGINT;
  v_profiles_table REGCLASS := pg_catalog.to_regclass('public.profiles');
  v_tenants_table REGCLASS := pg_catalog.to_regclass('public.tenants');
  v_profiles_deleted_at BOOLEAN := FALSE;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_trusted_database_context BOOLEAN;
  v_old_tenant_id UUID := (v_old ->> 'tenant_id')::UUID;
  v_locked_tenant_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_entry
    WHERE attribute_entry.attrelid = v_profiles_table
      AND attribute_entry.attname = 'deleted_at'
      AND NOT attribute_entry.attisdropped
  ) INTO v_profiles_deleted_at;

  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';

  IF NOT v_trusted_database_context THEN
    IF v_is_service_role THEN
      IF NOT public.has_aal2() THEN
        RAISE EXCEPTION 'AAL2 is required for service-role profile deletion'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      SELECT *
      INTO v_principal
      FROM public.get_authoritative_principal_with_aal()
      LIMIT 1;

      IF NOT FOUND
         OR v_principal.profile_id IS NULL
         OR v_principal.tenant_id IS NULL
         OR v_principal.profile_status IS DISTINCT FROM 'active'
         OR v_principal.tenant_status IS DISTINCT FROM 'active'
         OR v_principal.aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'AAL2 active administrator context is required'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF (v_old ->> 'role') IN ('admin', 'institution_admin')
     AND (v_old ->> 'status') = 'active'
     AND public.profile_is_not_deleted(v_old) THEN
    IF v_tenants_table IS NOT NULL THEN
      EXECUTE 'SELECT id FROM public.tenants WHERE id = $1 FOR UPDATE'
      INTO v_locked_tenant_id
      USING v_old_tenant_id;

      IF v_locked_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant row required for last-administrator protection'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = v_old_tenant_id
      AND admin_profile.id <> (v_old ->> 'id')::UUID
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND (
        NOT v_profiles_deleted_at
        OR to_jsonb(admin_profile) ->> 'deleted_at' IS NULL
      );

    IF v_remaining_admins = 0 THEN
      RAISE EXCEPTION 'the last active tenant administrator cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_profile_authorization_guard ON public.profiles';
    EXECUTE 'DROP TRIGGER IF EXISTS aaa_profile_authorization_guard ON public.profiles';
    EXECUTE 'CREATE TRIGGER aaa_profile_authorization_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_authorization_columns()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_profile_admin_guard ON public.profiles';
    EXECUTE 'CREATE TRIGGER trg_profile_admin_guard BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_admin_deletion()';
    EXECUTE 'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY';
  END IF;
END
$$;

DO $$
DECLARE
  policy_record RECORD;
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.profiles', policy_record.policyname);
    END LOOP;
  END IF;
END
$$;

CREATE POLICY "Active users can read their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND user_id = auth.uid()
  AND public.profile_row_is_active(to_jsonb(profiles))
);

CREATE POLICY "Active privileged users can read active tenant profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND public.profile_row_is_active(to_jsonb(profiles))
  AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
);

CREATE POLICY "Platform administrators can read active profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.profile_is_not_deleted(to_jsonb(profiles))
  AND public.is_platform_admin()
);

CREATE POLICY "Only platform administrators can create profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_platform_admin()
  AND user_id = auth.uid()
  AND public.profile_row_is_active(to_jsonb(profiles))
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM public.tenants AS tenant
    WHERE tenant.id = profiles.tenant_id
      AND public.tenant_row_is_active(to_jsonb(tenant))
  )
);

CREATE POLICY "Active users can update their own mutable profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND user_id = auth.uid()
  AND public.profile_row_is_active(to_jsonb(profiles))
)
WITH CHECK (
  tenant_id = public.get_tenant_id()
  AND user_id = auth.uid()
  AND role = public.get_user_role()
  AND status = 'active'
  AND public.profile_is_not_deleted(to_jsonb(profiles))
  AND id = (
    SELECT principal.profile_id
    FROM public.get_authoritative_principal_with_aal() AS principal
    LIMIT 1
  )
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.profile_id = profiles.id
      AND principal.user_id = profiles.user_id
      AND principal.tenant_id = profiles.tenant_id
      AND principal.role = profiles.role
      AND principal.profile_status = profiles.status
      AND principal.tenant_status = 'active'
  )
);

CREATE POLICY "Tenant supervisors and administrators can update resident profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND role = 'resident'
  AND public.profile_row_is_active(to_jsonb(profiles))
  AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
)
WITH CHECK (
  tenant_id = public.get_tenant_id()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
  AND (
    (
      public.get_user_role() IN ('supervisor', 'director')
      AND role = 'resident'
    )
    OR (
      public.get_user_role() = 'institution_admin'
      AND role IN ('resident', 'supervisor', 'director', 'institution_admin')
    )
    OR (
      public.get_user_role() = 'admin'
      AND public.is_platform_admin()
      AND role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin')
    )
  )
);

CREATE POLICY "Platform administrators can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  (tenant_id = public.get_tenant_id() OR public.is_platform_admin())
  AND public.is_platform_admin()
  AND public.profile_is_not_deleted(to_jsonb(profiles))
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
)
WITH CHECK (
  (tenant_id = public.get_tenant_id() OR public.is_platform_admin())
  AND public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
);

CREATE POLICY "Tenant administrators can delete resident profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_tenant_id()
  AND role = 'resident'
  AND public.profile_is_not_deleted(to_jsonb(profiles))
  AND public.get_user_role() IN ('institution_admin', 'admin')
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
  )
);

CREATE POLICY "Platform administrators can delete active profiles"
ON public.profiles
FOR DELETE
TO authenticated
USING (
  public.profile_is_not_deleted(to_jsonb(profiles))
  AND public.is_platform_admin()
  AND EXISTS (
    SELECT 1
    FROM public.get_authoritative_principal_with_aal() AS principal
    WHERE principal.aal = 'aal2'
      AND principal.profile_status = 'active'
      AND principal.tenant_status = 'active'
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
  (
    to_jsonb(config) ? 'api_key_enc'
    AND to_jsonb(config) -> 'api_key_enc' IS DISTINCT FROM 'null'::JSONB
  ) AS has_api_key,
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
   )
   AND EXISTS (
     SELECT 1
     FROM public.tenants AS tenant
     WHERE tenant.id = config.tenant_id
       AND public.tenant_row_is_active(to_jsonb(tenant))
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
  (
    to_jsonb(config) ? 'secret_key_enc'
    AND to_jsonb(config) -> 'secret_key_enc' IS DISTINCT FROM 'null'::JSONB
  ) AS has_secret_key,
  (
    to_jsonb(config) ? 'webhook_secret_enc'
    AND to_jsonb(config) -> 'webhook_secret_enc' IS DISTINCT FROM 'null'::JSONB
  ) AS has_webhook_secret,
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
   )
   AND EXISTS (
     SELECT 1
     FROM public.tenants AS tenant
     WHERE tenant.id = config.tenant_id
       AND public.tenant_row_is_active(to_jsonb(tenant))
   );

CREATE VIEW public.secret_tenant_webhooks AS
SELECT
  webhook.id,
  webhook.tenant_id,
  webhook.url,
  webhook.events,
  webhook.description,
  webhook.is_active,
  (
    to_jsonb(webhook) ? 'secret_enc'
    AND to_jsonb(webhook) -> 'secret_enc' IS DISTINCT FROM 'null'::JSONB
  ) AS has_secret,
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
   )
   AND EXISTS (
     SELECT 1
     FROM public.tenants AS tenant
     WHERE tenant.id = webhook.tenant_id
       AND public.tenant_row_is_active(to_jsonb(tenant))
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
  table_name TEXT;
  column_name TEXT;
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

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);

    FOR column_name IN
      SELECT attribute_entry.attname
      FROM pg_catalog.pg_attribute AS attribute_entry
      WHERE attribute_entry.attrelid = to_regclass(format('public.%I', table_name))
        AND attribute_entry.attnum > 0
        AND NOT attribute_entry.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_name,
        column_name,
        column_name,
        column_name,
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

DO $$
DECLARE
  function_record RECORD;
  function_signature TEXT;
BEGIN
  FOR function_record IN
    SELECT function_entry.oid::REGPROCEDURE AS signature
    FROM pg_catalog.pg_proc AS function_entry
    INNER JOIN pg_catalog.pg_namespace AS schema_entry
      ON schema_entry.oid = function_entry.pronamespace
    WHERE schema_entry.nspname = 'public'
      AND function_entry.prosecdef
      AND function_entry.prokind = 'f'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      function_record.signature
    );
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, service_role',
      function_record.signature
    );
  END LOOP;

  FOREACH function_signature IN ARRAY ARRAY[
    'public.decrypt_with_version(bytea, integer)',
    'public.enforce_data_retention()',
    'public.get_tenant_webhook_secret(uuid)',
    'public.log_backup_run(text, bigint, text)',
    'public.mark_stripe_event_failed(text, text)',
    'public.publish_site_page(uuid, uuid, uuid, boolean, uuid, uuid)',
    'public.refresh_benchmark_mv()',
    'public.release_ai_quota(uuid, integer)',
    'public.rotate_encryption_key(integer, integer)',
    'public.rotate_mrn_salt(uuid)',
    'public.rotate_tenant_webhook_secrets(jsonb)'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_signature);
    END IF;
  END LOOP;
END
$$;
