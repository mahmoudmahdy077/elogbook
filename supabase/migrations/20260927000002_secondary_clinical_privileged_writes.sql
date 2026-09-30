-- ============================================================================
-- 20260927000002_secondary_clinical_privileged_writes.sql
--
-- AAL2 on privileged edits to the secondary clinical tables, consistent with
-- the case_entries command boundary.
--
-- Root cause this migration closes
-- ------------------------------
-- 20260923000011 put AAL2 on the *functions* that perform privileged clinical
-- work. The state machines and row policies underneath them were left with role
-- checks only, so AAL2 was advisory on the tables that carry the same clinical
-- record as case_entries:
--
--   * authorize_evaluation_form_update() (20260826140000) returned NEW
--     unconditionally for supervisor/director/institution_admin/admin. Any such
--     session at any assurance level could rewrite an evaluation's scores,
--     feedback and subject. The status guard (20260826200000) blocks edits to an
--     ACKNOWLEDGED form, so the reachable target was the completed->completed
--     window -- precisely the pre-acknowledgement score correction path, which
--     is the one that has to be attributable to a re-authenticated principal.
--
--   * faculty_evaluations had no write guard at all. Its policy
--     (00070, reshaped in 00072) is tenant-wide FOR ALL, so any authenticated
--     member of the tenant could INSERT, UPDATE or DELETE another member's
--     faculty evaluation, including the scores that feed
--     resident_evaluation_averages. It also had no status/attestation concept,
--     so there was no immutable window to protect.
--
--   * rotations_* policies required director/institution_admin but no AAL2, so
--     scheduling writes -- which decide which service a resident is credited
--     with -- were available to a session that had merely not expired.
--
-- Design
-- ------
-- Same shape as the case_entries boundary, and the same deliberate exclusions:
--
--   * A principal with no authenticated identity (auth.uid() IS NULL --
--     migration replay, table owner, maintenance jobs) is governed by its own
--     checks. The AAL2 guard does not apply to it, so nothing here breaks a
--     migration, a seed, or a retention job.
--
--   * Resident-authored draft work is untouched. The evaluation_forms
--     evaluator branch and the subject-acknowledgement branch still run exactly
--     as 20260826140000 defined them, because those are the resident-facing
--     workflows: an evaluator writing their own form, and a subject attesting to
--     a completed one. Neither is a privileged edit.
--
--   * A privileged principal with a live AAL2 claim proceeds exactly as before.
--     The change is that the claim is now required, not merely the role label.
--
-- Fail-closed: an evaluation that cannot be attributed to an AAL2 privileged
-- principal is refused rather than attributed to the role label alone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared guard: a privileged clinical edit requires a live AAL2 principal.
--
-- Mirrors clinical_transition_authorized() (20260926000001) for these tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.privileged_clinical_write_authorized(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No authenticated identity: migration replay, the table owner and
  -- maintenance jobs are governed by their own checks, not by a request JWT.
  IF auth.uid() IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id,
    TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.privileged_clinical_write_authorized(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.privileged_clinical_write_authorized(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.privileged_clinical_write_authorized(UUID) IS
  'True when the caller is an unauthenticated maintenance principal, or a live AAL2 privileged principal in this tenant. The single AAL2 gate for secondary clinical table writes.';

-- ---------------------------------------------------------------------------
-- 2. evaluation_forms: AAL2 on the privileged branch only.
--
-- The evaluator and subject branches are carried over verbatim. Only the
-- role-label shortcut is removed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_evaluation_form_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_role TEXT;
BEGIN
  -- system path (no user jwt): allow
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_actor FROM public.profiles WHERE user_id = auth.uid();
  v_role := public.get_user_role();

  -- Privileged edit: the scores, feedback, subject and status of an evaluation
  -- are a signed clinical record, so the role label is not sufficient. A live
  -- AAL2 claim is required and the tenant must be the caller's own.
  IF v_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    IF NOT public.privileged_clinical_write_authorized(NEW.tenant_id) THEN
      RAISE EXCEPTION 'SEC-010: privileged evaluation edits require re-authentication at AAL2'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Evaluator of the form: may edit their own content, may not retarget.
  IF v_actor IS NOT NULL AND NEW.evaluator_id = v_actor THEN
    IF NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Evaluator cannot retarget evaluation subject'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Subject resident: acknowledge only, nothing else changes.
  IF v_actor IS NOT NULL AND OLD.resident_id = v_actor THEN
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

COMMENT ON FUNCTION public.authorize_evaluation_form_update() IS
  'SEC-010: privileged evaluation edits require a live AAL2 principal. Evaluator self-edits and subject acknowledgement are unchanged resident-facing workflows.';

-- ---------------------------------------------------------------------------
-- 3. faculty_evaluations: a write guard where there was only a tenant policy.
--
-- The 00072 policy stays (it is what keeps rows tenant-scoped), but it no longer
-- decides WHO may write. A tenant-wide FOR ALL policy means "anyone in the
-- tenant", which is not the same as "the evaluator who wrote it".
--
--   * evaluator of the row  -> may edit while the record is not sealed, and may
--     not retarget resident or tenant
--   * privileged principal  -> requires AAL2
--   * subject resident      -> refused; faculty assessment is not the subject's
--     to write, and this table has no acknowledgement step to model
--   * anyone else           -> refused
--
-- There is no status column on this table, so "sealed" is expressed as a
-- write-once rule on the score columns: a faculty evaluation's scores are
-- corrected by filing a new evaluation, exactly as the acknowledged
-- evaluation_forms path requires. Without that, "the subject is a privileged
-- principal with a stale session" is the whole attack.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_actor FROM public.profiles WHERE user_id = auth.uid();
  v_role := public.get_user_role();

  IF v_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    IF NOT public.privileged_clinical_write_authorized(NEW.tenant_id) THEN
      RAISE EXCEPTION 'SEC-010: privileged faculty evaluation writes require re-authentication at AAL2'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Evaluator: may write the assessment they are making.
  IF v_actor IS NOT NULL AND NEW.evaluator_id = v_actor THEN
    -- Being named as the evaluator is not a licence to also be the subject.
    -- The subject branch below refuses the subject's own writes, and an
    -- INSERT short-circuits to RETURN NEW before any other check, so a
    -- resident who filed themselves as the evaluator would otherwise write
    -- their own record -- on a table whose scores feed
    -- resident_evaluation_averages.
    IF NEW.resident_id = v_actor THEN
      RAISE EXCEPTION 'SEC-016: the subject of an evaluation cannot write it, including as their own evaluator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    IF NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Evaluator cannot retarget a faculty evaluation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Write-once scores. A correction is a new evaluation, so the averages a
    -- program reports cannot be edited in place after the fact.
    IF NEW.clinical_skills IS DISTINCT FROM OLD.clinical_skills
       OR NEW.professionalism IS DISTINCT FROM OLD.professionalism
       OR NEW.procedures IS DISTINCT FROM OLD.procedures THEN
      RAISE EXCEPTION 'SEC-011: faculty evaluation scores are write-once; file a new evaluation to correct them'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- The subject of the evaluation has no path into this table: there is no
  -- acknowledgement step here, so any write by the subject would be an
  -- unattributed edit to their own record.
  RAISE EXCEPTION 'Not authorized to modify this faculty evaluation'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_authorize_faculty_eval_write ON public.faculty_evaluations;
CREATE TRIGGER trg_authorize_faculty_eval_write
  BEFORE INSERT OR UPDATE ON public.faculty_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.authorize_faculty_evaluation_write();

COMMENT ON FUNCTION public.authorize_faculty_evaluation_write() IS
  'SEC-010/SEC-011: privileged faculty evaluation writes require AAL2; evaluator may file and annotate their own; scores are write-once; the subject has no write path.';

-- ---------------------------------------------------------------------------
-- 4. faculty_evaluations DELETE: evaluator of the row, or an AAL2 privileged
--    principal. The subject cannot delete the record of their own assessment.
--
-- Every name this section touches is dropped first. CREATE POLICY has neither
-- OR REPLACE nor IF NOT EXISTS: naming a policy that already exists on the
-- table raises duplicate_object, which aborts the migration and leaves the
-- installation with everything from this file onwards unapplied. The four
-- faculty_evals_* names below were created by 20260923000003, so recreating any
-- of them without dropping it first stops a fresh bootstrap at this line -- and
-- a stop here is invisible to any test that only reads the repository.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_select ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_insert ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_update ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_delete ON public.faculty_evaluations;
-- The names introduced below, dropped as well so a forward re-run of this
-- file reaches the same state rather than the same duplicate_object.
DROP POLICY IF EXISTS faculty_evals_insert_evaluator ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_update_own ON public.faculty_evaluations;
DROP POLICY IF EXISTS faculty_evals_delete_own ON public.faculty_evaluations;

CREATE POLICY faculty_evals_select
  ON public.faculty_evaluations FOR SELECT TO authenticated
  USING (tenant_id = public.get_tenant_id());

CREATE POLICY faculty_evals_insert_evaluator
  ON public.faculty_evaluations FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND evaluator_id = (
      SELECT principal.profile_id
      FROM public.get_authoritative_principal() AS principal
      WHERE principal.profile_status = 'active'
        AND principal.tenant_status = 'active'
      LIMIT 1
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = faculty_evaluations.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY faculty_evals_update_own
  ON public.faculty_evaluations FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND evaluator_id = (
      SELECT principal.profile_id
      FROM public.get_authoritative_principal() AS principal
      WHERE principal.profile_status = 'active'
        AND principal.tenant_status = 'active'
      LIMIT 1
    )
  )
  WITH CHECK (tenant_id = public.get_tenant_id());

CREATE POLICY faculty_evals_delete_own
  ON public.faculty_evaluations FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND evaluator_id = (
      SELECT principal.profile_id
      FROM public.get_authoritative_principal() AS principal
      WHERE principal.profile_status = 'active'
        AND principal.tenant_status = 'active'
      LIMIT 1
    )
  );

-- ---------------------------------------------------------------------------
-- 5. rotations: AAL2 on the privileged scheduling writes.
--
-- The policies stay role-scoped; the trigger adds the assurance requirement so
-- a director session that has simply not been re-authenticated cannot rewrite
-- the schedule that decides a resident's credited service.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_rotation_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Residents read their own rotation; only the privileged roles reach a write
  -- policy at all, so anything that gets here is a privileged edit.
  IF NOT public.privileged_clinical_write_authorized(NEW.tenant_id) THEN
    RAISE EXCEPTION 'SEC-010: rotation scheduling requires re-authentication at AAL2'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_authorize_rotation_write ON public.rotations;
CREATE TRIGGER trg_authorize_rotation_write
  BEFORE INSERT OR UPDATE ON public.rotations
  FOR EACH ROW EXECUTE FUNCTION public.authorize_rotation_write();

COMMENT ON FUNCTION public.authorize_rotation_write() IS
  'SEC-010: rotation scheduling writes require a live AAL2 privileged principal. Reads are unaffected.';

-- ---------------------------------------------------------------------------
-- 6. grants: the new guards are trigger functions, callable only through the
-- trigger, but the helpers they call are pinned the same way as the
-- case_entries equivalents.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.authorize_evaluation_form_update() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.authorize_faculty_evaluation_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.authorize_rotation_write() FROM PUBLIC, anon;
