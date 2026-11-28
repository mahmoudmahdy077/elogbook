-- ============================================================================
-- 20261127000000_mobile_app_config.sql
--
-- Web control plane for the Expo app.
--
-- Before this table a tenant admin could configure the web portal but had no
-- way to change what the mobile app offers: modules were compiled in, the
-- daily goal was the only remote value, and an incident (bad release,
-- maintenance window, urgent notice) could only be handled by shipping a
-- store build. This table is the server-authoritative config the app reads
-- on boot and on every foreground:
--
--   enabled_features    { module_key: boolean } — false hides a module
--   maintenance_mode    blocks the app behind a message
--   min_app_version     + force_update gates outdated builds
--   announcement        dismissible banner with expiry
--   update_url          where the force-update button sends the user
--
-- Reads are RLS-scoped to the caller's tenant. Writes are tenant-admin only;
-- the API route additionally audits each change. All values are
-- presentation controls, never authorization: RLS/RPC still decide access.
--
-- destructive: no — new table only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mobile_app_config (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled_features JSONB NOT NULL DEFAULT '{}'::jsonb,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  min_app_version TEXT,
  latest_app_version TEXT,
  force_update BOOLEAN NOT NULL DEFAULT false,
  update_url TEXT,
  announcement JSONB,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mobile_app_config_features_object
    CHECK (jsonb_typeof(enabled_features) = 'object'),
  CONSTRAINT mobile_app_config_announcement_object
    CHECK (announcement IS NULL OR jsonb_typeof(announcement) = 'object'),
  CONSTRAINT mobile_app_config_maintenance_message_len
    CHECK (maintenance_message IS NULL OR char_length(maintenance_message) <= 500),
  CONSTRAINT mobile_app_config_min_version_format
    CHECK (min_app_version IS NULL OR min_app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  CONSTRAINT mobile_app_config_latest_version_format
    CHECK (latest_app_version IS NULL OR latest_app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  CONSTRAINT mobile_app_config_update_url_https
    CHECK (update_url IS NULL OR update_url ~ '^https://')
);

ALTER TABLE public.mobile_app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_app_config FORCE ROW LEVEL SECURITY;

-- Every member of the tenant may read the controls; the app needs them
-- before it can render, and they contain no PHI or secrets.
DROP POLICY IF EXISTS mobile_app_config_read ON public.mobile_app_config;
CREATE POLICY mobile_app_config_read ON public.mobile_app_config
  FOR SELECT TO authenticated
  USING (tenant_id = get_tenant_id());

-- Only tenant admins write. Role comes from profiles (not JWT metadata),
-- matching the 2026-11-26 owner-scope hardening.
DROP POLICY IF EXISTS mobile_app_config_write ON public.mobile_app_config;
CREATE POLICY mobile_app_config_write ON public.mobile_app_config
  FOR ALL TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = mobile_app_config.tenant_id
        AND p.role IN ('director', 'institution_admin', 'admin')
        AND p.status = 'active'
    )
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = mobile_app_config.tenant_id
        AND p.role IN ('director', 'institution_admin', 'admin')
        AND p.status = 'active'
    )
  );

CREATE OR REPLACE FUNCTION public.touch_mobile_app_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_mobile_app_config ON public.mobile_app_config;
CREATE TRIGGER trg_touch_mobile_app_config
  BEFORE UPDATE ON public.mobile_app_config
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_mobile_app_config();

-- Explicit grants: a fresh replay does not inherit the provisioned project's
-- default ACLs (see 20261028000000_restore_public_table_grants.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_app_config TO authenticated;
GRANT ALL ON public.mobile_app_config TO service_role;

COMMENT ON TABLE public.mobile_app_config IS
  'Web-controlled mobile app settings per tenant: module toggles, maintenance, version gate, announcement. Presentation only; RLS/RPC remain authoritative.';
