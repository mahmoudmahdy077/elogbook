-- ============================================================================
-- 20260907000005_tenant_theme_revisions.sql (T22)
--
-- Versioned tenant theme history. tenants.custom_branding remains the
-- single published pointer consumed at initial render (T21); every
-- publication archives a revision here so any version can be reverted to
-- without reconstructing values. RLS deny-by-default (no policies);
-- server-side code uses the service-role client.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_theme_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version INT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, version)
);

ALTER TABLE public.tenant_theme_revisions ENABLE ROW LEVEL SECURITY;
-- No policies: deny direct reads/writes for anon/authenticated by default.
