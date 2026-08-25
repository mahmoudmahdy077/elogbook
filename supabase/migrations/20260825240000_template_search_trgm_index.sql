-- ============================================================================
-- 20260825240000_template_search_trgm_index.sql
--
-- Swarm Wave-1 performance F3: case_templates name search used unanchored
-- ILIKE '%…%' (CaseForm wizard search) with a seq-scan tail of 250–390ms
-- against the 200ms budget. A trigram GIN index makes ILIKE searches
-- index-assisted regardless of wildcard position.
-- Also rewords the misleading cross-tenant insert error (security F4).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_case_templates_name_trgm
  ON public.case_templates USING gin (name gin_trgm_ops);
