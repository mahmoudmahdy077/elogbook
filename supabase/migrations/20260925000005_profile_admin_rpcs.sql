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
  v_trusted_database_context BOOLEAN;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_profiles_table REGCLASS := pg_catalog.to_regclass('public.profiles');
  v_profiles_deleted_at BOOLEAN := FALSE;
  v_old_tenant_id UUID := (v_old ->> 'tenant_id')::UUID;
  v_new_tenant_id UUID := (v_new ->> 'tenant_id')::UUID;
  v_old_role TEXT := v_old ->> 'role';
  v_new_role TEXT := v_new ->> 'role';
  v_old_status TEXT := v_old ->> 'status';
  v_new_status TEXT := v_new ->> 'status';
  v_old_deleted_at TIMESTAMPTZ;
  v_new_deleted_at TIMESTAMPTZ;
  v_identity_changed BOOLEAN;
  v_authority_changed BOOLEAN;
  v_actor_can_change BOOLEAN := FALSE;
  v_remaining_admins BIGINT;
  v_locked_tenant_id UUID;
BEGIN
  IF COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
     AND NEW.user_id = auth.uid()
     AND OLD.user_id = auth.uid()
     AND OLD.role = 'resident'
     AND OLD.status = 'pending'
     AND NEW.role = OLD.pending_role
     AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';
  IF v_trusted_database_context THEN
    RETURN NEW;
  END IF;

  IF v_is_service_role THEN
    RAISE EXCEPTION 'profile mutations require authenticated administrator RPC'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_profiles_table
      AND attname = 'deleted_at'
      AND NOT attisdropped
  ) INTO v_profiles_deleted_at;
  v_old_deleted_at := CASE
    WHEN v_profiles_deleted_at THEN (v_old ->> 'deleted_at')::TIMESTAMPTZ
    ELSE NULL
  END;
  v_new_deleted_at := CASE
    WHEN v_profiles_deleted_at THEN (v_new ->> 'deleted_at')::TIMESTAMPTZ
    ELSE NULL
  END;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'active AAL2 administrator context is required'
      USING ERRCODE = '42501';
  END IF;

  v_platform_admin := public.is_platform_admin();
  v_identity_changed :=
    (v_old -> 'id') IS DISTINCT FROM (v_new -> 'id')
    OR (v_old -> 'user_id') IS DISTINCT FROM (v_new -> 'user_id')
    OR (v_old -> 'tenant_id') IS DISTINCT FROM (v_new -> 'tenant_id')
    OR (v_old -> 'created_at') IS DISTINCT FROM (v_new -> 'created_at');
  v_authority_changed :=
    (v_old -> 'role') IS DISTINCT FROM (v_new -> 'role')
    OR (v_old -> 'status') IS DISTINCT FROM (v_new -> 'status')
    OR (v_old -> 'pending_role') IS DISTINCT FROM (v_new -> 'pending_role')
    OR (v_old -> 'invited_by') IS DISTINCT FROM (v_new -> 'invited_by')
    OR (v_old -> 'deactivated_at') IS DISTINCT FROM (v_new -> 'deactivated_at')
    OR (v_old -> 'last_login_at') IS DISTINCT FROM (v_new -> 'last_login_at')
    OR (v_profiles_deleted_at AND (v_old -> 'deleted_at') IS DISTINCT FROM (v_new -> 'deleted_at'));

  IF v_identity_changed AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'profile identity columns are immutable'
      USING ERRCODE = '42501';
  END IF;
  IF v_old_tenant_id IS DISTINCT FROM v_principal.tenant_id AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'cross-tenant profile mutation rejected'
      USING ERRCODE = '42501';
  END IF;
  IF v_authority_changed THEN
    v_actor_can_change := v_platform_admin OR (
      v_principal.tenant_id = v_old_tenant_id
      AND v_principal.role = 'institution_admin'
      AND v_old_role <> 'admin'
      AND v_new_role <> 'admin'
    );
    IF NOT v_actor_can_change THEN
      RAISE EXCEPTION 'profile authorization changes require administrator authorization'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_old_role IN ('admin', 'institution_admin')
     AND v_old_status = 'active'
     AND v_old_deleted_at IS NULL
     AND (
       v_new_role NOT IN ('admin', 'institution_admin')
       OR v_new_status IS DISTINCT FROM 'active'
       OR v_new_deleted_at IS NOT NULL
     ) THEN
    SELECT id INTO v_locked_tenant_id
    FROM public.tenants
    WHERE id = v_old_tenant_id
    FOR UPDATE;
    IF v_locked_tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant scope is required for administrator protection'
        USING ERRCODE = '42501';
    END IF;

    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = v_old_tenant_id
      AND admin_profile.id <> OLD.id
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
  v_principal RECORD;
  v_platform_admin BOOLEAN := FALSE;
  v_trusted_database_context BOOLEAN;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_profiles_table REGCLASS := pg_catalog.to_regclass('public.profiles');
  v_profiles_deleted_at BOOLEAN := FALSE;
  v_old_tenant_id UUID := (to_jsonb(OLD) ->> 'tenant_id')::UUID;
  v_old_deleted_at TIMESTAMPTZ;
  v_remaining_admins BIGINT;
  v_locked_tenant_id UUID;
BEGIN
  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';
  IF v_trusted_database_context THEN
    RETURN OLD;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = v_profiles_table
      AND attname = 'deleted_at'
      AND NOT attisdropped
  ) INTO v_profiles_deleted_at;
  v_old_deleted_at := CASE
    WHEN v_profiles_deleted_at THEN (to_jsonb(OLD) ->> 'deleted_at')::TIMESTAMPTZ
    ELSE NULL
  END;
  IF v_old_deleted_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  IF v_is_service_role THEN
    RAISE EXCEPTION 'profile deletion requires authenticated administrator RPC'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR v_principal.role NOT IN ('institution_admin', 'admin') THEN
    RAISE EXCEPTION 'active AAL2 administrator context is required'
      USING ERRCODE = '42501';
  END IF;
  v_platform_admin := public.is_platform_admin();
  IF v_principal.role = 'admin' AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'platform administrator authorization is required'
      USING ERRCODE = '42501';
  END IF;
  IF v_principal.tenant_id IS DISTINCT FROM v_old_tenant_id AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'cross-tenant profile deletion rejected'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.role IN ('admin', 'institution_admin') THEN
    SELECT id INTO v_locked_tenant_id
    FROM public.tenants
    WHERE id = v_old_tenant_id
    FOR UPDATE;
    IF v_locked_tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant scope is required for administrator protection'
        USING ERRCODE = '42501';
    END IF;
    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = v_old_tenant_id
      AND admin_profile.id <> OLD.id
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

CREATE OR REPLACE FUNCTION public.authorize_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_platform_admin BOOLEAN := FALSE;
  v_trusted_database_context BOOLEAN;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
     AND auth.uid() = OLD.user_id
     AND OLD.role = 'resident'
     AND OLD.status = 'pending'
     AND NEW.role = OLD.pending_role
     AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;
  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';
  IF v_trusted_database_context THEN
    RETURN NEW;
  END IF;
  IF auth.role() = 'service_role' THEN
    RAISE EXCEPTION 'role changes require authenticated administrator RPC'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR v_principal.role NOT IN ('institution_admin', 'admin') THEN
    RAISE EXCEPTION 'active AAL2 administrator context is required'
      USING ERRCODE = '42501';
  END IF;
  v_platform_admin := public.is_platform_admin();
  IF v_principal.role = 'admin' AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'platform administrator authorization is required'
      USING ERRCODE = '42501';
  END IF;
  IF v_principal.tenant_id IS DISTINCT FROM OLD.tenant_id AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'cross-tenant role change rejected'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.role = 'admin' AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'only platform administrators may assign the admin role'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_authorization_guard ON public.profiles;
DROP TRIGGER IF EXISTS aaa_profile_authorization_guard ON public.profiles;
CREATE TRIGGER aaa_profile_authorization_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_authorization_columns();

DROP TRIGGER IF EXISTS trg_profile_admin_guard ON public.profiles;
CREATE TRIGGER trg_profile_admin_guard
BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_admin_deletion();

DROP TRIGGER IF EXISTS trg_authorize_role_change ON public.profiles;
CREATE TRIGGER trg_authorize_role_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.authorize_role_change();

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_profile_id UUID,
  p_updates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_target RECORD;
  v_target_tenant_id UUID;
  v_tenant_status TEXT;
  v_tenant_deleted_at TIMESTAMPTZ;
  v_platform_admin BOOLEAN := FALSE;
  v_has_full_name BOOLEAN := FALSE;
  v_has_specialty BOOLEAN := FALSE;
  v_has_role BOOLEAN := FALSE;
  v_has_status BOOLEAN := FALSE;
  v_full_name TEXT;
  v_specialty TEXT;
  v_role TEXT;
  v_status TEXT;
  v_new_role TEXT;
  v_new_status TEXT;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_remaining_admins BIGINT;
  v_locked_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF p_profile_id IS NULL
     OR p_updates IS NULL
     OR jsonb_typeof(p_updates) <> 'object'
     OR p_updates = '{}'::JSONB THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_updates) AS keys(key)
    WHERE keys.key NOT IN ('full_name', 'specialty', 'role', 'status')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS DISTINCT FROM 'aal2' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  v_platform_admin := public.is_platform_admin();
  IF v_principal.role NOT IN ('institution_admin', 'admin')
     OR (v_principal.role = 'admin' AND NOT v_platform_admin) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT tenant_id
  INTO v_target_tenant_id
  FROM public.profiles
  WHERE id = p_profile_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  SELECT status, deleted_at
  INTO v_tenant_status, v_tenant_deleted_at
  FROM public.tenants
  WHERE id = v_target_tenant_id
  FOR UPDATE;
  IF v_tenant_status IS DISTINCT FROM 'active' OR v_tenant_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant_inactive');
  END IF;
  IF v_target_tenant_id IS DISTINCT FROM v_principal.tenant_id AND NOT v_platform_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_profile_id
    AND tenant_id = v_target_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;
  IF v_target.role = 'admin' AND NOT v_platform_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_has_full_name := p_updates ? 'full_name';
  v_has_specialty := p_updates ? 'specialty';
  v_has_role := p_updates ? 'role';
  v_has_status := p_updates ? 'status';
  IF v_has_full_name THEN
    v_full_name := BTRIM(p_updates ->> 'full_name');
    IF v_full_name IS NULL OR char_length(v_full_name) NOT BETWEEN 1 AND 120 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    v_changed_fields := array_append(v_changed_fields, 'full_name');
  END IF;
  IF v_has_specialty THEN
    IF p_updates -> 'specialty' IS DISTINCT FROM 'null'::JSONB THEN
      v_specialty := NULLIF(BTRIM(p_updates ->> 'specialty'), '');
      IF char_length(v_specialty) > 120 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
      END IF;
    END IF;
    v_changed_fields := array_append(v_changed_fields, 'specialty');
  END IF;
  IF v_has_role THEN
    v_role := p_updates ->> 'role';
    IF v_role IS NULL OR v_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    IF v_role = 'admin' AND NOT v_platform_admin THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden');
    END IF;
    IF v_target.status = 'pending' THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden');
    END IF;
    v_changed_fields := array_append(v_changed_fields, 'role');
  END IF;
  IF v_has_status THEN
    v_status := p_updates ->> 'status';
    IF v_status IS NULL OR v_status NOT IN ('active', 'pending', 'suspended', 'deactivated') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    IF v_status = 'pending' AND (
      v_has_role
      OR v_target.role <> 'resident'
      OR v_target.pending_role IS NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden');
    END IF;
    v_changed_fields := array_append(v_changed_fields, 'status');
  END IF;

  v_new_role := CASE WHEN v_has_role THEN v_role ELSE v_target.role END;
  v_new_status := CASE WHEN v_has_status THEN v_status ELSE v_target.status END;
  IF v_target.role IN ('admin', 'institution_admin')
     AND v_target.status = 'active'
     AND v_target.deleted_at IS NULL
     AND (
       v_new_role NOT IN ('admin', 'institution_admin')
       OR v_new_status IS DISTINCT FROM 'active'
     ) THEN
    SELECT id INTO v_locked_tenant_id
    FROM public.tenants
    WHERE id = v_target.tenant_id
    FOR UPDATE;
    IF v_locked_tenant_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'tenant_inactive');
    END IF;
    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = v_target.tenant_id
      AND admin_profile.id <> v_target.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL;
    IF v_remaining_admins = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'last_administrator');
    END IF;
  END IF;

  UPDATE public.profiles
  SET full_name = CASE WHEN v_has_full_name THEN v_full_name ELSE full_name END,
      specialty = CASE WHEN v_has_specialty THEN v_specialty ELSE specialty END,
      role = CASE WHEN v_has_role THEN v_role ELSE role END,
      status = CASE WHEN v_has_status THEN v_status ELSE status END,
      deactivated_at = CASE
        WHEN v_has_status AND v_status = 'active' THEN NULL
        WHEN v_has_status AND v_status IN ('suspended', 'deactivated') THEN COALESCE(deactivated_at, now())
        ELSE deactivated_at
      END,
      updated_at = now()
  WHERE id = p_profile_id
    AND tenant_id = v_target.tenant_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  IF v_has_role THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object(
      'tenant_id', v_target.tenant_id,
      'user_role', v_role,
      'profile_id', v_target.id
    )
    WHERE id = v_target.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'identity synchronization failed' USING ERRCODE = '42501';
    END IF;
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
    v_target.tenant_id,
    v_principal.user_id,
    'update_user',
    'profiles',
    v_target.id,
    jsonb_build_object('changed_fields', to_jsonb(v_changed_fields))
  );

  RETURN jsonb_build_object('success', true, 'profile_id', v_target.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_role(
  p_profile_id UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.admin_update_profile(
    p_profile_id,
    jsonb_build_object('role', p_role)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_profile_status(
  p_profile_id UUID,
  p_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN public.admin_update_profile(
    p_profile_id,
    jsonb_build_object('status', p_status)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_profile(
  p_profile_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_target RECORD;
  v_target_tenant_id UUID;
  v_tenant_status TEXT;
  v_tenant_deleted_at TIMESTAMPTZ;
  v_platform_admin BOOLEAN := FALSE;
  v_remaining_admins BIGINT;
  v_locked_tenant_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS DISTINCT FROM 'aal2'
     OR v_principal.role NOT IN ('institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  v_platform_admin := public.is_platform_admin();
  IF v_principal.role = 'admin' AND NOT v_platform_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT tenant_id
  INTO v_target_tenant_id
  FROM public.profiles
  WHERE id = p_profile_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;
  IF v_target_tenant_id IS DISTINCT FROM v_principal.tenant_id AND NOT v_platform_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT status, deleted_at
  INTO v_tenant_status, v_tenant_deleted_at
  FROM public.tenants
  WHERE id = v_target_tenant_id
  FOR UPDATE;
  IF v_tenant_status IS DISTINCT FROM 'active' OR v_tenant_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant_inactive');
  END IF;

  SELECT *
  INTO v_target
  FROM public.profiles
  WHERE id = p_profile_id
    AND tenant_id = v_target_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;
  IF v_target.user_id = auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_delete_forbidden');
  END IF;
  IF v_target.role = 'admin' AND NOT v_platform_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF v_target.role IN ('admin', 'institution_admin')
     AND v_target.status = 'active' THEN
    SELECT COUNT(*)
    INTO v_remaining_admins
    FROM public.profiles AS admin_profile
    WHERE admin_profile.tenant_id = v_target.tenant_id
      AND admin_profile.id <> v_target.id
      AND admin_profile.role IN ('admin', 'institution_admin')
      AND admin_profile.status = 'active'
      AND admin_profile.deleted_at IS NULL;
    IF v_remaining_admins = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'last_administrator');
    END IF;
  END IF;

  DELETE FROM public.profiles
  WHERE id = p_profile_id
    AND tenant_id = v_target_tenant_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
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
    v_target.tenant_id,
    v_principal.user_id,
    'delete_user',
    'profiles',
    v_target.id,
    jsonb_build_object('changed_fields', jsonb_build_array('deleted'))
  );

  RETURN jsonb_build_object('success', true, 'profile_id', v_target.id);
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_authorization_columns() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_profile_admin_deletion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.authorize_role_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_update_profile(UUID, JSONB) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_assign_role(UUID, TEXT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_set_profile_status(UUID, TEXT) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_profile(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_profile(UUID) TO authenticated;
