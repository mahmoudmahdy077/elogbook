-- ============================================================================
-- 20261125000200_restrict_payment_secret_view.sql
--
-- `secret_payment_gateway_config` decrypts `secret_key` and `webhook_secret`
-- for its caller. The view is SECURITY DEFINER (it must be, to decrypt), so
-- its WHERE clause is the only access control — and it admitted `director`
-- as well as `institution_admin`, while the write path (`store_payment_gateway_secret`)
-- and the base-table policy admit only institution_admin/admin. A director
-- could therefore read the tenant's live payment secret keys without being
-- allowed to set them.
--
-- Aligns the read view with the write policy. No column or type changes, so
-- `CREATE OR REPLACE VIEW` keeps grants, ownership and reloptions. The view
-- stays owner-rights (SECURITY DEFINER semantics) because it must decrypt;
-- the decryption helper itself pins search_path, and the WHERE clause below is
-- the access boundary.
-- ============================================================================

CREATE OR REPLACE VIEW public.secret_payment_gateway_config AS
SELECT id,
    tenant_id,
    provider,
    publishable_key,
    is_active,
    mode,
    endpoint_url,
    decrypt_with_version(secret_key_enc, key_version) AS secret_key,
    decrypt_with_version(webhook_secret_enc, key_version) AS webhook_secret,
    key_version,
    created_at,
    updated_at
   FROM public.payment_gateway_config
  WHERE (get_user_role() = 'admin'::text)
     OR ((tenant_id = get_tenant_id()) AND (get_user_role() = 'institution_admin'::text));

COMMENT ON VIEW public.secret_payment_gateway_config IS
  'Decrypted payment secrets. Read: platform admin, or the tenant institution_admin (matches the write policy). Directors deliberately excluded (SEC-005).';
