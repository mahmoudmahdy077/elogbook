-- 20260826180000_tenant_storage_view_rls.sql
-- SEC-001: tenant_storage_usage_mb leaked cross-tenant data.
--
-- The view (00061) exposes per-tenant storage usage + plan quota for ALL
-- tenants to any authenticated user: `GRANT SELECT ... TO authenticated`
-- with no policy and no security_invoker/security_barrier. Views run with
-- the definer's rights by default in Postgres (owner bypasses RLS on the
-- underlying tables), so every authenticated principal could list every
-- tenant's slug + usage + subscription tier. Verified live: a plain
-- resident session read 11 tenant rows.
--
-- Fix (Postgres 15+):
--   1. security_invoker = true  -> underlying RLS (tenants) applies to the
--      querying user. The tenants table RLS already restricts members to
--      their own tenant; admins/directors to their institution scope.
--   2. security_barrier = true  -> pushed-down predicates can't leak rows
--      through leaky function side-channels.
--   3. Drop the blanket authenticated grant; views inherit column-level
--      access via the underlying tables. Keep explicit grants for the
--      platform/admin monitoring path if needed later.
--
-- Idempotent: guarded by IF EXISTS / to_regclass checks.

DO $$
BEGIN
  IF to_regclass('public.tenant_storage_usage_mb') IS NOT NULL THEN
    ALTER VIEW public.tenant_storage_usage_mb SET (security_invoker = true);
    ALTER VIEW public.tenant_storage_usage_mb SET (security_barrier = true);
    REVOKE SELECT ON public.tenant_storage_usage_mb FROM authenticated;
    REVOKE SELECT ON public.tenant_storage_usage_mb FROM anon;
    RAISE NOTICE 'SEC-001: tenant_storage_usage_mb locked to invoker RLS';
  ELSE
    RAISE NOTICE 'SEC-001: view not present, skipping';
  END IF;
END $$;

COMMENT ON VIEW public.tenant_storage_usage_mb IS
  'Per-tenant storage usage (MB) vs. the active plan quota. security_invoker: callers only see their own tenant via tenants-table RLS.';
