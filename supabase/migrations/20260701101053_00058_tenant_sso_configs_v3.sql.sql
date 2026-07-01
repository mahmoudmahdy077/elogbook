-- ============================================================================
-- 00058_tenant_sso_configs.sql
--
-- Phase 6 / P6.0
--
-- Per-tenant SSO configuration for enterprise SAML/OIDC integration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  metadata_url TEXT,
  discovery_url TEXT,
  idp_entity_id TEXT,
  idp_certificate TEXT,
  client_id TEXT,
  client_secret_encrypted TEXT,
  default_role TEXT NOT NULL DEFAULT 'resident' CHECK (default_role IN ('resident', 'supervisor', 'director', 'institution_admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, protocol)
);

CREATE INDEX IF NOT EXISTS idx_tenant_sso_configs_tenant
  ON public.tenant_sso_configs(tenant_id)
  WHERE is_active = true;

ALTER TABLE public.tenant_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_sso_configs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_sso_configs_select ON public.tenant_sso_configs;
CREATE POLICY tenant_sso_configs_select ON public.tenant_sso_configs
  FOR SELECT
  TO authenticated
  USING (
    (tenant_id = get_tenant_id() AND get_user_role() IN ('director', 'institution_admin'))
    OR get_user_role() = 'admin'
  );

DROP POLICY IF EXISTS tenant_sso_configs_write ON public.tenant_sso_configs;
CREATE POLICY tenant_sso_configs_write ON public.tenant_sso_configs
  FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP TRIGGER IF EXISTS tenant_sso_configs_touch ON public.tenant_sso_configs;
CREATE TRIGGER tenant_sso_configs_touch
  BEFORE UPDATE ON public.tenant_sso_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();