-- ============================================================================
-- 00062_key_rotation.sql
--
-- Phase 7 / P7.7 — versioned encryption keys + rotation RPC +
--                    per-tenant MRN-salt rotation.
--
-- The `key_version` column was added to ai_config and
-- payment_gateway_config in 00053 (P2.1). This migration:
--
--   1. Adds `salt_version` to `tenants` for MRN-salt rotation tracking.
--   2. Creates a `decrypt_with_version(bytea, int)` helper that picks
--      the right key from GUCs `app.encryption_key_v1`,
--      `app.encryption_key_v2`, etc. — with a backward-compat fallback
--      to the legacy `app.encryption_key` for v1.
--   3. Creates `rotate_encryption_key(old, new)` that decrypts every
--      ai_config.api_key_enc and every
--      payment_gateway_config.{secret_key_enc, webhook_secret_enc}
--      from the old key, re-encrypts with the new key, and bumps
--      `key_version`. service_role only.
--   4. Creates `rotate_mrn_salt(tenant_id)` that generates a new
--      per-tenant salt, bumps `salt_version`, and (deliberately) does
--      NOT try to re-hash stored patient_hash values — the application
--      must re-hash on next access. This is the safer semantic: a
--      silent bulk re-hash could miss recently-inserted rows.
--   5. Re-creates the `secret_ai_config` and
--      `secret_payment_gateway_config` views to use
--      `decrypt_with_version` so the views still work during a
--      versioned rotation (rows at v2 decrypt with v2, rows at v1
--      still decrypt with the legacy GUC).
--
-- Idempotent: every step is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenants.salt_version
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tenants' AND column_name='salt_version'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN salt_version INT NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. decrypt_with_version — picks the right key GUC for a given version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrypt_with_version(
  p_encrypted BYTEA,
  p_version INT
) RETURNS TEXT
LANGUAGE plpgsql
-- Not IMMUTABLE: current_setting() is session-local and depends on the
-- configured GUCs. STABLE is the right category (same input + same
-- session = same output).
STABLE
AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF p_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  v_key := current_setting(format('app.encryption_key_v%s', p_version), true);
  IF v_key IS NULL OR v_key = '' THEN
    -- Backward-compat: v1 may live in the unversioned GUC.
    IF p_version = 1 THEN
      v_key := current_setting('app.encryption_key', true);
    END IF;
  END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'encryption key v% not configured', p_version
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN pgp_sym_decrypt(p_encrypted, v_key);
END;
$$;
-- service_role is the only caller; the views route through here.
REVOKE EXECUTE ON FUNCTION public.decrypt_with_version(BYTEA, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_with_version(BYTEA, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. rotate_encryption_key — service_role only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotate_encryption_key(
  p_old_version INT,
  p_new_version INT
) RETURNS JSONB
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

  -- ai_config
  WITH upd AS (
    UPDATE public.ai_config
       SET api_key_enc = pgp_sym_encrypt(pgp_sym_decrypt(api_key_enc, v_old_key), v_new_key),
           key_version = p_new_version,
           updated_at = now()
     WHERE key_version = p_old_version
       AND api_key_enc IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_ai_count FROM upd;

  -- payment_gateway_config
  WITH upd AS (
    UPDATE public.payment_gateway_config
       SET secret_key_enc    = pgp_sym_encrypt(pgp_sym_decrypt(secret_key_enc,    v_old_key), v_new_key),
           webhook_secret_enc = pgp_sym_encrypt(pgp_sym_decrypt(webhook_secret_enc, v_old_key), v_new_key),
           key_version       = p_new_version,
           updated_at        = now()
     WHERE key_version = p_old_version
       AND (secret_key_enc IS NOT NULL OR webhook_secret_enc IS NOT NULL)
    RETURNING id
  )
  SELECT count(*) INTO v_pg_count FROM upd;

  -- audit: write a row (append-only audit_logs) tagged 'key_rotation'
  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_table, target_id, changes, created_at)
  SELECT
    NULL,
    NULLIF(current_setting('app.actor_id', true), '')::UUID,
    'key_rotation',
    'encryption_keys',
    NULL,
    jsonb_build_object(
      'old_version', p_old_version,
      'new_version', p_new_version,
      'ai_config_rotated', v_ai_count,
      'payment_gateway_config_rotated', v_pg_count
    ),
    now()
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
REVOKE EXECUTE ON FUNCTION public.rotate_encryption_key FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_encryption_key TO service_role;

-- ---------------------------------------------------------------------------
-- 4. rotate_mrn_salt — per-tenant salt rotation, service_role only.
--
-- The function does NOT bulk-rehash existing patient_hash values. Doing so
-- silently would risk missing recently-inserted rows, and there is no
-- way to recover the plaintext MRN from a SHA-256 hash anyway. Instead,
-- the application is responsible for re-hashing on the next access.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotate_mrn_salt(
  p_tenant_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_version INT;
  v_new_salt TEXT;
  v_new_version INT;
BEGIN
  SELECT salt_version INTO v_old_version
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_old_version IS NULL THEN
    RETURN jsonb_build_object('error', format('tenant %s not found', p_tenant_id));
  END IF;

  v_new_salt   := encode(gen_random_bytes(32), 'hex');
  v_new_version := v_old_version + 1;

  UPDATE public.tenants
     SET mrn_hash_salt = v_new_salt,
         salt_version  = v_new_version
   WHERE id = p_tenant_id;

  INSERT INTO public.audit_logs (tenant_id, actor_id, action, target_table, target_id, changes, created_at)
  VALUES (
    p_tenant_id,
    NULLIF(current_setting('app.actor_id', true), '')::UUID,
    'salt_rotation',
    'tenants',
    p_tenant_id,
    jsonb_build_object('old_version', v_old_version, 'new_version', v_new_version),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'old_salt_version', v_old_version,
    'new_salt_version', v_new_version,
    'note', 'patient_hash values must be re-hashed by the application on next access; old hashes are no longer valid'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rotate_mrn_salt FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_mrn_salt TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Re-create the decrypting views to use decrypt_with_version
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.secret_ai_config AS
SELECT
  id, tenant_id, provider, model, endpoint_url, is_active,
  public.decrypt_with_version(api_key_enc, key_version) AS api_key,
  key_version, created_at, updated_at
FROM public.ai_config
WHERE tenant_id = get_tenant_id()
   OR get_user_role() = 'admin';

CREATE OR REPLACE VIEW public.secret_payment_gateway_config AS
SELECT
  id, tenant_id, provider, publishable_key, is_active, mode, endpoint_url,
  public.decrypt_with_version(secret_key_enc,    key_version) AS secret_key,
  public.decrypt_with_version(webhook_secret_enc, key_version) AS webhook_secret,
  key_version, created_at, updated_at
FROM public.payment_gateway_config
WHERE tenant_id = get_tenant_id()
   OR get_user_role() = 'admin';

ALTER VIEW public.secret_ai_config SET (security_barrier = true);
ALTER VIEW public.secret_payment_gateway_config SET (security_barrier = true);
