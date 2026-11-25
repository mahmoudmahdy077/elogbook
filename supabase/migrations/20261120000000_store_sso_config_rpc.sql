-- SEC2-001/002/003 (ULTIMATE_UPGRADE_PLAN Task 15): store_sso_config RPC
--
-- The web /api/[tenant]/admin/sso route previously wrote the OIDC client
-- secret straight into tenant_sso_configs.client_secret_encrypted as
-- PLAINTEXT (the column was encrypted in name only). This migration adds the
-- missing encryption RPC so the route can hand the plaintext secret to the
-- database and let it pgp_sym_encrypt() it, mirroring:
--   - 00053_encrypt_secrets.sql  (store_ai_config, store_payment_gateway_secret)
--   - 00074_tenant_webhooks_encrypt.sql (store_tenant_webhook)
--
-- Update semantics mirror store_tenant_webhook: every non-secret column is
-- overwritten with the passed value (pass the merged row from the route),
-- while the secret column is only rewritten when p_client_secret IS NOT NULL
-- so "rotate nothing" updates keep the stored ciphertext intact.
--
-- Also backfills any legacy plaintext secrets already sitting in the column:
-- pgp_sym_encrypt output cast to TEXT always begins with '\xc30d', so values
-- without that prefix are plaintext and get encrypted in place.

CREATE OR REPLACE FUNCTION public.store_sso_config(
  p_protocol TEXT,
  p_metadata_url TEXT,
  p_discovery_url TEXT,
  p_idp_entity_id TEXT,
  p_idp_certificate TEXT,
  p_client_id TEXT,
  p_client_secret TEXT,
  p_default_role TEXT,
  p_is_active BOOLEAN,
  p_config_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id UUID := get_tenant_id();
  v_key       TEXT;
  v_id        UUID;
BEGIN
  IF get_user_role() NOT IN ('institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_key := current_setting('app.encryption_key', true);

  IF p_config_id IS NULL THEN
    -- INSERT: encrypt the secret when the key is configured; otherwise fall
    -- back to storing it as-is (dev parity with store_tenant_webhook).
    IF v_key IS NOT NULL AND v_key <> '' AND p_client_secret IS NOT NULL THEN
      INSERT INTO public.tenant_sso_configs
        (tenant_id, protocol, metadata_url, discovery_url, idp_entity_id,
         idp_certificate, client_id, client_secret_encrypted, default_role, is_active)
      VALUES
        (v_tenant_id, p_protocol, p_metadata_url, p_discovery_url, p_idp_entity_id,
         p_idp_certificate, p_client_id, extensions.pgp_sym_encrypt(p_client_secret, v_key),
         p_default_role, p_is_active)
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.tenant_sso_configs
        (tenant_id, protocol, metadata_url, discovery_url, idp_entity_id,
         idp_certificate, client_id, client_secret_encrypted, default_role, is_active)
      VALUES
        (v_tenant_id, p_protocol, p_metadata_url, p_discovery_url, p_idp_entity_id,
         p_idp_certificate, p_client_id, p_client_secret, p_default_role, p_is_active)
      RETURNING id INTO v_id;
    END IF;
  ELSE
    -- UPDATE: overwrite the non-secret columns with the merged values the
    -- route passes; leave the stored secret untouched unless a new one came in.
    UPDATE public.tenant_sso_configs
       SET protocol = p_protocol,
           metadata_url = p_metadata_url,
           discovery_url = p_discovery_url,
           idp_entity_id = p_idp_entity_id,
           idp_certificate = p_idp_certificate,
           client_id = p_client_id,
           client_secret_encrypted = CASE
             WHEN p_client_secret IS NOT NULL AND v_key IS NOT NULL AND v_key <> ''
               THEN extensions.pgp_sym_encrypt(p_client_secret, v_key)
             WHEN p_client_secret IS NOT NULL
               THEN p_client_secret
             ELSE client_secret_encrypted
           END,
           default_role = p_default_role,
           is_active = p_is_active,
           updated_at = now()
     WHERE id = p_config_id
       AND tenant_id = v_tenant_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'SSO config not found or access denied');
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'tenant_id', v_tenant_id, 'success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.store_sso_config FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_sso_config TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: encrypt legacy plaintext secrets written before this RPC existed.
-- pgp_sym_encrypt(...)::text always starts with '\xc30d' — anything else in
-- the column is plaintext and gets encrypted in place. Skipped entirely when
-- the encryption key is not configured (nothing to encrypt with).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NOT NULL AND v_key <> '' THEN
    UPDATE public.tenant_sso_configs
       SET client_secret_encrypted = extensions.pgp_sym_encrypt(client_secret_encrypted, v_key)
     WHERE client_secret_encrypted IS NOT NULL
       AND client_secret_encrypted NOT LIKE '\xc30d%';
  END IF;
END $$;
