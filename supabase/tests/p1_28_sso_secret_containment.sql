BEGIN;
SELECT plan(6);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'client_secret_enc'
  ),
  'SSO client secret is stored in an encrypted column'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_sso_configs' AND column_name = 'idp_certificate_enc'
  ),
  'SSO IdP certificate is stored in an encrypted column'
);
SELECT ok(
  to_regclass('public.tenant_sso_configs_safe') IS NOT NULL,
  'safe SSO projection view exists'
);
SELECT ok(
  to_regprocedure('public.store_tenant_sso_config(uuid,uuid,text,text,text,text,text,text,text,text,boolean)') IS NOT NULL,
  'approved SSO write RPC exists'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.tenant_sso_configs', 'SELECT'),
  'anonymous callers cannot read the SSO base table'
);
SELECT ok(
  has_table_privilege('service_role', 'public.tenant_sso_configs_safe', 'SELECT'),
  'service role can read the safe SSO projection'
);

ROLLBACK;
