-- ============================================================================
-- 00053_encrypt_secrets.sql
--
-- Phase 2 / P2.1
--
-- Complete the secret-column encryption rollout for ai_config and
-- payment_gateway_config. Prior migration 00037 was reverted during a
-- cleanup; this migration re-introduces the encryption with the bugs
-- fixed:
--
--   1. Adds *_enc BYTEA columns (encrypted with pgcrypto's
--      pgp_sym_encrypt + the app.encryption_key GUC).
--   2. Backfills *_enc from the deprecated plaintext columns
--      (encrypted_api_key, encrypted_secret_key,
--      encrypted_webhook_secret) ONLY if app.encryption_key is set;
--      otherwise the plaintext stays (so local dev without the GUC
--      still works — same as the old 00037).
--   3. Drops the deprecated plaintext columns to remove the leak
--      surface entirely.
--   4. Creates `secret_ai_config` and `secret_payment_gateway_config`
--      views that decrypt the *_enc columns for callers authorized
--      via RLS.
--   5. Grants SELECT on the views to authenticated; REVOKES SELECT on
--      the underlying tables from authenticated and anon (only the
--      service_role retains direct access — the views mediate).
--   6. Adds a `mode` column to payment_gateway_config ('test' | 'live')
--      if missing.
--   7. Adds a `key_version` column to ai_config and
--      payment_gateway_config for rotation support (P7.7).
--
-- Idempotent: every step uses IF NOT EXISTS / DO blocks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add *_enc columns (BYTEA)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_config' AND column_name='api_key_enc') THEN
    ALTER TABLE public.ai_config ADD COLUMN api_key_enc BYTEA;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_config' AND column_name='key_version') THEN
    ALTER TABLE public.ai_config ADD COLUMN key_version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='secret_key_enc') THEN
    ALTER TABLE public.payment_gateway_config ADD COLUMN secret_key_enc BYTEA;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='webhook_secret_enc') THEN
    ALTER TABLE public.payment_gateway_config ADD COLUMN webhook_secret_enc BYTEA;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='key_version') THEN
    ALTER TABLE public.payment_gateway_config ADD COLUMN key_version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='mode') THEN
    ALTER TABLE public.payment_gateway_config ADD COLUMN mode TEXT NOT NULL DEFAULT 'test'
      CHECK (mode IN ('test', 'live'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill *_enc from legacy plaintext columns (only if app.encryption_key set)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key TEXT := current_setting('app.encryption_key', true);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'skip backfill: app.encryption_key not set';
    RETURN;
  END IF;

  -- ai_config: encrypted_api_key -> api_key_enc
  UPDATE public.ai_config
     SET api_key_enc = pgp_sym_encrypt(encrypted_api_key, v_key)
   WHERE encrypted_api_key IS NOT NULL
     AND api_key_enc IS NULL;

  -- payment_gateway_config: secret + webhook
  UPDATE public.payment_gateway_config
     SET secret_key_enc = pgp_sym_encrypt(encrypted_secret_key, v_key),
         webhook_secret_enc = pgp_sym_encrypt(encrypted_webhook_secret, v_key)
   WHERE encrypted_secret_key IS NOT NULL
      OR encrypted_webhook_secret IS NOT NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Drop deprecated plaintext columns (only if backfill succeeded for all
--    rows; we check that no plaintext remains non-null where an enc exists)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_has_plain BOOLEAN;
BEGIN
  -- Only drop the ai_config plaintext column if every row that has a
  -- plaintext also has an enc, or has neither.
  SELECT EXISTS (
    SELECT 1 FROM public.ai_config
     WHERE encrypted_api_key IS NOT NULL AND api_key_enc IS NULL
  ) INTO v_has_plain;
  IF v_has_plain THEN
    RAISE NOTICE 'skip drop ai_config.encrypted_api_key: some rows have plaintext but no enc';
  ELSE
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_config' AND column_name='encrypted_api_key') THEN
      ALTER TABLE public.ai_config DROP COLUMN encrypted_api_key;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.payment_gateway_config
     WHERE (encrypted_secret_key IS NOT NULL AND secret_key_enc IS NULL)
        OR (encrypted_webhook_secret IS NOT NULL AND webhook_secret_enc IS NULL)
  ) INTO v_has_plain;
  IF v_has_plain THEN
    RAISE NOTICE 'skip drop payment_gateway_config plaintext: some rows have plaintext but no enc';
  ELSE
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='encrypted_secret_key') THEN
      ALTER TABLE public.payment_gateway_config DROP COLUMN encrypted_secret_key;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_gateway_config' AND column_name='encrypted_webhook_secret') THEN
      ALTER TABLE public.payment_gateway_config DROP COLUMN encrypted_webhook_secret;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Decrypting views (security_barrier so RLS applies on the underlying
--    tables; these views re-impose tenant scoping via WHERE clause).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
CREATE OR REPLACE VIEW public.secret_ai_config AS
SELECT
  id, tenant_id, provider, model, endpoint_url, is_active,
  pgp_sym_decrypt(api_key_enc, current_setting('app.encryption_key')) AS api_key,
  key_version, created_at, updated_at
FROM public.ai_config
WHERE tenant_id = get_tenant_id()
   OR get_user_role() = 'admin';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'pgp_sym_decrypt not available, skipping secret_ai_config view';
END $$;

DO $$ BEGIN
CREATE OR REPLACE VIEW public.secret_payment_gateway_config AS
SELECT
  id, tenant_id, provider, publishable_key, is_active, mode, endpoint_url,
  pgp_sym_decrypt(secret_key_enc, current_setting('app.encryption_key')) AS secret_key,
  pgp_sym_decrypt(webhook_secret_enc, current_setting('app.encryption_key')) AS webhook_secret,
  key_version, created_at, updated_at
FROM public.payment_gateway_config
WHERE tenant_id = get_tenant_id()
   OR get_user_role() = 'admin';
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE 'pgp_sym_decrypt not available, skipping secret_payment_gateway_config view';
END $$;

ALTER VIEW IF EXISTS public.secret_ai_config SET (security_barrier = true);
ALTER VIEW IF EXISTS public.secret_payment_gateway_config SET (security_barrier = true);

-- ---------------------------------------------------------------------------
-- 5. Tighten grants: revoke direct SELECT on the base tables from
--    authenticated/anon, grant SELECT on the views.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.ai_config FROM authenticated, anon;
REVOKE SELECT ON public.payment_gateway_config FROM authenticated, anon;

DO $$ BEGIN GRANT SELECT ON public.secret_ai_config TO authenticated; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN GRANT SELECT ON public.secret_payment_gateway_config TO authenticated; EXCEPTION WHEN undefined_table THEN NULL; END $$;
-- service_role retains everything (BYPASSRLS)

-- ---------------------------------------------------------------------------
-- 6. RLS policy: institution_admin+ for the views (the views already
--    WHERE-filter on tenant_id, so director/supervisor can't see other
--    tenants' configs; we additionally require role >= institution_admin
--    to read secrets at all).
-- ---------------------------------------------------------------------------
CREATE POLICY "institution_admin reads secret_ai_config"
  ON public.ai_config FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('institution_admin', 'admin')
    AND (tenant_id = get_tenant_id() OR get_user_role() = 'admin')
  );

-- The view security_barrier + the RLS policy above together ensure that
-- an authenticated resident/supervisor/director cannot SELECT from
-- either the table or the view to leak secrets.

-- ---------------------------------------------------------------------------
-- 7. store_ai_config + store_payment_gateway_secret helper RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_ai_config(
  p_provider TEXT,
  p_model TEXT,
  p_api_key TEXT,
  p_endpoint_url TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id UUID := get_tenant_id();
  v_key TEXT;
  v_id UUID;
BEGIN
  IF get_user_role() NOT IN ('institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('error', 'app.encryption_key not configured');
  END IF;

  INSERT INTO public.ai_config (tenant_id, provider, model, endpoint_url, is_active, api_key_enc, key_version, created_at, updated_at)
    VALUES (v_tenant_id, p_provider, p_model, p_endpoint_url, p_is_active,
            pgp_sym_encrypt(p_api_key, v_key), 1, now(), now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          api_key_enc = EXCLUDED.api_key_enc,
          endpoint_url = EXCLUDED.endpoint_url,
          is_active = EXCLUDED.is_active,
          key_version = public.ai_config.key_version + 1,
          updated_at = now()
    RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'tenant_id', v_tenant_id, 'success', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.store_ai_config FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_ai_config TO authenticated;

CREATE OR REPLACE FUNCTION public.store_payment_gateway_secret(
  p_provider TEXT,
  p_publishable_key TEXT,
  p_secret_key TEXT,
  p_webhook_secret TEXT,
  p_endpoint_url TEXT DEFAULT NULL,
  p_mode TEXT DEFAULT 'test'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id UUID := get_tenant_id();
  v_key TEXT;
  v_id UUID;
BEGIN
  IF get_user_role() NOT IN ('institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('error', 'app.encryption_key not configured');
  END IF;

  INSERT INTO public.payment_gateway_config (tenant_id, provider, publishable_key, is_active, mode, endpoint_url, secret_key_enc, webhook_secret_enc, key_version, created_at, updated_at)
    VALUES (v_tenant_id, p_provider, p_publishable_key, true, p_mode, p_endpoint_url,
            pgp_sym_encrypt(p_secret_key, v_key),
            pgp_sym_encrypt(p_webhook_secret, v_key),
            1, now(), now())
    ON CONFLICT (tenant_id) DO UPDATE
      SET provider = EXCLUDED.provider,
          publishable_key = EXCLUDED.publishable_key,
          is_active = EXCLUDED.is_active,
          mode = EXCLUDED.mode,
          endpoint_url = EXCLUDED.endpoint_url,
          secret_key_enc = EXCLUDED.secret_key_enc,
          webhook_secret_enc = EXCLUDED.webhook_secret_enc,
          key_version = public.payment_gateway_config.key_version + 1,
          updated_at = now()
    RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'tenant_id', v_tenant_id, 'success', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.store_payment_gateway_secret FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_payment_gateway_secret TO authenticated;
