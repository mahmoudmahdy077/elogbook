-- ============================================================================
-- 00023: Fix write_once_submitted_check to allow rejected→draft transition
--
-- The write_once_submitted_check trigger blocks residents from modifying
-- any non-draft entry. But enforce_case_status_transition (00011) allows
-- rejected→draft. Since write_once_submitted_check fires first (BEFORE UPDATE),
-- it blocks the resubmit. This fix allows the transition.
-- ============================================================================

CREATE OR REPLACE FUNCTION write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_user_role();

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
