BEGIN;
SELECT plan(6);

-- Setup: tenant + an institution_admin with a verified MFA factor (00086
-- trg_enforce_mfa guards high-privilege profile writes) and a resident.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000041', 'SSO Secret Tenant', 'sso-secret-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000000', 'sso-resident@example.com'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000000', 'sso-admin@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000042', 'pgtap', 'totp', 'verified', NOW(), NOW(), 'JBSWY3DPEHPK3PXP')
ON CONFLICT DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'resident', 'SSO Resident'),
  ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', 'institution_admin', 'SSO Admin');

SELECT set_config('app.encryption_key', 'test-encryption-key', false);

-- Resident may not store an SSO config.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","role":"authenticated","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"resident"}}';

SELECT is(
  public.store_sso_config('oidc', NULL, 'https://idp.example.com/.well-known/openid-configuration', 'entity', 'cert', 'client-id', 'resident-secret', 'resident', true) ->> 'error',
  'forbidden',
  'resident cannot store an SSO config'
);

-- Admin stores a config; the client secret must be encrypted at rest. Before
-- the ::text cast fix this raised 42804 (bytea written into a text column).
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000042","role":"authenticated","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"institution_admin"}}';

SELECT lives_ok(
  $$SELECT public.store_sso_config('oidc', NULL, 'https://idp.example.com/.well-known/openid-configuration', 'entity', 'cert', 'client-id', 'sso-secret-1', 'resident', true)$$,
  'institution_admin can store an SSO config with a client secret'
);

-- Read as the session role (the RPC owner) so the checks are about the stored
-- bytes, not about tenant_sso_configs' SELECT policy.
RESET ROLE;

SELECT is(
  left((SELECT client_secret_encrypted FROM public.tenant_sso_configs
        WHERE tenant_id = '00000000-0000-0000-0000-000000000041' AND protocol = 'oidc'), 6),
  '\xc30d',
  'client secret is stored as pgp ciphertext, not plaintext'
);

SELECT is(
  extensions.pgp_sym_decrypt(
    (SELECT client_secret_encrypted::bytea FROM public.tenant_sso_configs
      WHERE tenant_id = '00000000-0000-0000-0000-000000000041' AND protocol = 'oidc'),
    'test-encryption-key'),
  'sso-secret-1',
  'stored ciphertext decrypts back to the submitted secret'
);

-- Metadata update without a new secret must keep the stored ciphertext.
SELECT lives_ok(
  format(
    $$SELECT public.store_sso_config('oidc', NULL, 'https://idp.example.com/.well-known/openid-configuration', 'entity-2', 'cert', 'client-id', NULL, 'resident', true, %L)$$,
    (SELECT id FROM public.tenant_sso_configs
      WHERE tenant_id = '00000000-0000-0000-0000-000000000041' AND protocol = 'oidc')
  ),
  'update without a new secret succeeds'
);

SELECT is(
  extensions.pgp_sym_decrypt(
    (SELECT client_secret_encrypted::bytea FROM public.tenant_sso_configs
      WHERE tenant_id = '00000000-0000-0000-0000-000000000041' AND protocol = 'oidc'),
    'test-encryption-key'),
  'sso-secret-1',
  'update without a new secret preserves the stored ciphertext'
);

ROLLBACK;
