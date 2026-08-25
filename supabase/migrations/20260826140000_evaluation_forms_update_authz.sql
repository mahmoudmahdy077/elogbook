-- ============================================================================
-- 20260826140000_evaluation_forms_update_authz.sql
--
-- Swarm Wave-7 P1: any resident could modify evaluation forms authored about
-- them by faculty (verified: subject changed overall_score 3.5→5 on a
-- director-authored mini_cex, 204 + persisted). Root cause: tenant-wide
-- FOR UPDATE policy on evaluation_forms.
--
-- Fix: BEFORE UPDATE authorization trigger (mirrors case_entries
-- write-once pattern):
--   * supervisor+            → full control within tenant
--   * evaluator of the form  → may edit own content (cannot retarget
--                              resident/tenant)
--   * subject resident       → may ONLY transition status completed →
--                              acknowledged (MSF acknowledgement flow);
--                              every other change is rejected
--   * anyone else            → rejected
-- DELETE policy tightened separately below (was also tenant-wide).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.authorize_evaluation_form_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor UUID;
  v_role TEXT;
BEGIN
  -- system path (no user jwt): allow
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_actor FROM public.profiles WHERE user_id = auth.uid();
  v_role := public.get_user_role();

  IF v_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN NEW;
  END IF;

  IF v_actor IS NOT NULL AND NEW.evaluator_id = v_actor THEN
    IF NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Evaluator cannot retarget evaluation subject'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF v_actor IS NOT NULL AND OLD.resident_id = v_actor THEN
    -- Subject may ONLY acknowledge (from pending or completed); nothing else changes.
    IF NEW.status = 'acknowledged'
       AND OLD.status IN ('completed', 'pending')
       AND NEW.ratings IS NOT DISTINCT FROM OLD.ratings
       AND NEW.overall_score IS NOT DISTINCT FROM OLD.overall_score
       AND NEW.feedback IS NOT DISTINCT FROM OLD.feedback
       AND NEW.action_plan IS NOT DISTINCT FROM OLD.action_plan
       AND NEW.form_type IS NOT DISTINCT FROM OLD.form_type
       AND NEW.encounter_date IS NOT DISTINCT FROM OLD.encounter_date
       AND NEW.setting IS NOT DISTINCT FROM OLD.setting
       AND NEW.patient_context IS NOT DISTINCT FROM OLD.patient_context
       AND NEW.evaluator_id IS NOT DISTINCT FROM OLD.evaluator_id
       AND NEW.resident_id IS NOT DISTINCT FROM OLD.resident_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Subjects may only acknowledge completed evaluations'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RAISE EXCEPTION 'Not authorized to modify this evaluation'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_authorize_evalforms_update ON public.evaluation_forms;
CREATE TRIGGER trg_authorize_evalforms_update
  BEFORE UPDATE ON public.evaluation_forms
  FOR EACH ROW EXECUTE FUNCTION public.authorize_evaluation_form_update();

-- DELETE was equally open: restrict to evaluator-of-form or supervisor+
DROP POLICY IF EXISTS eval_forms_delete ON public.evaluation_forms;
CREATE POLICY eval_forms_delete ON public.evaluation_forms
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND (
      evaluator_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );
