-- Fix handle_new_user to include mrn_hash_salt when creating tenants
-- Also fix rotate_encryption_key audit INSERT to provide tenant_id (NOT NULL column)

CREATE OR REPLACE FUNCTION public.rotate_encryption_key(p_old_version INT, p_new_version INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_key TEXT;
  v_new_key TEXT;
  v_ai_count INT := 0;
  v_pg_count INT := 0;
BEGIN
  IF p_old_version IS NULL OR p_new_version IS NULL OR p_old_version = p_new_version THEN
    RETURN jsonb_build_object('error', 'old_version and new_version must differ');
  END IF;

  v_old_key := current_setting(format('app.encryption_key_v%s', p_old_version), true);
  IF v_old_key IS NULL OR v_old_key = '' THEN
    IF p_old_version = 1 THEN
      v_old_key := current_setting('app.encryption_key', true);
    END IF;
  END IF;
  v_new_key := current_setting(format('app.encryption_key_v%s', p_new_version), true);
  IF v_new_key IS NULL OR v_new_key = '' THEN
    RETURN jsonb_build_object('error', format('new encryption key v%s not configured', p_new_version));
  END IF;
  IF v_old_key IS NULL OR v_old_key = '' THEN
    RETURN jsonb_build_object('error', format('old encryption key v%s not configured', p_old_version));
  END IF;

  WITH upd AS (
    UPDATE public.ai_config
        SET api_key_enc = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(api_key_enc, v_old_key), v_new_key),
           key_version = p_new_version,
           updated_at = now()
     WHERE key_version = p_old_version
       AND api_key_enc IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_ai_count FROM upd;

  WITH upd AS (
    UPDATE public.payment_gateway_config
       SET secret_key_enc    = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(secret_key_enc,    v_old_key), v_new_key),
            webhook_secret_enc = extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(webhook_secret_enc, v_old_key), v_new_key),
           key_version       = p_new_version,
           updated_at        = now()
     WHERE key_version = p_old_version
       AND (secret_key_enc IS NOT NULL OR webhook_secret_enc IS NOT NULL)
    RETURNING id
  )
  SELECT count(*) INTO v_pg_count FROM upd;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  SELECT
    COALESCE(tenants.id, '00000000-0000-0000-0000-000000000000'::uuid),
    NULLIF(current_setting('app.user_id', true), '')::UUID,
    'key_rotation',
    'encryption_keys',
    '00000000-0000-0000-0000-000000000000'::uuid,
    jsonb_build_object(
      'old_version', p_old_version,
      'new_version', p_new_version,
      'ai_config_rotated', v_ai_count,
      'payment_gateway_config_rotated', v_pg_count
    )
  FROM (SELECT id FROM public.tenants LIMIT 1) tenants
  WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='audit_logs');

  RETURN jsonb_build_object(
    'success', true,
    'old_version', p_old_version,
    'new_version', p_new_version,
    'ai_config_rotated', v_ai_count,
    'payment_gateway_config_rotated', v_pg_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  IF role_text NOT IN ('resident', 'supervisor') THEN
    role_text := 'resident';
  END IF;

  INSERT INTO tenants (name, slug, tenant_type, mrn_hash_salt)
  VALUES (NEW.email, 'user-' || NEW.id, 'individual', encode(extensions.gen_random_bytes(32), 'hex'))
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
