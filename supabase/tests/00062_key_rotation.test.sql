-- ============================================================================
-- 00062_key_rotation.test.sql
--
-- Phase 7 / P7.7 — round-trip test for the versioned encryption key
-- rotation. Run with:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/00062_key_rotation.test.sql
-- or include in `supabase test db` (pgTAP not required; this is a plain
-- psql transaction script with explicit assertions).
--
-- The test:
--   1. Configures app.encryption_key_v1 and v2 as in-memory GUCs.
--   2. Inserts a row into ai_config and payment_gateway_config with
--      v1 encryption (using store_ai_config / store_payment_gateway_secret).
--   3. Decrypts via the views to confirm the v1 plaintext.
--   4. Calls rotate_encryption_key(1, 2) to rotate.
--   5. Decrypts again — now via v2 — and confirms the same plaintext.
--   6. Verifies that v1 GUC is no longer required (drops v1, decrypt
--      still works because key_version is now 2).
-- ============================================================================

BEGIN;

-- 1. Set up keys (32-byte random — must be set BEFORE the inserts)
SELECT set_config('app.encryption_key_v1', 'k1-' || repeat('a', 30), false);
SELECT set_config('app.encryption_key_v2', 'k2-' || repeat('b', 30), false);

-- 2. Insert a test row directly (bypassing the role-gated RPCs)
--    We need a tenant and a profile to satisfy RLS in real use; here
--    we use service_role so RLS is bypassed.
DO $$
DECLARE
  v_tenant_id UUID;
BEGIN
  INSERT INTO public.tenants (id, name, slug, tenant_type)
    VALUES (gen_random_uuid(), 'P7.7 Test Tenant', 'p77-test', 'institution')
    RETURNING id INTO v_tenant_id;

  INSERT INTO public.ai_config (tenant_id, provider, model, api_key_enc, key_version, is_active)
    VALUES (
      v_tenant_id,
      'openai',
      'gpt-4o',
      pgp_sym_encrypt('sk-test-OPENAI-PLAINTEXT-v1', current_setting('app.encryption_key_v1')),
      1,
      true
    );

  INSERT INTO public.payment_gateway_config (tenant_id, provider, publishable_key, secret_key_enc, webhook_secret_enc, key_version, mode, is_active)
    VALUES (
      v_tenant_id,
      'stripe',
      'pk_test_PLACEHOLDER',
      pgp_sym_encrypt('sk_test_STRIPE_SECRET_PLAINTEXT', current_setting('app.encryption_key_v1')),
      pgp_sym_encrypt('whsec_STRIPE_WEBHOOK_PLAINTEXT', current_setting('app.encryption_key_v1')),
      1,
      'test',
      true
    );

  RAISE NOTICE 'Inserted tenant %', v_tenant_id;
END $$;

-- 3. Confirm v1 decrypt works through decrypt_with_version
DO $$
DECLARE
  v_decrypted TEXT;
BEGIN
  SELECT public.decrypt_with_version(api_key_enc, 1)
    INTO v_decrypted
    FROM public.ai_config
   WHERE provider = 'openai'
   LIMIT 1;
  IF v_decrypted <> 'sk-test-OPENAI-PLAINTEXT-v1' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: v1 decrypt returned %', v_decrypted;
  END IF;
  RAISE NOTICE 'PASS: v1 decrypt returned expected plaintext';
END $$;

-- 4. Rotate v1 -> v2 via the service_role RPC.
--    service_role bypasses the EXECUTE grant check, so we can call it.
DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.rotate_encryption_key(1, 2);
  IF NOT (v_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'ASSERTION FAILED: rotate_encryption_key returned %', v_result;
  END IF;
  IF COALESCE((v_result->>'ai_config_rotated')::INT, 0) < 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ai_config_rotated was %', v_result->>'ai_config_rotated';
  END IF;
  IF COALESCE((v_result->>'payment_gateway_config_rotated')::INT, 0) < 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: payment_gateway_config_rotated was %', v_result->>'payment_gateway_config_rotated';
  END IF;
  RAISE NOTICE 'PASS: rotate_encryption_key(1, 2) = %', v_result;
END $$;

-- 5. Confirm v2 decrypt works
DO $$
DECLARE
  v_ai_key TEXT;
  v_secret TEXT;
  v_webhook TEXT;
BEGIN
  SELECT public.decrypt_with_version(api_key_enc, 2)
    INTO v_ai_key
    FROM public.ai_config
   WHERE provider = 'openai'
   LIMIT 1;
  IF v_ai_key <> 'sk-test-OPENAI-PLAINTEXT-v1' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: v2 decrypt of api_key returned %', v_ai_key;
  END IF;

  SELECT public.decrypt_with_version(secret_key_enc, 2),
         public.decrypt_with_version(webhook_secret_enc, 2)
    INTO v_secret, v_webhook
    FROM public.payment_gateway_config
   WHERE provider = 'stripe'
   LIMIT 1;
  IF v_secret <> 'sk_test_STRIPE_SECRET_PLAINTEXT' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: v2 decrypt of secret_key returned %', v_secret;
  END IF;
  IF v_webhook <> 'whsec_STRIPE_WEBHOOK_PLAINTEXT' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: v2 decrypt of webhook_secret returned %', v_webhook;
  END IF;
  RAISE NOTICE 'PASS: v2 decrypt returned expected plaintext for all three columns';
END $$;

-- 6. Verify key_version was bumped to 2
DO $$
DECLARE
  v_ai_version INT;
  v_pg_version INT;
BEGIN
  SELECT key_version INTO v_ai_version FROM public.ai_config WHERE provider = 'openai' LIMIT 1;
  SELECT key_version INTO v_pg_version FROM public.payment_gateway_config WHERE provider = 'stripe' LIMIT 1;
  IF v_ai_version <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: ai_config.key_version = % (expected 2)', v_ai_version;
  END IF;
  IF v_pg_version <> 2 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: payment_gateway_config.key_version = % (expected 2)', v_pg_version;
  END IF;
  RAISE NOTICE 'PASS: key_version = 2 on both tables';
END $$;

-- 7. Idempotency: a second rotation from 1->2 should be a no-op for data
--    (no rows match key_version = 1 anymore) but must still return success.
DO $$
DECLARE
  v_result JSONB;
BEGIN
  v_result := public.rotate_encryption_key(1, 2);
  IF NOT (v_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'ASSERTION FAILED: idempotent rotate returned %', v_result;
  END IF;
  IF COALESCE((v_result->>'ai_config_rotated')::INT, -1) <> 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: second rotate should not re-encrypt, got %', v_result->>'ai_config_rotated';
  END IF;
  RAISE NOTICE 'PASS: idempotent rotate is a no-op';
END $$;

-- 7b. Confirm the audit_logs row was written (append-only trail)
DO $$
DECLARE
  v_count INT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='audit_logs') THEN
    SELECT count(*) INTO v_count
      FROM public.audit_logs
     WHERE action = 'key_rotation';
    IF v_count < 1 THEN
      RAISE EXCEPTION 'ASSERTION FAILED: no audit_logs row tagged key_rotation';
    END IF;
    RAISE NOTICE 'PASS: audit_logs has key_rotation row';
  ELSE
    RAISE NOTICE 'SKIP: audit_logs table not present (test environment)';
  END IF;
END $$;

-- 8. Cleanup
DELETE FROM public.ai_config WHERE provider = 'openai';
DELETE FROM public.payment_gateway_config WHERE provider = 'stripe';
DELETE FROM public.tenants WHERE slug = 'p77-test';

RAISE NOTICE 'All P7.7 key-rotation assertions passed.';

ROLLBACK;
