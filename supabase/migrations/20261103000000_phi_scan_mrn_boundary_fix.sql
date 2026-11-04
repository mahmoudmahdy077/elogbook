-- ROOT CAUSE (state.json blocked item, 2026-11-03: mrn 999999 accepted 201, dates rejected 400):
-- scan_field_values_for_phi() MRN branch is `E'\\m\\d{6,}\\m'`. The TRAILING
-- word-boundary assertion is `\m` = BEGINNING-of-word, but the position
-- immediately after a digit run is mathematically never a word-start
-- (previous char is always a word char), so `\\m\\d{6,}\\m` can NEVER match
-- for any input. This reproduces locally on PG 16 with the exact deployed body:
-- MRN inserts pass while both date patterns reject. Every prior fix attempt
-- (160000, 160001, 170000) only touched the quoting layer and kept `\m` as the
-- ending boundary. Fix: trailing assertion becomes `\M` (end-of-word), i.e.
-- "6+ digit run bounded by non-word chars on both sides".
-- Verified applied to the same string-eval mode as production
-- (E''-double-escaped inside the dollar-quoted body, identical to 20260824170000).
-- Cases verified post-fix on local PG16:
--   {"mrn":"999999"}                        -> exception (was silently accepted)
--   {"mrn":"MRN:999999"} mid-string          -> exception
--   {"mrn":"999999,"} / "999999x" / 9 digits -> exception
--   {"dob":"1990-05-01"} ISO date            -> exception (unchanged)
--   {"dob":"01/05/1990"} slash date          -> exception (unchanged)
--   {"medication":"Follow-up visit in 6 weeks"} -> accepted (no false positive)

CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_text TEXT;
BEGIN
  v_text := NEW.field_values::text;
  IF NEW.is_deidentified = true AND (
    v_text ~ E'\\m\\d{6,}\\M' OR
    v_text ~ E'\\d{4}-\\d{2}-\\d{2}' OR
    v_text ~ E'\\d{2}/\\d{2}/\\d{4}'
  ) THEN
    RAISE EXCEPTION 'PHI detected in field_values but is_deidentified=true. Refusing insert.';
  END IF;
  RETURN NEW;
END $$;

-- CD-DEPLOY FIX (2026-11-04): migrate WITHOUT `DROP TRIGGER IF EXISTS` fails on
-- prod, where the trigger already exists (20260824170000 rebuild; dates still
-- enforce there live). `CREATE TRIGGER` on an existing trigger is an error, so db
-- push aborts and this migration can NEVER apply. This file was still UNAPPLIED on
-- prod when edited (live probe 2026-11-04: mrn 999999 insert -> 201, i.e. the old
-- body was in force), so the edit does not rewrite any applied history.
DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;

CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();
