-- ============================================================================
-- 00074_tenant_webhooks_encrypt.sql
--
-- Add encrypted secret storage for tenant_webhooks following the same
-- pgp_sym_encrypt pattern used by ai_config (00053).
--
-- 1. Adds secret_enc BYTEA column
-- 2. Backfills from plaintext secret column
-- 3. Creates store_tenant_webhook RPC (encrypts on insert/update)
-- 4. Creates secret_tenant_webhooks decrypting view
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add secret_enc column
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_webhooks'
      AND column_name = 'secret_enc'
  ) THEN
    ALTER TABLE public.tenant_webhooks ADD COLUMN secret_enc BYTEA;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill from plaintext secret (only if app.encryption_key is set)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key TEXT := current_setting('app.encryption_key', true);
BEGIN
  IF v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'skip backfill: app.encryption_key not set';
    RETURN;
  END IF;

  UPDATE public.tenant_webhooks
     SET secret_enc = extensions.pgp_sym_encrypt(secret, v_key)
   WHERE secret IS NOT NULL
     AND secret_enc IS NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RPC: store_tenant_webhook — insert or update with encrypted secret
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.store_tenant_webhook(
  p_url TEXT,
  p_events TEXT[],
  p_secret TEXT,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_webhook_id UUID DEFAULT NULL
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

  -- Validate HTTPS for production
  IF current_setting('app.environment', true) = 'production'
     AND p_url NOT ILIKE 'https://%' THEN
    RETURN jsonb_build_object('error', 'HTTPS is required in production');
  END IF;

  -- Validate at least one event
  IF array_length(p_events, 1) IS NULL OR array_length(p_events, 1) = 0 THEN
    RETURN jsonb_build_object('error', 'At least one event type is required');
  END IF;

  -- Rate limit: max 10 webhooks per tenant
  IF p_webhook_id IS NULL THEN
    IF (SELECT count(*) FROM public.tenant_webhooks WHERE tenant_id = v_tenant_id) >= 10 THEN
      RETURN jsonb_build_object('error', 'Maximum of 10 webhooks per tenant');
    END IF;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    -- Fallback: store plaintext (dev mode)
    IF p_webhook_id IS NOT NULL THEN
      UPDATE public.tenant_webhooks
         SET url = p_url,
             events = p_events,
             description = p_description,
             is_active = p_is_active,
             secret = p_secret,
             updated_at = now()
       WHERE id = p_webhook_id
         AND tenant_id = v_tenant_id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.tenant_webhooks (tenant_id, url, events, secret, description, is_active)
      VALUES (v_tenant_id, p_url, p_events, p_secret, p_description, p_is_active)
      RETURNING id INTO v_id;
    END IF;
  ELSE
    -- Encrypted storage
    IF p_webhook_id IS NOT NULL THEN
      UPDATE public.tenant_webhooks
         SET url = p_url,
             events = p_events,
             description = p_description,
             is_active = p_is_active,
             secret = 'encrypted',  -- placeholder, real value in secret_enc
             secret_enc = extensions.pgp_sym_encrypt(p_secret, v_key),
             updated_at = now()
       WHERE id = p_webhook_id
         AND tenant_id = v_tenant_id
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO public.tenant_webhooks (tenant_id, url, events, secret, description, is_active, secret_enc)
      VALUES (v_tenant_id, p_url, p_events, 'encrypted', p_description, p_is_active, extensions.pgp_sym_encrypt(p_secret, v_key))
      RETURNING id INTO v_id;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Webhook not found or access denied');
  END IF;

  RETURN jsonb_build_object('id', v_id, 'tenant_id', v_tenant_id, 'success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.store_tenant_webhook FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_tenant_webhook TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Decrypting view for authorized callers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.secret_tenant_webhooks AS
SELECT
  id, tenant_id, url, events, description, is_active, created_at, updated_at,
  CASE
    WHEN current_setting('app.encryption_key', true) IS NOT NULL
         AND current_setting('app.encryption_key', true) != ''
    THEN extensions.pgp_sym_decrypt(secret_enc, current_setting('app.encryption_key'))
    ELSE secret
  END AS secret
FROM public.tenant_webhooks
WHERE tenant_id = get_tenant_id()
   OR get_user_role() = 'admin';

ALTER VIEW public.secret_tenant_webhooks SET (security_barrier = true);
GRANT SELECT ON public.secret_tenant_webhooks TO authenticated;
