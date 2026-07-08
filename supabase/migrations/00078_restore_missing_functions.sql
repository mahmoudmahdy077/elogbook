-- Migration 00078: Restore missing DB functions lost during migration renumbering
-- Functions referenced by migrations 00058 and 00063 that no longer exist on disk

CREATE OR REPLACE FUNCTION public.current_role_global()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'user_role', '')::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.current_role_in_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_tenant_id IS NOT NULL AND get_tenant_id() != p_tenant_id THEN NULL
    ELSE current_role_global()
  END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Stub: invite_user is handled at the application layer via Supabase Auth
CREATE OR REPLACE FUNCTION public.invite_user(p_email TEXT, p_tenant_id UUID, p_role TEXT, p_full_name TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT;
$$;
