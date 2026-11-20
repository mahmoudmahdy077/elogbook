-- ============================================================================
-- 20261120000100_fix_sso_config_encrypt.sql
--
-- Fixes two defects in 20261120000000_store_sso_config_rpc.sql:
--
-- 1. store_sso_config inserted/updated a BYTEA expression
--    (extensions.pgp_sym_encrypt) into tenant_sso_configs.client_secret_encrypted,
--    which is TEXT. There is no assignment cast from bytea to text (verified:
--    no pg_cast row for bytea -> text), so the INSERT/UPDATE raises 42804
--    ("column ... is of type text but expression is of type bytea") the moment
--    app.encryption_key is configured — every SSO create/update with a client
--    secret returns 500. Cast the ciphertext to TEXT explicitly.
--
-- 2. The legacy-plaintext backfill filtered with
--    `client_secret_encrypted NOT LIKE '\xc30d%'`. In LIKE, backslash is the
--    default escape character, so that pattern means `xc30d%`, not `\xc30d%`:
--    real ciphertext (its bytea-to-text form starts with the literal characters
--    `\xc30d`) does NOT match it, so the filter re-encrypted values that were
--    already encrypted (double encryption = unreadable secret). Compare the
--    prefix with left() instead, where no escape processing happens.
--
-- No behaviour change otherwise: same role gate (institution_admin/admin), same
-- tenant from the JWT, same "secret untouched unless a new one is passed"
-- update semantics, same dev plaintext fallback when the key is unset.
-- ============================================================================

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
    IF v_key IS NOT NULL AND v_key <> '' AND p_client_secret IS NOT NULL THEN
      INSERT INTO public.tenant_sso_configs
        (tenant_id, protocol, metadata_url, discovery_url, idp_entity_id,
         idp_certificate, client_id, client_secret_encrypted, default_role, is_active)
      VALUES
        (v_tenant_id, p_protocol, p_metadata_url, p_discovery_url, p_idp_entity_id,
         p_idp_certificate, p_client_id,
         extensions.pgp_sym_encrypt(p_client_secret, v_key)::text,
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
    UPDATE public.tenant_sso_configs
       SET protocol = p_protocol,
           metadata_url = p_metadata_url,
           discovery_url = p_discovery_url,
           idp_entity_id = p_idp_entity_id,
           idp_certificate = p_idp_certificate,
           client_id = p_client_id,
           client_secret_encrypted = CASE
             WHEN p_client_secret IS NOT NULL AND v_key IS NOT NULL AND v_key <> ''
               THEN extensions.pgp_sym_encrypt(p_client_secret, v_key)::text
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
-- Backfill: encrypt legacy plaintext secrets, skip values already encrypted.
-- pgp_sym_encrypt(...)::text starts with the six literal characters `\xc30d`;
-- left(...) performs no LIKE escape processing, unlike the previous filter.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key TEXT;
BEGIN
  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NOT NULL AND v_key <> '' THEN
    UPDATE public.tenant_sso_configs
       SET client_secret_encrypted =
             extensions.pgp_sym_encrypt(client_secret_encrypted, v_key)::text
     WHERE client_secret_encrypted IS NOT NULL
       AND left(client_secret_encrypted, 6) <> '\xc30d';
  END IF;
END $$;
