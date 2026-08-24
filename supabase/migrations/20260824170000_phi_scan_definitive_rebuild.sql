-- FIX: definitive rebuild of PHI-scan guard. Drops function entirely and recreates
-- with E'' escape-string syntax so backslashes are unambiguous regardless of
-- standard_conforming_strings.

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
DROP FUNCTION IF EXISTS public.scan_field_values_for_phi();

CREATE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  IF NEW.is_deidentified = true AND (
    v_text ~ E'\\m\\d{6,}\\m' OR
    v_text ~ E'\\d{4}-\\d{2}-\\d{2}' OR
    v_text ~ E'\\d{2}/\\d{2}/\\d{4}'
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
