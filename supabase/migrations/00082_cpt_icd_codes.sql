-- ============================================================================
-- 00082_cpt_icd_codes.sql
--
-- Phase 1 — CPT/ICD code library and case-to-procedure linkage.
-- Closes gap vs SurgLog and MedHub.
--
-- Creates:
--   1. procedure_codes table — shared medical reference codes (CPT, ICD-10, SNOMED)
--   2. ALTER case_entries — add procedure_codes column with GIN index
--
-- NOTE: procedure_codes is PUBLIC reference data shared across all tenants.
-- No tenant_id column and no RLS — intentionally open for search.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Procedure codes table (public reference data — no tenant isolation)
-- ---------------------------------------------------------------------------
CREATE TABLE public.procedure_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  code_system TEXT NOT NULL CHECK (code_system IN ('cpt', 'icd10', 'snomed')),
  description TEXT NOT NULL,
  category    TEXT,
  rvu         NUMERIC(5,2),
  parent_code TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.procedure_codes IS
  'Shared medical procedure/diagnosis code reference (CPT, ICD-10, SNOMED) — public to all tenants';
COMMENT ON COLUMN public.procedure_codes.rvu IS
  'Relative Value Unit for CPT codes (work RVU)';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_procedure_codes_unique
  ON public.procedure_codes(code, code_system);
CREATE INDEX IF NOT EXISTS idx_procedure_codes_search
  ON public.procedure_codes
  USING gin (to_tsvector('english', code || ' ' || description));
CREATE INDEX IF NOT EXISTS idx_procedure_codes_category
  ON public.procedure_codes(category);

-- ---------------------------------------------------------------------------
-- 3. Link case_entries to procedure codes
-- ---------------------------------------------------------------------------
ALTER TABLE public.case_entries
  ADD COLUMN IF NOT EXISTS procedure_codes TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_case_entries_proc_codes
  ON public.case_entries
  USING gin (procedure_codes);
