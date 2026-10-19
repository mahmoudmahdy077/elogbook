-- 20260930000002_evaluation_form_insert_aal2.sql
--
-- SEC-010 completion: a privileged evaluation_forms INSERT is a signed clinical
-- record and now requires a live AAL2 principal, exactly like the UPDATE path
-- introduced in 20260927000002.
--
-- The gap: 20260927000002 attached the AAL2 gate to
-- authorize_evaluation_form_update(), which is bound BEFORE UPDATE only. The
-- INSERT direction was left with the RLS policy from 20260923000003, which
-- admits any supervisor/director/institution_admin row in the tenant at any
-- assurance level, and enforce_evaluation_form_status() (20260826200000)
-- deliberately permits status='completed' on insert because "the evaluator
-- submits directly".
--
-- The reachable effect was a one-request bypass of the control that same change
-- set introduced: an AAL1 privileged session could file a completed, signed
-- evaluation with arbitrary scores for any resident in the tenant, with no
-- step-up attestation and no command ledger. Every sibling table in 20260927000002
-- binds its guard to INSERT OR UPDATE
-- (trg_authorize_faculty_eval_write, trg_authorize_rotation_write), so this is
-- the one direction the file's own design left open.
--
-- The evaluator and subject branches are unchanged. Both are resident-facing
-- workflows that the update guard already carries verbatim, and neither can
-- reach this trigger through the privileged branch: eval_forms_insert admits
-- only supervisor/director/institution_admin, so an ordinary evaluator authoring
-- their own form is not affected by the AAL2 requirement below. Non-privileged
-- authenticated callers are refused by the policy before this trigger is
-- reached; the refusal is restated here so the trigger is not silently
-- permissive if the policy is ever widened.
--
-- Fail-closed: an evaluation that cannot be attributed to a re-authenticated
-- privileged principal is refused rather than attributed to the role label alone.

-- ---------------------------------------------------------------------------
-- 1. Insert-direction guard, mirroring the update trigger's privileged branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_evaluation_form_insert()
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

  -- Privileged filing: the same signed record as the privileged edit, so the
  -- same AAL2 claim is required and the tenant must be the caller's own.
  IF v_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    IF NOT public.privileged_clinical_write_authorized(NEW.tenant_id) THEN
      RAISE EXCEPTION 'SEC-010: filing an evaluation requires re-authentication at AAL2'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Being named as the evaluator is not a licence to also be the subject.
    -- The update guard's subject branch refuses the subject's own writes; an
    -- INSERT short-circuits before any other check, so without this a resident
    -- who is also a supervisor could file their own signed evaluation.
    IF v_actor IS NOT NULL AND NEW.resident_id = v_actor THEN
      RAISE EXCEPTION 'SEC-016: the subject of an evaluation cannot file it, including as their own evaluator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
  END IF;

  -- The evaluator filing their own form is a resident-facing workflow and is
  -- intentionally not AAL2-gated (20260826140000 carried it over unchanged),
  -- but it may not retarget: the subject and tenant are fixed at filing time.
  IF v_actor IS NOT NULL AND NEW.evaluator_id = v_actor THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not authorized to file an evaluation'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_evaluation_form_insert() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.authorize_evaluation_form_insert() IS
  'SEC-010: a privileged evaluation_forms INSERT requires a live AAL2 principal in the tenant, and the subject may not file their own evaluation. Completes the gate added for UPDATE in 20260927000002.';

-- ---------------------------------------------------------------------------
-- 2. Bind it. BEFORE INSERT, alongside the existing update and status triggers.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_authorize_evalforms_insert ON public.evaluation_forms;
CREATE TRIGGER trg_authorize_evalforms_insert
  BEFORE INSERT ON public.evaluation_forms
  FOR EACH ROW EXECUTE FUNCTION public.authorize_evaluation_form_insert();

-- ---------------------------------------------------------------------------
-- 3. Detection: the correction ledger and this guard are now asserted too.
--
-- 20260927000003 asserts the secondary clinical guards exist and are enabled so
-- a guard that is present in schema but absent or disabled in the database
-- fails the migration rather than shipping silently. This extends that
-- assertion to the new insert guard and to the faculty correction ledger's
-- append-only trigger, which 20260929000002 added after the assertion was
-- written.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(required.guard_name, ', ' ORDER BY required.guard_name)
  INTO v_missing
  FROM unnest(ARRAY[
    'evaluation_forms:trg_authorize_evalforms_insert',
    'evaluation_forms:trg_authorize_evalforms_update',
    'evaluation_forms:trg_eval_form_status',
    'faculty_evaluation_corrections:trg_faculty_eval_correction_append_only',
    'faculty_evaluations:trg_authorize_faculty_eval_write',
    'rotations:trg_authorize_rotation_write'
  ]) AS required(guard_name)
  LEFT JOIN LATERAL (
    SELECT trigger_record.tgenabled
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgname = split_part(required.guard_name, ':', 2)
      AND trigger_record.tgrelid = format('public.%I', split_part(required.guard_name, ':', 1))::regclass
      AND NOT trigger_record.tgisinternal
  ) AS found ON true
  WHERE found.tgenabled IS NULL OR found.tgenabled NOT IN ('O', 'A');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-012: secondary clinical write guards are missing or disabled: %', v_missing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Re-assert that the correction ledger is append-only at the database level,
-- not only in the migration that introduced it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.faculty_evaluation_corrections ENABLE TRIGGER trg_faculty_eval_correction_append_only';
END $$;
