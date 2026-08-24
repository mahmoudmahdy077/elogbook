-- ============================================================================
-- HOTFIX follow-up to 20260824010000: that migration was already recorded in
-- supabase_migrations.remote_schema_hashes, so editing the file locally never
-- re-applied. The applied version still calls get_user_role() unqualified,
-- which fails under search_path='' with 42883 "function get_user_role() does
-- not exist" — breaking ALL case_entries updates.
--
-- This new migration re-creates the function with public.get_user_role().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.get_user_role();

  -- Pure soft-delete tombstone: only deleted_at (and updated_at) may change.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.field_values IS DISTINCT FROM OLD.field_values
       OR NEW.accreditation_mappings IS DISTINCT FROM OLD.accreditation_mappings
       OR NEW.patient_mrn IS DISTINCT FROM OLD.patient_mrn
       OR NEW.patient_dob IS DISTINCT FROM OLD.patient_dob
       OR NEW.patient_age_years IS DISTINCT FROM OLD.patient_age_years
       OR NEW.patient_hash IS DISTINCT FROM OLD.patient_hash
       OR NEW.case_date IS DISTINCT FROM OLD.case_date
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.is_deidentified IS DISTINCT FROM OLD.is_deidentified THEN
      RAISE EXCEPTION 'Soft-delete must not alter case content'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF v_role = 'resident' THEN
    IF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;
    IF OLD.status != 'draft' THEN
      RAISE EXCEPTION 'Cannot modify case entry once submitted (status: %). Only rejected cases can be edited for resubmission.', OLD.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
