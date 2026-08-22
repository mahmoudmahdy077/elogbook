-- 20260812100000_fix_secret_views.sql
-- S1: any authenticated user could read their tenant's decrypted API keys /
-- webhook secrets through the definer secret_* views. Add the same role gate
-- as the base-table RLS policies to each view's WHERE clause.

CREATE OR REPLACE VIEW public.secret_ai_config AS
SELECT
  id, tenant_id, provider, model, endpoint_url, is_active,
  public.decrypt_with_version(api_key_enc, key_version) AS api_key,
  key_version, created_at, updated_at
FROM public.ai_config
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin');

ALTER VIEW public.secret_ai_config SET (security_barrier = true);

CREATE OR REPLACE VIEW public.secret_payment_gateway_config AS
SELECT
  id, tenant_id, provider, publishable_key, is_active, mode, endpoint_url,
  public.decrypt_with_version(secret_key_enc,    key_version) AS secret_key,
  public.decrypt_with_version(webhook_secret_enc, key_version) AS webhook_secret,
  key_version, created_at, updated_at
FROM public.payment_gateway_config
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() IN ('director', 'institution_admin'));

ALTER VIEW public.secret_payment_gateway_config SET (security_barrier = true);

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
WHERE get_user_role() = 'admin'
   OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin');

ALTER VIEW public.secret_tenant_webhooks SET (security_barrier = true);
