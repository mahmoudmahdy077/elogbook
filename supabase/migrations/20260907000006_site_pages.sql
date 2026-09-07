-- ============================================================================
-- 20260907000006_site_pages.sql (T24)
--
-- Editorial content model: site_pages (scope, locale, stable slug) +
-- immutable site_page_revisions (validated structured content) with a
-- single published-revision pointer. Scope combinations are CHECK-
-- enforced (never nullable-ambiguous); drafts never leak (RLS
-- deny-by-default; public reads go through a dedicated published-only
-- path in T25). History is never rewritten: publish/revert only repoint.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.site_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('platform', 'tenant')),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  published_revision_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_pages_scope_valid CHECK (
    (scope = 'platform' AND tenant_id IS NULL) OR
    (scope = 'tenant' AND tenant_id IS NOT NULL)
  )
);

-- NULL tenant_ids never conflict in a plain UNIQUE constraint, so
-- canonical addresses get partial indexes: platform scope is global,
-- tenant scope is per-tenant.
CREATE UNIQUE INDEX IF NOT EXISTS site_pages_platform_slug_uidx
  ON public.site_pages (slug, locale) WHERE scope = 'platform';
CREATE UNIQUE INDEX IF NOT EXISTS site_pages_tenant_slug_uidx
  ON public.site_pages (tenant_id, slug, locale) WHERE scope = 'tenant';

CREATE TABLE IF NOT EXISTS public.site_page_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.site_pages(id) ON DELETE CASCADE,
  content JSONB NOT NULL DEFAULT '{"blocks":[]}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  author_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.site_pages
  ADD CONSTRAINT site_pages_published_fk
  FOREIGN KEY (published_revision_id) REFERENCES public.site_page_revisions(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_revisions ENABLE ROW LEVEL SECURITY;
-- No policies: deny direct reads/writes for anon/authenticated by default.
-- Server-side code uses the service-role client; the T25 public renderer
-- serves published revisions only through its own audited path.
