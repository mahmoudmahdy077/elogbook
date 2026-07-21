-- SEC2-007: Catch PHI in field_values even when is_deidentified=true
CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  -- Patterns: 6+ digit numbers (MRN-like), DOB date patterns
  IF NEW.is_deidentified = true AND (
    v_text ~ '\m\d{6,}\m' OR  -- 6+ digit MRN-like
    v_text ~ '\d{4}-\d{2}-\d{2}' OR  -- ISO date
    v_text ~ '\d{2}/\d{2}/\d{4}'  -- slash date
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_scan_field_values_phi BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
