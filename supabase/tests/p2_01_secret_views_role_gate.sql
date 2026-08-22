BEGIN;
SELECT plan(4);

-- Setup: tenant + auth users + profiles for a resident and an institution_admin.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000011', 'Secret Test Tenant', 'secret-test-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'secret-resident@example.com'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'secret-admin@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'resident', 'Secret Resident'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', 'institution_admin', 'Secret Admin');

-- Seed a key encrypted with a known GUC value so the decrypt path is exercised.
SELECT set_config('app.encryption_key', 'test-encryption-key', false);

INSERT INTO ai_config (tenant_id, provider, model, endpoint_url, is_active, api_key_enc, key_version)
VALUES ('00000000-0000-0000-0000-000000000011', 'openai', 'gpt-test', NULL, true,
        extensions.pgp_sym_encrypt('super-secret-key', 'test-encryption-key'), 1)
ON CONFLICT (tenant_id) DO UPDATE SET api_key_enc = EXCLUDED.api_key_enc, key_version = EXCLUDED.key_version;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000011","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.secret_ai_config),
  0::bigint,
  'resident cannot read secret_ai_config rows'
);
SELECT is(
  (SELECT count(*) FROM public.secret_payment_gateway_config),
  0::bigint,
  'resident cannot read secret_payment_gateway_config rows'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000012","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000011","user_role":"institution_admin"}}';

SELECT is(
  (SELECT api_key FROM public.secret_ai_config WHERE tenant_id = '00000000-0000-0000-0000-000000000011' LIMIT 1),
  'super-secret-key',
  'institution_admin of the tenant can read the decrypted api key'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.secret_ai_config),
  0::bigint,
  'resident of another tenant cannot read secret_ai_config rows'
);

ROLLBACK;
