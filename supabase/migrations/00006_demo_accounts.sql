-- Seed: Demo accounts for testing
-- Creates one institution tenant with users in all roles

DO $$
DECLARE
  v_institution_id UUID;
  v_supervisor_id UUID;
  v_director_id UUID;
  v_admin_id UUID;
  v_platform_id UUID;
  v_user_id UUID;
  v_auto_tenant_id UUID;
  v_emails TEXT[] := ARRAY['resident@demo.com', 'supervisor@demo.com', 'director@demo.com', 'admin@demo.com', 'platform@demo.com'];
  v_roles TEXT[] := ARRAY['resident', 'supervisor', 'director', 'institution_admin', 'admin'];
  v_names TEXT[] := ARRAY['Dr. Alex Resident', 'Dr. Sam Supervisor', 'Dr. Dana Director', 'Dr. Admin User', 'Platform Admin'];
  v_email TEXT;
  v_role TEXT;
  v_name TEXT;
  i INT;
BEGIN
  -- 1. Create the demo institution tenant
  INSERT INTO tenants (id, name, slug, tenant_type, settings)
  VALUES (
    gen_random_uuid(),
    'Demo Hospital',
    'demo',
    'institution',
    '{"demo": true}'::JSONB
  )
  ON CONFLICT (slug) DO UPDATE SET name = 'Demo Hospital', settings = '{"demo": true}'::JSONB
  RETURNING id INTO v_institution_id;

  -- 2. Create each user
  FOR i IN 1..array_length(v_emails, 1) LOOP
    v_email := v_emails[i];
    v_role := v_roles[i];
    v_name := v_names[i];

    -- Check if user already exists
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;

    IF v_user_id IS NULL THEN
      -- Create auth user with password
      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000'::UUID,
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        '$2b$10$.46DqzYX3n./W2aCv2m7d.2kRXI.foI5JCxVIkfJOSWIj5nadZIPW',
        now(),
        '{"provider":"email","providers":["email"]}'::JSONB,
        jsonb_build_object('role', v_role, 'full_name', v_name),
        now(),
        now(),
        '',
        '',
        '',
        ''
      )
      RETURNING id INTO v_user_id;

      -- Create identity record
      INSERT INTO auth.identities (
        provider_id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id,
        jsonb_build_object('sub', v_user_id::TEXT, 'email', v_email),
        'email',
        now(),
        now(),
        now()
      );
    ELSE
      -- User exists, update role and name
      UPDATE auth.users
      SET raw_user_meta_data = jsonb_build_object('role', v_role, 'full_name', v_name),
          encrypted_password = '$2b$10$.46DqzYX3n./W2aCv2m7d.2kRXI.foI5JCxVIkfJOSWIj5nadZIPW',
          email_confirmed_at = now()
      WHERE id = v_user_id;
    END IF;

    -- The handle_new_user trigger has fired. Now clean up and link to institution tenant.
    -- Find and remove the auto-created profile for this user
    DELETE FROM profiles WHERE user_id = v_user_id;

    -- Find the auto-created individual tenant and remove it
    DELETE FROM tenants WHERE slug = 'user-' || v_user_id;

    -- Create profile linked to institution tenant
    INSERT INTO profiles (tenant_id, user_id, role, full_name)
    VALUES (v_institution_id, v_user_id, v_role, v_name);

    -- Update user's app_meta_data with institution tenant_id and role
    UPDATE auth.users
    SET raw_app_meta_data = jsonb_build_object(
      'provider', 'email',
      'providers', ARRAY['email']::TEXT[],
      'tenant_id', v_institution_id,
      'user_role', v_role
    )
    WHERE id = v_user_id;
  END LOOP;
END $$;
