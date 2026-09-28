CREATE OR REPLACE FUNCTION public.get_authoritative_principal()
RETURNS TABLE (
  user_id UUID,
  profile_id UUID,
  tenant_id UUID,
  role TEXT,
  profile_status TEXT,
  tenant_status TEXT,
  tenant_slug TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    profile.user_id,
    profile.id,
    profile.tenant_id,
    profile.role,
    profile.status,
    tenant.status,
    tenant.slug
  FROM public.profiles AS profile
  INNER JOIN public.tenants AS tenant ON tenant.id = profile.tenant_id
  WHERE profile.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_account_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    INNER JOIN public.tenants AS tenant ON tenant.id = profile.tenant_id
    WHERE profile.user_id = auth.uid()
      AND profile.status = 'active'
      AND tenant.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    INNER JOIN public.tenants AS tenant ON tenant.id = profile.tenant_id
    WHERE profile.user_id = auth.uid()
      AND profile.status = 'active'
      AND tenant.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT principal.tenant_id
  FROM public.get_authoritative_principal() AS principal
  WHERE principal.profile_status = 'active'
    AND principal.tenant_status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT principal.role
  FROM public.get_authoritative_principal() AS principal
  WHERE principal.profile_status = 'active'
    AND principal.tenant_status = 'active'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_authoritative_principal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_account_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_tenant_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_authoritative_principal() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT table_relation.relname
    FROM pg_class AS table_relation
    INNER JOIN pg_namespace AS schema_record ON schema_record.oid = table_relation.relnamespace
    WHERE schema_record.nspname = 'public'
      AND table_relation.relkind IN ('r', 'p')
      AND (table_relation.relrowsecurity = false OR table_relation.relforcerowsecurity = false)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_record.relname);
  END LOOP;
END
$$;
