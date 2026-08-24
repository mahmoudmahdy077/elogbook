-- ============================================================================
-- FIX: re-assert the PHI-scan guard on case_entries.
--
-- Found Cycle 83 (live probe): a row with is_deidentified=true and
-- field_values containing a 7-digit MRN-like number inserted successfully
-- (201). The 20260721220000 trigger should have refused it. Other triggers
-- on the table (audit) DO fire, so the table isn't trigger-broken — the
-- PHI-scan trigger/function specifically is missing or drifted on the live
-- database. This migration idempotently restores it.
--
-- Semantics unchanged from 20260721220000: refuse INSERT/UPDATE where
-- is_deidentified=true but field_values still contain MRN-like numbers
-- (6+ digits), ISO dates, or slash dates.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  -- Patterns: 6+ digit numbers (MRN-like), DOB date patterns
  IF NEW.is_deidentified = true AND (
    v_text ~ '\m\d{6,}\m' OR      -- 6+ digit MRN-like
    v_text ~ '\d{4}-\d{2}-\d{2}' OR  -- ISO date
    v_text ~ '\d{2}/\d{2}/\d{4}'    -- slash date
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;

CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
