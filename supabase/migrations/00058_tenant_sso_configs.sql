-- ============================================================================
-- 00058_tenant_sso_configs.sql
--
-- Phase 6 / P6.0
--
-- Per-tenant SSO configuration for enterprise SAML/OIDC integration.
-- Each tenant may register at most one active SSO config. The actual
-- handshake is brokered by the `sso-callback` edge function which reads
-- the active row for the tenant slug and redirects to the IdP.
--
-- SECURITY: the metadata_url and discovery_url are stored as plain text
-- because they are public IdP discovery endpoints, not secrets. The
-- `idp_certificate` field MAY be private (some SAML IdPs sign with a
-- private cert) and is therefore encrypted at rest by the application
-- layer via the same column-pgcrypto scheme used in 00053.
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

-- institution_admin+ of the tenant may read their own config; admin may read all.
DROP POLICY IF EXISTS tenant_sso_configs_select ON public.tenant_sso_configs;
CREATE POLICY tenant_sso_configs_select ON public.tenant_sso_configs
  FOR SELECT
  TO authenticated
  USING (
    public.current_role_in_tenant(tenant_id, ARRAY['director', 'institution_admin'])
    OR public.current_role_global() = 'admin'
  );

-- Writes are restricted to platform admins only (the sso-callback edge
-- function uses the service role and bypasses RLS).
DROP POLICY IF EXISTS tenant_sso_configs_write ON public.tenant_sso_configs;
CREATE POLICY tenant_sso_configs_write ON public.tenant_sso_configs
  FOR ALL
  TO authenticated
  USING (public.current_role_global() = 'admin')
  WITH CHECK (public.current_role_global() = 'admin');

-- updated_at trigger
DROP TRIGGER IF EXISTS tenant_sso_configs_touch ON public.tenant_sso_configs;
CREATE TRIGGER tenant_sso_configs_touch
  BEFORE UPDATE ON public.tenant_sso_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
