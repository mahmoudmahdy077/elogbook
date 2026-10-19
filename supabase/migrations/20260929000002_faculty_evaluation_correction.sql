-- ============================================================================
-- 20260929000002_faculty_evaluation_correction.sql
--
-- A supported correction for a faculty evaluation, and the removal of every
-- other way to change one.
--
-- The problem this closes
-- ----------------------
-- 20260927000002 made faculty evaluation scores write-once for the evaluator
-- (SEC-011) and required AAL2 for a privileged write (SEC-010). Fail-closed, and
-- with no supported answer to a real question: a score entered in good faith and
-- filed cannot be fixed. The only route left was to file a second evaluation,
-- which changes the count a program reports as well as the average -- so the
-- "correction" destroys the very record it is meant to repair.
--
-- The alternative is "let an administrator UPDATE it", and that is a bypass
-- wearing a lanyard. A role label plus a fresh MFA is not an accountable
-- correction; it is an unattributed rewrite with a re-authentication step in
-- front of it. It is also already reachable today: the privileged branch of
-- authorize_faculty_evaluation_write() returned NEW unconditionally, so SEC-011
-- was in practice an evaluator rule and any AAL2 supervisor or director could
-- move a score directly. The write-once rule did not hold where it mattered most.
--
-- Design
-- ------
-- The correction is a command, not a permission.
--
--   * public.correct_faculty_evaluation is the only writer of the score columns.
--     It requires a live AAL2 privileged principal, the caller's own tenant, and
--     the target row inside that tenant. A row in another tenant is reported as
--     not found rather than refused, so the command is not an existence oracle
--     for other institutions.
--
--   * A reason is required and bounded. A correction without a stated reason is
--     not a correction; it is an edit with paperwork.
--
--   * Every correction appends to public.faculty_evaluation_corrections, which
--     records the scores as they were AND the scores as they now are. The
--     original values are therefore preserved immutably: the reported averages
--     can be explained after the fact, not merely changed. That table has no
--     policy and no client grant, and its UPDATE and DELETE are refused
--     unconditionally -- including for the table owner and for superuser. There
--     is no window in which the record of a correction can itself be rewritten.
--
--   * The write guard now refuses a score change for EVERY caller, privileged
--     included. The single exception is a correction the caller filed themselves,
--     in this transaction, recording exactly the values being written, and only
--     while the row does not already hold them. The context flag alone therefore
--     authorises nothing: without a matching record there is nothing to match, and
--     once applied the record cannot be replayed to move a score again.
--
--   * The subject, the evaluator and the tenant are immutable on UPDATE, for
--     every caller and before every branch. 20260927000002 required AAL2 for a
--     privileged write and then returned NEW, so retargeting was a privileged
--     edit rather than a correction: an AAL2 supervisor could move an
--     evaluation onto another resident, another evaluator or another tenant,
--     changing whose assessment the row is without recording a single value in
--     the correction history. A correction records scores, so it cannot account
--     for a retarget; the columns therefore have to be fixed rather than
--     policed. This also closes the "subject as their own evaluator" path, which
--     the INSERT short-circuit in the evaluator branch had left open.
--
--   * DELETE is guarded, which the earlier migration documented but did not
--     implement: it attached the write guard to BEFORE INSERT OR UPDATE only, so
--     a faculty assessment could be removed by any session the row policies
--     admitted -- including an AAL1 supervisor, since a privileged DELETE never
--     reached the trigger at all. The record of an assessment is as clinical as
--     its scores, and removing it leaves no corrected value behind to explain.
--     The guard is the evaluator of the row, or a live AAL2 privileged principal;
--     the subject can neither edit nor delete their own assessment. The
--     authoritative AAL2 delete guard is a BEFORE DELETE trigger added by this
--     migration, which is why it is not in the 20260927000003 trigger inventory:
--     that file is applied before this one.
--
--   * Idempotency is on (tenant_id, idempotency_key). A retried command returns
--     the original correction rather than filing a second one, and reusing a key
--     for a different evaluation is a conflict rather than a silent overwrite.
--
--   * The audit row carries the numbers and the correction id and deliberately
--     NOT the free-text reason. audit_logs is a metadata-only surface
--     (20260927000000), and the reason belongs to the append-only correction
--     record where it can be read in full and cannot be quietly rewritten.
--
-- The error vocabulary is closed and carries no database text: forbidden,
-- invalid_request, reason_required, evaluation_not_found, idempotency_conflict,
-- no_change. Grants: authenticated only -- not anon, not PUBLIC, and not
-- service_role.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The append-only correction history.
-- ---------------------------------------------------------------------------
CREATE TABLE public.faculty_evaluation_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  faculty_evaluation_id UUID NOT NULL
    REFERENCES public.faculty_evaluations(id) ON DELETE CASCADE,
  -- Nullable: a hard profile delete must not be blocked by clinical history, and
  -- a correction whose author no longer exists must not be able to authorise a
  -- write. Durable attribution lives in audit_logs.
  corrected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 8 AND 1000),
  -- The scores as they were. These three columns are the immutability guarantee:
  -- whatever happens to the row, the pre-correction values remain on record.
  original_clinical_skills INTEGER CHECK (original_clinical_skills BETWEEN 1 AND 5),
  original_professionalism INTEGER CHECK (original_professionalism BETWEEN 1 AND 5),
  original_procedures INTEGER CHECK (original_procedures BETWEEN 1 AND 5),
  original_comments TEXT,
  -- The scores as they became. The write guard matches a proposed UPDATE against
  -- these, so a correction authorises exactly one write and only that write.
  corrected_clinical_skills INTEGER CHECK (corrected_clinical_skills BETWEEN 1 AND 5),
  corrected_professionalism INTEGER CHECK (corrected_professionalism BETWEEN 1 AND 5),
  corrected_procedures INTEGER CHECK (corrected_procedures BETWEEN 1 AND 5),
  corrected_comments TEXT,
  -- There is deliberately no free-form metadata column. The record is a reason and
  -- the before/after values, all typed; a bag the command writes unvalidated is a
  -- bag something else can later read as a score.
  idempotency_key TEXT CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT faculty_evaluation_corrections_tenant_key_unique
    UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_faculty_eval_corrections_evaluation
  ON public.faculty_evaluation_corrections (faculty_evaluation_id, created_at DESC);

ALTER TABLE public.faculty_evaluation_corrections ENABLE ROW LEVEL SECURITY;
-- Force as well as enable: p1_16 requires both, and a definer that is the table
-- owner is exactly the case FORCE exists to cover.
ALTER TABLE public.faculty_evaluation_corrections FORCE ROW LEVEL SECURITY;

-- No policies. The command is SECURITY DEFINER and runs as the table owner; every
-- client role is refused by the absence of a policy, which is the intent.

COMMENT ON TABLE public.faculty_evaluation_corrections IS
  'Append-only history of faculty evaluation corrections. Records the scores before and after each correction so the original values survive immutably. No policies, no client grants: reachable only through public.correct_faculty_evaluation().';

-- ---------------------------------------------------------------------------
-- 2. Append-only enforcement. Unconditional -- there is no caller for whom
--    rewriting a correction record is legitimate, the table owner included.
--
--    ON DELETE CASCADE from tenants/faculty_evaluations is unaffected: referential
--    actions are performed by the RI machinery and do not fire user triggers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_faculty_evaluation_correction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'SEC-014: faculty evaluation corrections are append-only'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_faculty_eval_correction_append_only ON public.faculty_evaluation_corrections;
CREATE TRIGGER trg_faculty_eval_correction_append_only
  BEFORE UPDATE OR DELETE ON public.faculty_evaluation_corrections
  FOR EACH ROW EXECUTE FUNCTION public.refuse_faculty_evaluation_correction_mutation();

REVOKE ALL ON FUNCTION public.refuse_faculty_evaluation_correction_mutation() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.refuse_faculty_evaluation_correction_mutation() IS
  'SEC-014: refuses every UPDATE and DELETE on faculty_evaluation_corrections, for every caller including the table owner. The record of a correction is never rewritten.';

-- ---------------------------------------------------------------------------
-- 3. The write guard.
--
--    Three changes from 20260927000002:
--
--    a) The privileged branch no longer returns NEW unconditionally. It required
--       AAL2, which stops a stale session, but it did not stop an authorised one:
--       any AAL2 supervisor or director could move a score directly. SEC-011 is
--       now a property of the column rather than of the caller's role.
--
--    b) The one exception is the correction command, and it is recognised by a
--       record rather than by a flag. The context flag alone is not evidence; a
--       forged set_config buys a caller nothing, because the record it would need
--       to match can only be created by the command -- which requires AAL2, the
--       caller's own tenant, and a stated reason.
--
--    c) resident_id, evaluator_id and tenant_id are immutable on UPDATE, checked
--       before any branch, and the subject cannot write their own record even by
--       naming themselves as the evaluator. Both are properties of the columns,
--       not of a role, so they are enforced for the privileged branch and for the
--       correction command as much as for the evaluator's own edits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
-- pg_catalog first, pg_temp last: the shape p1_16 requires of every public
-- SECURITY DEFINER. The 20260927000002 version used `public, pg_catalog`, which
-- that gate flags, so the final state is corrected here rather than by editing an
-- applied migration. Every name in the body is schema-qualified, so the order
-- changes resolution of nothing.
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_role TEXT;
  v_scores_changed BOOLEAN := FALSE;
BEGIN
  -- No authenticated identity: migration replay, the table owner and maintenance
  -- jobs are governed by their own checks. On an INSERT there is no OLD row, so
  -- nothing has "changed" and neither the write-once rule nor the immutability
  -- rule below applies to filing one.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Who the assessment is about, who made it and whose institution holds it
    -- are the frame around the scores. A caller may annotate or correct inside
    -- that frame; nobody may move the frame. Checked first so it cannot be
    -- reordered behind a branch, and unconditional so the privileged branch and
    -- the correction command are covered by the same rule.
    IF NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.evaluator_id IS DISTINCT FROM OLD.evaluator_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'SEC-015: the subject, the evaluator and the tenant of a faculty evaluation are immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_scores_changed :=
      NEW.clinical_skills IS DISTINCT FROM OLD.clinical_skills
      OR NEW.professionalism IS DISTINCT FROM OLD.professionalism
      OR NEW.procedures IS DISTINCT FROM OLD.procedures;
  END IF;

  SELECT id INTO v_actor FROM public.profiles WHERE user_id = auth.uid();
  v_role := public.get_user_role();

  -- The correction command, and only the correction command. Four things have to
  -- hold: the caller is in command context, the record was filed by this caller,
  -- it was filed in THIS transaction (so a record from an earlier correction
  -- cannot authorise a fresh write), it records exactly the values being written,
  -- and the row does not already hold them (so a record cannot be replayed).
  IF v_scores_changed
     AND COALESCE(current_setting('app.faculty_correction', true), '') = 'on'
     AND EXISTS (
       SELECT 1
       FROM public.faculty_evaluation_corrections AS correction
       WHERE correction.tenant_id = NEW.tenant_id
         AND correction.faculty_evaluation_id = NEW.id
         AND correction.corrected_by = v_actor
         AND correction.created_at >= transaction_timestamp()
         AND correction.corrected_clinical_skills IS NOT DISTINCT FROM NEW.clinical_skills
         AND correction.corrected_professionalism IS NOT DISTINCT FROM NEW.professionalism
         AND correction.corrected_procedures IS NOT DISTINCT FROM NEW.procedures
         AND correction.corrected_comments IS NOT DISTINCT FROM NEW.comments
         AND (
           OLD.clinical_skills IS DISTINCT FROM correction.corrected_clinical_skills
           OR OLD.professionalism IS DISTINCT FROM correction.corrected_professionalism
           OR OLD.procedures IS DISTINCT FROM correction.corrected_procedures
           OR OLD.comments IS DISTINCT FROM correction.corrected_comments
         )
     ) THEN
    RETURN NEW;
  END IF;

  IF v_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    IF NOT public.privileged_clinical_write_authorized(NEW.tenant_id) THEN
      RAISE EXCEPTION 'SEC-010: privileged faculty evaluation writes require re-authentication at AAL2'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- The privileged branch annotates freely; it does not re-score. A score moves
    -- only through public.correct_faculty_evaluation, which is the difference
    -- between a correction that is attributable and one that is merely allowed.
    IF v_scores_changed THEN
      RAISE EXCEPTION 'SEC-011: faculty evaluation scores are write-once; file a correction instead'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Evaluator: may write the assessment they are making.
  IF v_actor IS NOT NULL AND NEW.evaluator_id = v_actor THEN
    -- Being named as the evaluator is not a licence to also be the subject. The
    -- INSERT short-circuit below returns NEW before anything else is checked, so
    -- without this a resident could file an assessment of themselves -- the one
    -- write the subject branch below exists to refuse, and the one whose scores
    -- feed resident_evaluation_averages.
    IF NEW.resident_id = v_actor THEN
      RAISE EXCEPTION 'SEC-016: the subject of an evaluation cannot write it, including as their own evaluator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    -- Write-once scores, for the evaluator as for everyone else. A correction is
    -- a new evaluation OR a recorded correction; neither is an in-place rewrite.
    IF v_scores_changed THEN
      RAISE EXCEPTION 'SEC-011: faculty evaluation scores are write-once; file a new evaluation or a correction'
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

COMMENT ON FUNCTION public.authorize_faculty_evaluation_write() IS
  'SEC-010/SEC-011/SEC-015/SEC-016: scores are write-once for every caller, privileged included; the subject, evaluator and tenant are immutable on update; the subject cannot write their own record. A score moves only through public.correct_faculty_evaluation(), recognised by a correction record the caller filed in this transaction recording exactly those values. The evaluator annotates their own row.';

-- ---------------------------------------------------------------------------
-- 4. The DELETE guard, implementing the rule 20260927000002 documented.
--
--    A faculty assessment is a signed clinical record. Removing one is not a
--    lesser edit than correcting it: it is the only write that leaves nothing
--    behind to explain, and the reported averages cannot then be reconciled with
--    the evaluations that produced them.
--
--    Three paths, and no fourth:
--      * no authenticated identity -- migration replay, the table owner, a
--        retention job. Governed by their own checks, not by a request JWT.
--      * the evaluator of the row, at either assurance level: they filed it and
--        they may withdraw it, which is the same relationship the row policies
--        (faculty_evals_delete_own) already encode.
--      * a live AAL2 privileged principal in the row's own tenant, through the
--        shared secondary-write gate. A stale session is refused, and a
--        cross-tenant one is refused by that gate rather than by this function.
--
--    The subject is not on the list. A resident cannot remove the record of their
--    own assessment, exactly as they cannot edit it.
--
--    ON DELETE CASCADE from tenants and from the correction history is
--    unaffected: referential actions are performed by the RI machinery and do
--    not fire user triggers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_faculty_evaluation_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;

  SELECT id INTO v_actor FROM public.profiles WHERE user_id = auth.uid();

  IF v_actor IS NOT NULL AND OLD.evaluator_id = v_actor THEN
    RETURN OLD;
  END IF;

  IF NOT public.privileged_clinical_write_authorized(OLD.tenant_id) THEN
    RAISE EXCEPTION 'SEC-010: removing a faculty evaluation requires re-authentication at AAL2'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_authorize_faculty_eval_delete ON public.faculty_evaluations;
CREATE TRIGGER trg_authorize_faculty_eval_delete
  BEFORE DELETE ON public.faculty_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.authorize_faculty_evaluation_delete();

-- Reachable only through the trigger, as with the write guard. p1_16 requires a
-- public SECURITY DEFINER to have no effective PUBLIC or anon execute grant.
REVOKE ALL ON FUNCTION public.authorize_faculty_evaluation_delete() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.authorize_faculty_evaluation_delete() IS
  'SEC-010: removing a faculty evaluation requires the evaluator of the row or a live AAL2 privileged principal in its tenant. The subject cannot delete the record of their own assessment.';

-- ---------------------------------------------------------------------------
-- 5. The command.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_faculty_evaluation(
  p_tenant_id UUID,
  p_evaluation_id UUID,
  p_reason TEXT,
  p_correction JSONB DEFAULT '{}'::JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_target RECORD;
  v_existing RECORD;
  v_correction_id UUID;
  v_reason TEXT;
  v_key TEXT;
  v_clinical_skills INTEGER;
  v_professionalism INTEGER;
  v_procedures INTEGER;
  v_comments TEXT;
  v_raw TEXT;
BEGIN
  -- No identity, no correction. auth.role() is checked as well as auth.uid() so a
  -- service_role key without a subject cannot reach this.
  IF auth.uid() IS NULL
     OR COALESCE(auth.role(), 'authenticated') IS DISTINCT FROM 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_tenant_id IS NULL OR p_evaluation_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  -- AAL2 privileged, in the caller's own tenant. This is the attribution: a
  -- correction has to name a person who re-authenticated, or it is not one.
  IF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id,
    TRUE
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;
  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- The reason. Bounded at both ends: an empty string is not a reason, and a
  -- paragraph is not a reason either, it is a place to hide a score.
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL
     OR char_length(v_reason) < 8
     OR char_length(v_reason) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'reason_required');
  END IF;

  -- The correction payload: a closed set of the row's own columns.
  IF p_correction IS NULL OR jsonb_typeof(p_correction) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_correction) AS payload(key)
    WHERE payload.key NOT IN ('clinical_skills', 'professionalism', 'procedures', 'comments')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  -- Each score is validated by shape before it is cast, so a non-numeric or
  -- out-of-range value is a refusal rather than a cast error carrying server text.
  IF p_correction ? 'clinical_skills' THEN
    v_raw := p_correction ->> 'clinical_skills';
    IF v_raw IS NULL OR v_raw !~ '^[1-5]$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    v_clinical_skills := v_raw::INTEGER;
  END IF;

  IF p_correction ? 'professionalism' THEN
    v_raw := p_correction ->> 'professionalism';
    IF v_raw IS NULL OR v_raw !~ '^[1-5]$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    v_professionalism := v_raw::INTEGER;
  END IF;

  IF p_correction ? 'procedures' THEN
    v_raw := p_correction ->> 'procedures';
    IF v_raw IS NULL OR v_raw !~ '^[1-5]$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
    v_procedures := v_raw::INTEGER;
  END IF;

  IF p_correction ? 'comments' THEN
    v_comments := NULLIF(p_correction ->> 'comments', '');
    IF v_comments IS NOT NULL AND char_length(v_comments) > 2000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
    END IF;
  END IF;

  -- Idempotency key, bounded. A key is an identifier, not a payload.
  v_key := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NOT NULL AND char_length(v_key) NOT BETWEEN 8 AND 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  -- Replay first, so a retried command is a lookup rather than a second write.
  -- Checked before the target row: idempotency has to hold even if the row has
  -- since moved on.
  IF v_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.faculty_evaluation_corrections AS prior
    WHERE prior.tenant_id = v_principal.tenant_id
      AND prior.idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.faculty_evaluation_id IS DISTINCT FROM p_evaluation_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'success', true,
        'correction_id', v_existing.id,
        'replayed', true
      );
    END IF;
  END IF;

  -- The target, inside the caller's own tenant. Not found rather than forbidden
  -- so that a row id from another institution is indistinguishable from one that
  -- does not exist.
  SELECT *
  INTO v_target
  FROM public.faculty_evaluations AS target
  WHERE target.id = p_evaluation_id
    AND target.tenant_id = v_principal.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'evaluation_not_found');
  END IF;

  -- Unspecified columns keep their current value, so a correction of one score
  -- records the full corrected triple rather than nulling the other two.
  v_clinical_skills := COALESCE(v_clinical_skills, v_target.clinical_skills);
  v_professionalism := COALESCE(v_professionalism, v_target.professionalism);
  v_procedures := COALESCE(v_procedures, v_target.procedures);
  IF NOT (p_correction ? 'comments') THEN
    v_comments := v_target.comments;
  END IF;

  -- A correction that changes nothing is a record with no correction in it.
  IF v_clinical_skills IS NOT DISTINCT FROM v_target.clinical_skills
     AND v_professionalism IS NOT DISTINCT FROM v_target.professionalism
     AND v_procedures IS NOT DISTINCT FROM v_target.procedures
     AND v_comments IS NOT DISTINCT FROM v_target.comments THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_change');
  END IF;

  INSERT INTO public.faculty_evaluation_corrections (
    tenant_id,
    faculty_evaluation_id,
    corrected_by,
    reason,
    original_clinical_skills,
    original_professionalism,
    original_procedures,
    original_comments,
    corrected_clinical_skills,
    corrected_professionalism,
    corrected_procedures,
    corrected_comments,
    idempotency_key
  )
  VALUES (
    v_principal.tenant_id,
    v_target.id,
    v_principal.profile_id,
    v_reason,
    v_target.clinical_skills,
    v_target.professionalism,
    v_target.procedures,
    v_target.comments,
    v_clinical_skills,
    v_professionalism,
    v_procedures,
    v_comments,
    v_key
  )
  RETURNING id INTO v_correction_id;

  -- Apply, in the context the write guard recognises. The guard still has to find
  -- a record matching these exact values, so the flag is a hint and the record is
  -- the authority.
  PERFORM set_config('app.faculty_correction', 'on', true);

  UPDATE public.faculty_evaluations
  SET clinical_skills = v_clinical_skills,
      professionalism = v_professionalism,
      procedures = v_procedures,
      comments = v_comments
  WHERE id = v_target.id
    AND tenant_id = v_principal.tenant_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.faculty_correction', 'off', true);
    RETURN jsonb_build_object('success', false, 'error', 'evaluation_not_found');
  END IF;

  PERFORM set_config('app.faculty_correction', 'off', true);

  -- Metadata only. The reason is free text and audit_logs is a metadata-only
  -- surface; the full reason is on the correction record, which cannot be
  -- rewritten.
  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes
  )
  VALUES (
    v_principal.tenant_id,
    v_principal.user_id,
    'correct_faculty_evaluation',
    'faculty_evaluations',
    v_target.id,
    jsonb_build_object(
      'correction_id', v_correction_id,
      'original_clinical_skills', v_target.clinical_skills,
      'corrected_clinical_skills', v_clinical_skills,
      'original_professionalism', v_target.professionalism,
      'corrected_professionalism', v_professionalism,
      'original_procedures', v_target.procedures,
      'corrected_procedures', v_procedures
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'correction_id', v_correction_id,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_faculty_evaluation(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.correct_faculty_evaluation(UUID, UUID, TEXT, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.correct_faculty_evaluation(UUID, UUID, TEXT, JSONB, TEXT) IS
  'SEC-011: the only supported way to change a faculty evaluation''s scores. Requires a live AAL2 privileged principal, the caller''s own tenant, a bounded reason, and appends to faculty_evaluation_corrections recording the scores before and after. Idempotent on (tenant, idempotency_key). Error vocabulary is closed: forbidden, invalid_request, reason_required, evaluation_not_found, idempotency_conflict, no_change.';
