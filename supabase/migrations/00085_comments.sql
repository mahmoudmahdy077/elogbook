-- ============================================================================
-- 00085_comments.sql
--
-- Phase 1 — Comment threads on case entries and evaluation forms.
--
-- Creates:
--   1. comments table — threaded comments with polymorphic parent
--      (entry_id or evaluation_id) and self-referential threading
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Comments table (threaded)
-- ---------------------------------------------------------------------------
CREATE TABLE public.comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id      UUID REFERENCES public.case_entries(id) ON DELETE CASCADE,
  evaluation_id UUID REFERENCES public.evaluation_forms(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  parent_id     UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CHECK (entry_id IS NOT NULL OR evaluation_id IS NOT NULL)
);

COMMENT ON TABLE public.comments IS
  'Threaded comments on case entries and evaluation forms (max nesting depth: 2)';
COMMENT ON COLUMN public.comments.parent_id IS
  'Self-referential FK for threaded replies (NULL = top-level comment)';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_comments_entry
  ON public.comments(entry_id);
CREATE INDEX IF NOT EXISTS idx_comments_evaluation
  ON public.comments(evaluation_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON public.comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_tenant
  ON public.comments(tenant_id);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

CREATE POLICY comments_tenant ON public.comments
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_comments_updated_at ON public.comments;
CREATE TRIGGER set_comments_updated_at
  BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_comments ON public.comments;
CREATE TRIGGER trg_audit_comments
  AFTER INSERT OR UPDATE OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');
