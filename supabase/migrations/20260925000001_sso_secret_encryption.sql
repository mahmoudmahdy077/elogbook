DO $$
BEGIN
  IF to_regclass('public.tenant_sso_configs') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'client_secret_enc'
  ) THEN
    ALTER TABLE public.tenant_sso_configs ADD COLUMN client_secret_enc BYTEA;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'idp_certificate_enc'
  ) THEN
    ALTER TABLE public.tenant_sso_configs ADD COLUMN idp_certificate_enc BYTEA;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'secret_key_version'
  ) THEN
    ALTER TABLE public.tenant_sso_configs ADD COLUMN secret_key_version INT NOT NULL DEFAULT 1;
  END IF;
END;
$$;

DO $$
DECLARE
  v_key TEXT;
  v_has_plain_client_secret BOOLEAN := FALSE;
  v_has_plain_certificate BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.tenant_sso_configs') IS NULL THEN
    RETURN;
  END IF;
  v_key := COALESCE(
    NULLIF(current_setting('app.encryption_key_v1', true), ''),
    NULLIF(current_setting('app.encryption_key', true), '')
  );
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'client_secret_encrypted'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.tenant_sso_configs WHERE NULLIF(client_secret_encrypted, '''' ) IS NOT NULL)' INTO v_has_plain_client_secret;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'idp_certificate'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.tenant_sso_configs WHERE NULLIF(idp_certificate, '''' ) IS NOT NULL)' INTO v_has_plain_certificate;
  END IF;
  IF (v_has_plain_client_secret OR v_has_plain_certificate) AND (v_key IS NULL OR v_key = '') THEN
    RAISE EXCEPTION 'SSO secret migration requires app.encryption_key or app.encryption_key_v1';
  END IF;
  IF v_key IS NOT NULL AND v_key <> '' THEN
    IF v_has_plain_client_secret THEN
      EXECUTE 'UPDATE public.tenant_sso_configs SET client_secret_enc = extensions.pgp_sym_encrypt(client_secret_encrypted, $1) WHERE client_secret_enc IS NULL' USING v_key;
    END IF;
    IF v_has_plain_certificate THEN
      EXECUTE 'UPDATE public.tenant_sso_configs SET idp_certificate_enc = extensions.pgp_sym_encrypt(idp_certificate, $1) WHERE idp_certificate_enc IS NULL' USING v_key;
    END IF;
  END IF;
  IF v_has_plain_client_secret AND EXISTS (SELECT 1 FROM public.tenant_sso_configs WHERE client_secret_encrypted IS NOT NULL AND client_secret_enc IS NULL) THEN
    RAISE EXCEPTION 'SSO client secret encryption backfill incomplete';
  END IF;
  IF v_has_plain_certificate AND EXISTS (SELECT 1 FROM public.tenant_sso_configs WHERE idp_certificate IS NOT NULL AND idp_certificate_enc IS NULL) THEN
    RAISE EXCEPTION 'SSO certificate encryption backfill incomplete';
  END IF;
END;
$$;

ALTER TABLE public.tenant_sso_configs DROP COLUMN IF EXISTS client_secret_encrypted;
ALTER TABLE public.tenant_sso_configs DROP COLUMN IF EXISTS idp_certificate;

CREATE OR REPLACE VIEW public.tenant_sso_configs_safe AS
SELECT
  config.id,
  config.tenant_id,
  config.protocol,
  config.metadata_url,
  config.discovery_url,
  config.idp_entity_id,
  config.client_id,
  config.default_role,
  config.is_active,
  config.client_secret_enc IS NOT NULL AS has_client_secret,
  config.idp_certificate_enc IS NOT NULL AS has_idp_certificate,
  config.created_at,
  config.updated_at
FROM public.tenant_sso_configs AS config
WHERE auth.role() = 'service_role'
   OR (
     config.tenant_id = public.get_tenant_id()
     AND public.get_user_role() IN ('director', 'institution_admin', 'admin')
   );

ALTER VIEW public.tenant_sso_configs_safe SET (security_barrier = true);
REVOKE ALL ON public.tenant_sso_configs_safe FROM PUBLIC, anon;
GRANT SELECT ON public.tenant_sso_configs_safe TO authenticated, service_role;
REVOKE ALL ON TABLE public.tenant_sso_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_sso_configs TO service_role;

CREATE OR REPLACE FUNCTION public.store_tenant_sso_config(
  p_tenant_id UUID,
  p_config_id UUID DEFAULT NULL,
  p_protocol TEXT DEFAULT NULL,
  p_metadata_url TEXT DEFAULT NULL,
  p_discovery_url TEXT DEFAULT NULL,
  p_idp_entity_id TEXT DEFAULT NULL,
  p_idp_certificate TEXT DEFAULT NULL,
  p_client_id TEXT DEFAULT NULL,
  p_client_secret TEXT DEFAULT NULL,
  p_default_role TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_id UUID;
  v_existing public.tenant_sso_configs%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = p_tenant_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant_not_found');
  END IF;
  IF p_protocol IS NOT NULL AND p_protocol NOT IN ('saml', 'oidc') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_protocol');
  END IF;
  IF p_default_role IS NOT NULL AND p_default_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_role');
  END IF;
  IF p_client_secret IS NOT NULL AND char_length(p_client_secret) NOT BETWEEN 1 AND 4096 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_secret');
  END IF;
  IF p_idp_certificate IS NOT NULL AND char_length(p_idp_certificate) NOT BETWEEN 1 AND 100000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_certificate');
  END IF;
  v_key := COALESCE(
    NULLIF(current_setting('app.encryption_key_v1', true), ''),
    NULLIF(current_setting('app.encryption_key', true), '')
  );
  IF (p_client_secret IS NOT NULL OR p_idp_certificate IS NOT NULL) AND (v_key IS NULL OR v_key = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  IF p_config_id IS NULL THEN
    IF p_protocol IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'protocol_required');
    END IF;
    INSERT INTO public.tenant_sso_configs (
      tenant_id, protocol, metadata_url, discovery_url, idp_entity_id,
      client_secret_enc, idp_certificate_enc, client_id, default_role,
      is_active, secret_key_version
    )
    VALUES (
      p_tenant_id, p_protocol, p_metadata_url, p_discovery_url, p_idp_entity_id,
      CASE WHEN p_client_secret IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(p_client_secret, v_key) END,
      CASE WHEN p_idp_certificate IS NULL THEN NULL ELSE extensions.pgp_sym_encrypt(p_idp_certificate, v_key) END,
      p_client_id, COALESCE(p_default_role, 'resident'), COALESCE(p_is_active, true), 1
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_existing
    FROM public.tenant_sso_configs
    WHERE id = p_config_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'not_found');
    END IF;
    UPDATE public.tenant_sso_configs
    SET protocol = COALESCE(p_protocol, protocol),
        metadata_url = CASE WHEN p_metadata_url IS NULL THEN metadata_url ELSE p_metadata_url END,
        discovery_url = CASE WHEN p_discovery_url IS NULL THEN discovery_url ELSE p_discovery_url END,
        idp_entity_id = CASE WHEN p_idp_entity_id IS NULL THEN idp_entity_id ELSE p_idp_entity_id END,
        client_id = CASE WHEN p_client_id IS NULL THEN client_id ELSE p_client_id END,
        client_secret_enc = CASE WHEN p_client_secret IS NULL THEN client_secret_enc ELSE extensions.pgp_sym_encrypt(p_client_secret, v_key) END,
        idp_certificate_enc = CASE WHEN p_idp_certificate IS NULL THEN idp_certificate_enc ELSE extensions.pgp_sym_encrypt(p_idp_certificate, v_key) END,
        default_role = COALESCE(p_default_role, default_role),
        is_active = COALESCE(p_is_active, is_active),
        secret_key_version = CASE WHEN p_client_secret IS NOT NULL OR p_idp_certificate IS NOT NULL THEN 1 ELSE secret_key_version END,
        updated_at = now()
    WHERE id = p_config_id AND tenant_id = p_tenant_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'tenant_id', p_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.store_tenant_sso_config(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_tenant_sso_config(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;
