ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_role TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_pending_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_pending_role_check
      CHECK (pending_role IS NULL OR pending_role IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_tenant_invite_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_platform_admin BOOLEAN;
BEGIN
  IF auth.role() = 'service_role'
     OR (
       session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
       AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
       AND auth.role() IS DISTINCT FROM 'service_role'
     ) THEN
    RETURN NEW;
  END IF;
  v_platform_admin := COALESCE(public.is_platform_admin(), FALSE);

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
       AND NEW.invited_by IS NOT DISTINCT FROM OLD.invited_by
       AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NOT v_platform_admin THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'tenant invite identity fields are immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT v_platform_admin AND NEW.tenant_id IS DISTINCT FROM public.get_tenant_id() THEN
    RAISE EXCEPTION 'cross-tenant invite creation rejected' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT v_platform_admin AND NEW.invited_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'invite actor must match authenticated user' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT v_platform_admin AND NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
      RAISE EXCEPTION 'invite actor is immutable' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.role IN ('institution_admin', 'admin') AND NOT v_platform_admin THEN
    RAISE EXCEPTION 'platform administrator role required for privileged invite' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tenant_invite_authority ON public.tenant_invites;
CREATE TRIGGER trg_protect_tenant_invite_authority
  BEFORE INSERT OR UPDATE ON public.tenant_invites
  FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_invite_authority();

REVOKE ALL ON FUNCTION public.protect_tenant_invite_authority() FROM PUBLIC, anon, authenticated;

UPDATE public.tenant_invites AS invite
SET status = 'expired'
WHERE invite.status = 'pending'
  AND invite.role IN ('institution_admin', 'admin')
  AND NOT EXISTS (
    SELECT 1
    FROM public.platform_admins AS platform_admin
    INNER JOIN public.profiles AS platform_profile
      ON platform_profile.user_id = platform_admin.user_id
    WHERE platform_admin.user_id = invite.invited_by
      AND platform_admin.status = 'active'
      AND platform_profile.status = 'active'
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
  v_profile_id UUID;
  v_requested_role TEXT;
  v_full_name TEXT;
  v_invite RECORD;
  v_status TEXT;
BEGIN
  v_requested_role := 'resident';
  v_full_name := COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''), NEW.email, 'Account');

  SELECT invite.*
  INTO v_invite
  FROM public.tenant_invites AS invite
  INNER JOIN public.tenants AS invite_tenant ON invite_tenant.id = invite.tenant_id
  WHERE LOWER(invite.email) = LOWER(NEW.email)
    AND invite.status = 'pending'
    AND invite_tenant.status = 'active'
  ORDER BY invite.created_at DESC
  LIMIT 1
  FOR UPDATE OF invite;

  IF FOUND THEN
    v_tenant_id := v_invite.tenant_id;
    v_requested_role := COALESCE(v_invite.role, 'resident');
    UPDATE public.tenant_invites
    SET status = 'accepted', accepted_at = NOW()
    WHERE id = v_invite.id;
  ELSE
    SELECT id INTO v_tenant_id
    FROM public.tenants
    WHERE slug = 'global-community'
      AND status = 'active'
    LIMIT 1;
    IF v_tenant_id IS NULL THEN
      INSERT INTO public.tenants (name, slug, tenant_type, mrn_hash_salt)
      VALUES (COALESCE(NEW.email, 'User'), 'user-' || NEW.id::TEXT, 'individual', encode(extensions.gen_random_bytes(32), 'hex'))
      RETURNING id INTO v_tenant_id;
    END IF;
  END IF;

  IF v_requested_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    v_requested_role := 'resident';
  END IF;

  v_status := CASE
    WHEN v_requested_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN 'pending'
    ELSE 'active'
  END;

  INSERT INTO public.profiles (
    tenant_id, user_id, role, status, pending_role, full_name, onboarding_completed
  )
  VALUES (
    v_tenant_id,
    NEW.id,
    'resident',
    v_status,
    CASE WHEN v_status = 'pending' THEN v_requested_role ELSE NULL END,
    v_full_name,
    false
  )
  RETURNING id INTO v_profile_id;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object(
    'tenant_id', v_tenant_id,
    'user_role', 'resident',
    'profile_id', v_profile_id
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.protect_pending_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'pending'
     AND OLD.role = 'resident'
     AND COALESCE(current_setting('app.pending_profile_promotion', true), '') <> 'true' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.pending_role IS DISTINCT FROM OLD.pending_role THEN
      RAISE EXCEPTION 'pending profile authorization fields are immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_profile_guard ON public.profiles;
CREATE TRIGGER trg_pending_profile_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_pending_profile();

CREATE OR REPLACE FUNCTION public.authorize_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor TEXT;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;

  IF COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
     AND auth.uid() = OLD.user_id
     AND OLD.role = 'resident'
     AND OLD.status = 'pending'
     AND NEW.role = OLD.pending_role
     AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_actor := public.get_user_role();
  IF v_actor NOT IN ('institution_admin', 'admin') THEN
    RAISE EXCEPTION 'Role changes require institution_admin or admin authorization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.role = 'admin' AND v_actor <> 'admin' THEN
    RAISE EXCEPTION 'Only admin may assign the admin role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.tenant_id <> public.get_tenant_id() THEN
    RAISE EXCEPTION 'Cross-tenant role change rejected'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

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
  IF COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
     AND NEW.user_id = auth.uid()
     AND OLD.user_id = auth.uid()
     AND OLD.role = 'resident'
     AND OLD.status = 'pending'
     AND NEW.role = OLD.pending_role
     AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_profiles_table
      AND attname = 'deleted_at'
      AND NOT attisdropped
  ) INTO v_profiles_deleted_at;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = v_tenants_table
      AND attname = 'deleted_at'
      AND NOT attisdropped
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
    OR (v_old -> 'pending_role') IS DISTINCT FROM (v_new -> 'pending_role')
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
      SELECT * INTO v_principal
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
          FROM (VALUES (v_old_tenant_id), (v_new_tenant_id)) AS candidate(tenant_id)
          WHERE candidate.tenant_id IS NOT NULL
          ORDER BY candidate.tenant_id
        LOOP
          EXECUTE 'SELECT id FROM public.tenants WHERE id = $1 FOR UPDATE'
          INTO v_locked_tenant_id USING v_lock_tenant_id;
          IF v_locked_tenant_id IS NULL THEN
            RAISE EXCEPTION 'tenant row required for last-administrator protection'
              USING ERRCODE = '42501';
          END IF;
        END LOOP;
      END IF;
      SELECT COUNT(*) INTO v_remaining_admins
      FROM public.profiles AS admin_profile
      WHERE admin_profile.tenant_id = v_old_tenant_id
        AND admin_profile.id <> (v_old ->> 'id')::UUID
        AND admin_profile.role IN ('admin', 'institution_admin')
        AND admin_profile.status = 'active'
        AND (NOT v_profiles_deleted_at OR to_jsonb(admin_profile) ->> 'deleted_at' IS NULL);
      IF v_remaining_admins = 0 THEN
        RAISE EXCEPTION 'the last active tenant administrator cannot be removed'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Pending users can read own profile" ON public.profiles;
CREATE POLICY "Pending users can read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident'
    AND public.profile_is_not_deleted(to_jsonb(profiles))
  );

DROP POLICY IF EXISTS "Pending users can update own profile" ON public.profiles;
CREATE POLICY "Pending users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident'
    AND public.profile_is_not_deleted(to_jsonb(profiles))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident'
    AND public.profile_is_not_deleted(to_jsonb(profiles))
  );

DROP POLICY IF EXISTS "Pending profile promotion" ON public.profiles;
CREATE POLICY "Pending profile promotion"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident'
    AND COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'active'
    AND role IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND COALESCE(current_setting('app.pending_profile_promotion', true), '') = 'true'
  );

DROP POLICY IF EXISTS "Pending users can read assigned tenant" ON public.tenants;
CREATE POLICY "Pending users can read assigned tenant"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS pending_profile
      WHERE pending_profile.user_id = auth.uid()
        AND pending_profile.tenant_id = tenants.id
        AND pending_profile.status = 'pending'
        AND pending_profile.role = 'resident'
    )
  );

CREATE OR REPLACE FUNCTION public.promote_pending_profile(p_profile_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'authenticated principal required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(public.has_aal2(), FALSE) = FALSE OR NOT EXISTS (
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = auth.uid() AND status = 'verified'
  ) THEN
    RAISE EXCEPTION 'AAL2 promotion requires a verified MFA factor' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, role, status, pending_role
  INTO v_profile
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident'
    AND (p_profile_id IS NULL OR id = p_profile_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'pending_profile_not_found');
  END IF;
  v_role := v_profile.pending_role;
  IF v_role IS NULL OR v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'pending_role_missing');
  END IF;

  PERFORM set_config('app.pending_profile_promotion', 'true', true);
  UPDATE public.profiles
  SET role = v_role,
      status = 'active',
      pending_role = NULL,
      updated_at = now()
  WHERE id = v_profile.id
    AND user_id = auth.uid()
    AND status = 'pending'
    AND role = 'resident';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending profile promotion failed' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object(
    'tenant_id', v_profile.tenant_id,
    'user_role', v_role,
    'profile_id', v_profile.id
  )
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'profile_id', v_profile.id,
    'tenant_id', v_profile.tenant_id,
    'role', v_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_pending_profile(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.promote_pending_profile(UUID) TO authenticated;
