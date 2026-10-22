-- ============================================================================
-- 20261022000000_reflections.sql
-- P0-2: Reflective-practice module (competitive-gap-mapping must-have #8).
--
-- Structured reflective-practice entries per user (resident + faculty):
-- free-text reflection, an ACGME-style category, optional link to the case
-- that prompted it, and an optional AI prompt used to seed writing. A
-- `shared` flag lets the author expose the entry to program leadership
-- (director / institution_admin / admin) — reviewers never see private
-- reflections unless the author opts in.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.case_entries(id) ON DELETE SET NULL,
  reflection_type TEXT NOT NULL
    CHECK (reflection_type IN ('clinical','procedural','communication','teamwork','ethics','other')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  prompt TEXT,
  shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reflections_tenant_author
  ON public.reflections(tenant_id, author_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reflections_tenant_type
  ON public.reflections(tenant_id, reflection_type)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reflections_case
  ON public.reflections(case_id)
  WHERE case_id IS NOT NULL;

ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reflections FORCE ROW LEVEL SECURITY;

-- Tenant isolation applies to every operation (auth user context).
CREATE POLICY reflections_tenant_isolation ON public.reflections
  FOR ALL USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- Read: your own entries, plus shared entries if you hold program-leadership
-- role. Private entries stay private to the author.
CREATE POLICY reflections_select ON public.reflections
  FOR SELECT USING (
    author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR (
      shared
      AND get_user_role() IN ('director','institution_admin','admin')
    )
  );

-- Insert: author = self, any authenticated tenant member with a valid role.
CREATE POLICY reflections_insert_own ON public.reflections
  FOR INSERT WITH CHECK (
    author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND get_user_role() IN ('resident','supervisor','director','institution_admin','admin')
  );

-- Update: author edits their own; program leadership can edit shared entries
-- (e.g. correct portfolio metadata). Authors cannot un-share silently edited
-- content: updates keep author_id/tenant_id immutable by only touching the
-- editable columns at the API layer — RLS still gates who may run it.
CREATE POLICY reflections_update ON public.reflections
  FOR UPDATE USING (
    author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR (
      shared
      AND get_user_role() IN ('director','institution_admin','admin')
    )
  );

-- Delete: author deletes their own; program leadership deletes shared entries.
CREATE POLICY reflections_delete ON public.reflections
  FOR DELETE USING (
    author_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR (
      shared
      AND get_user_role() IN ('director','institution_admin','admin')
    )
  );

DROP TRIGGER IF EXISTS set_reflections_updated_at ON public.reflections;
CREATE TRIGGER set_reflections_updated_at BEFORE UPDATE ON public.reflections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

REVOKE ALL ON public.reflections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reflections TO authenticated;
