-- FIX: correct single-backslash PG regex word boundaries (previous file had doubled backslashes, making patterns unmatchable).

CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  IF NEW.is_deidentified = true AND (
    v_text ~ '\m\d{6,}\m' OR
    v_text ~ '\d{4}-\d{2}-\d{2}' OR
    v_text ~ '\d{2}/\d{2}/\d{4}'
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
