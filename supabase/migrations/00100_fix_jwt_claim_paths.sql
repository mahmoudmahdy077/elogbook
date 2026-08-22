-- Migration 00100: Fix get_tenant_id / get_user_role to read app_metadata
--
-- The JWT stores tenant_id and user_role under app_metadata (set by the
-- 00006 demo seeding and the handle_new_user trigger), but the 00020
-- definitions read TOP-LEVEL claims (request.jwt.claims->>'tenant_id',
-- auth.jwt()->>'tenant_id'), which are never present in the issued
-- tokens. get_tenant_id() therefore returns NULL for every user.
--
-- Impact: tenants RLS policy ("Users can read own tenant") filters out
-- everything, so getAuthContext() throws and the authenticated layout
-- bounces to /login, which (via the middleware's "already logged in"
-- branch with a missing tenant) redirects to /default/dashboard, which
-- redirects back to /login — an infinite ERR_TOO_MANY_REDIRECTS loop
-- for every authenticated user, including the seeded demo accounts.
--
-- get_user_role() happened to survive because of its 'resident'
-- fallback; it is corrected here for consistency.

CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'tenant_id',
    auth.jwt() -> 'app_metadata' ->> 'tenant_id'
  )::UUID;
END;
$$;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'user_role',
    auth.jwt() -> 'app_metadata' ->> 'user_role',
    'resident'
  );
END;
$$;
