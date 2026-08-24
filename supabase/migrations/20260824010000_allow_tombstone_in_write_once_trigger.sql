-- ============================================================================
-- FIX: allow soft-delete (deleted_at) on case_entries despite
-- write_once_submitted_check trigger.
--
-- Cycle 4 added RLS policies permitting residents/supervisors to set
-- deleted_at, but the BEFORE UPDATE trigger write_once_submitted_check()
-- (00023, latest def) still raises "Cannot modify case entry once submitted"
-- for any resident touch of a non-draft row — including pure tombstones — so
-- mobile offline deletes still fail with 42501 and tenants remain wedged at
-- their quota cap.
--
-- Fix: let a PURE tombstone through — the only allowed column change is
-- deleted_at (NULL -> timestamp) plus updated_at; status and all clinical
-- fields must be untouched. Residents can tombstone own non-draft rows;
-- supervisor+ can tombstone any tenant row. Draft rows were already mutable,
-- nothing changes there. Supervisor path skips the resident branch entirely
-- (trigger only raises when v_role='resident').
--
-- Also fixes: supervisor tombstone of tenant rows was failing because the
-- trigger's get_user_role() is 'supervisor' → no raise → but 403 was RLS.
-- After cycle-4 policies + this trigger fix, both paths work.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_user_role();

  -- Pure soft-delete tombstone: only deleted_at (and updated_at) may change.
  -- Allow it here so offline sync deletes and admin cleanup work; RLS still
  -- scopes WHO may tombstone which rows.
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
    -- Allow rejected→draft transition (resubmit after supervisor rejection)
    IF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;

    -- Block all other modifications to non-draft entries
    IF OLD.status != 'draft' THEN
      RAISE EXCEPTION 'Cannot modify case entry once submitted (status: %). Only rejected cases can be edited for resubmission.', OLD.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
