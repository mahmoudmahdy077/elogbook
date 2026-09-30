-- ============================================================================
-- 20260930000001_clinical_tombstone_insert_and_phi_convergence.sql
--
-- Final clinical/PHI review convergence. Forward-only: nothing that was applied
-- is edited here; the one place an applied file is repaired (the PHI scan
-- downgrade) is repaired both in place and re-asserted below.
--
-- What this migration closes
-- -------------------------
-- 1. The approved-record tombstone guard was unreachable.
--    write_once_submitted_check() is SECURITY DEFINER, so inside it
--    `current_user` is the function owner, never `authenticated`, and
--    `current_user = 'authenticated'` could not ever be true. The guard
--    therefore never fired on any path: not on a resident tombstoning their own
--    approved record through submit_case_operation('delete'), and not on a
--    privileged AAL2 caller through soft_delete_case. The discriminator is now
--    `auth.uid()`, which SECURITY DEFINER does not change, and the status check
--    runs on every UPDATE regardless of the role that reaches it.
--
--    There is no AAL2 command path for retracting an approved clinical record in
--    the design (section 6.1 of the clinical-core remediation design defines
--    exactly three commands: save_case_draft, submit_case, decide_case), so the
--    refusal is absolute for every authenticated principal. A principal with no
--    authenticated identity -- the table owner, migration replay, the retention
--    job, the tenant lifecycle cascade -- is unaffected, which is what keeps
--    maintenance and cascade behaviour working.
--
-- 2. The privileged pre-approved INSERT branch is gone, and so is the silent
--    rewrite.
--    enforce_case_insert_status() allowed a supervisor/director/institution_admin
--    at AAL2 to INSERT a case already in `approved`, with no approval request
--    and therefore no approval ledger: an approved record that no command ever
--    decided. The branch is removed. The only tenant type that still approves
--    on INSERT is `individual`, which is a documented, server-side branch.
--    Authenticated callers may now only create a draft; reaching `pending` is
--    submit_case_command's job and reaching `approved` is decide_case_command's.
--
--    The answer a refused insert gives changes with it. The previous definition
--    rewrote NEW.status to 'draft' and returned the row, so a caller that asked
--    for `pending` got success and a draft: the request looked queued for review
--    and was not, and nothing in the response could tell the two apart. A
--    non-draft INSERT from an authenticated principal is now refused with the
--    named error `case_insert_status_not_permitted` (SQLSTATE 42501) and no row
--    is created. The individual auto-approval path and an unauthenticated
--    maintenance principal are unchanged.
--
-- 2b. The operation RPC states the same refusal in its own vocabulary.
--    submit_case_operation returns JSONB rather than raising and wraps the
--    INSERT in `EXCEPTION WHEN OTHERS`, so a refusal reaching it as an exception
--    would be reported as `internal_error` and the resident would be told to
--    retry a request that can never succeed. The insert half of
--    __a2_submit_case_operation refuses a caller-supplied non-draft status with
--    the same `policy: command_boundary` / `state_conflict` the update half
--    already returns for a transition across the boundary. The trigger remains
--    the chokepoint for a direct write.
--
-- 3. soft_delete_case refuses an approved record attributably.
--    The trigger is the authoritative chokepoint, but this RPC returns JSONB
--    rather than raising, so the refusal is also stated in the RPC body. The
--    error contract is unchanged: the same 42501 the AAL2 gate already raises.
--
-- 4. approve_case / reject_case are not an alternate approval path.
--    decide_case_command is the only path out of `pending`, because it resolves
--    one locked approval request in the same transaction as the status change.
--    The two legacy RPCs wrote status and the approval request with no
--    idempotency ledger, no tenant match on the approval request, and no
--    outbox row. No server route calls them, so their authenticated execute
--    grant is revoked. They are not dropped: p1_26 reads their ACL by name and
--    an absent function would raise rather than return a privilege answer.
--
-- 5. The authoritative PHI scan body is re-asserted.
--    20260927000003 had replaced it with a weaker inline regex, dropping the
--    recursive field_values_contain_phi() walk, the unknown-key allowlist and
--    the SECURITY DEFINER/search_path pinning. That file is repaired in place;
--    this section repairs an installation that already applied the downgrade,
--    and then asserts from the catalog that the live body is the authoritative
--    one rather than a regex that merely looks like it.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Approved records are not tombstoneable by any authenticated principal.
--
-- The soft-delete block is unchanged in shape: a tombstone is a pure tombstone,
-- so it may not alter clinical content. The approved check moves from an
-- unreachable `current_user` comparison to `auth.uid() IS NOT NULL`, which is
-- true for a direct REST write, for submit_case_operation and for
-- soft_delete_case alike, and false for the owner, the retention job and
-- migration replay.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.get_user_role();

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

    -- An approved clinical record is a signed record. No authenticated caller
    -- may tombstone one, whatever their role: the resident who owns it through
    -- submit_case_operation('delete'), and a privileged principal through
    -- soft_delete_case. There is no AAL2 command for retracting it, so the
    -- record stays in the register and is removed only by retention, by the
    -- tenant lifecycle cascade, or by the owner of the table.
    IF OLD.status = 'approved' AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Approved clinical records cannot be soft-deleted'
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

COMMENT ON FUNCTION public.write_once_submitted_check() IS
  'Reachable guard: a soft-delete may not alter clinical content, and no authenticated principal may tombstone an approved clinical record. auth.uid(), not current_user, is the discriminator because this function is SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.write_once_submitted_check() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. No privileged pre-approved INSERT, and no silent rewrite.
--
-- Individual tenants keep their documented server-side auto-approval; every
-- other tenant may only create a draft. The privileged-AAL2 branch that let an
-- approval exist with no approval ledger is removed rather than tightened: a
-- status the command boundary owns is not a value a caller supplies.
--
-- What changes alongside it is the answer to a refused insert. The previous
-- definition rewrote NEW.status to 'draft' and returned the row, so a caller
-- that asked for `pending` received success and a draft: the request looked
-- queued for review and was not, and the client had no way to tell. The refusal
-- is now a named error with the same 42501 the rest of the boundary raises, and
-- nothing is written. The two documented exemptions are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_case_insert_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = NEW.tenant_id
      AND tenant_type = 'individual'
  ) THEN
    RETURN NEW;
  END IF;

  -- No authenticated identity: the table owner, migration replay, the retention
  -- job and the pgTAP fixtures that arrange lifecycle states directly. Those
  -- are governed by their own checks, not by a request JWT.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fail closed through the command boundary. An authenticated principal may
  -- create a draft and nothing else: `pending` is submit_case_command's
  -- transition because it creates the approval requests, and `approved` is
  -- decide_case_command's because it resolves one. Named rather than coerced so
  -- the caller learns the status it may not set, and so no row is created that
  -- the caller would read as a queued submission.
  IF NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'case_insert_status_not_permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_case_insert_status() IS
  'SEC-002: an authenticated principal may only create a draft. A non-draft INSERT is refused with case_insert_status_not_permitted (SQLSTATE 42501) rather than rewritten, so a caller cannot read a silent rewrite as a queued submission. Reaching pending or approved is submit_case_command/decide_case_command, so no approval can exist without an approval request. Individual tenants keep their documented server-side auto-approval; unauthenticated maintenance principals are unaffected.';

REVOKE ALL ON FUNCTION public.enforce_case_insert_status() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 2b. The operation RPC states the same refusal in its own vocabulary.
--
-- submit_case_operation returns JSONB rather than raising, and its body wraps
-- the INSERT in EXCEPTION WHEN OTHERS. With the trigger now refusing, a
-- client-supplied non-draft status would surface as internal_error and the
-- resident would be told to retry a request that can never succeed. The insert
-- half therefore refuses the status itself, in the same closed vocabulary the
-- update half already uses for a transition across the command boundary. The
-- trigger remains the chokepoint for a direct write; this is the same division
-- of labour soft_delete_case states for an approved tombstone below.
--
CREATE OR REPLACE FUNCTION public.__a2_submit_case_operation(
  p_op_id TEXT,
  p_action TEXT,
  p_row_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_profile_status TEXT;
  v_tenant_status TEXT;
  v_row public.case_entries%ROWTYPE;
  v_new_id UUID;
  v_result JSONB;
  v_claim TEXT;
  v_claimed_at TIMESTAMPTZ;
  v_key TEXT;
  v_is_deidentified BOOLEAN;
  v_error_code TEXT;
BEGIN
  IF p_op_id IS NULL OR char_length(p_op_id) < 1 OR char_length(p_op_id) > 64 THEN
    RAISE EXCEPTION 'invalid operation id' USING ERRCODE = 'P0004';
  END IF;
  IF p_action NOT IN ('insert', 'update', 'delete') THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = 'P0004';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid payload' USING ERRCODE = 'P0004';
  END IF;

  SELECT
    principal.profile_id,
    principal.tenant_id,
    principal.role,
    principal.profile_status,
    principal.tenant_status
  INTO
    v_profile_id,
    v_tenant_id,
    v_role,
    v_profile_status,
    v_tenant_status
  FROM public.get_authoritative_principal() AS principal;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'policy: profile_not_found',
      'code', 'forbidden'
    );
  END IF;
  IF v_profile_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'policy: account_suspended',
      'code', 'account_inactive'
    );
  END IF;
  IF v_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'policy: tenant_suspended',
      'code', 'tenant_inactive'
    );
  END IF;

  INSERT INTO public.case_operation_log (
    op_id,
    tenant_id,
    actor_profile_id,
    action,
    result
  )
  VALUES (
    p_op_id,
    v_tenant_id,
    v_profile_id,
    p_action,
    '{"success":false,"error":"in_progress","code":"transient: in_progress"}'::JSONB
  )
  ON CONFLICT (op_id, tenant_id, actor_profile_id) DO NOTHING
  RETURNING op_id INTO v_claim;

  IF v_claim IS NULL THEN
    SELECT result, created_at
    INTO v_result, v_claimed_at
    FROM public.case_operation_log
    WHERE op_id = p_op_id
      AND tenant_id = v_tenant_id
      AND actor_profile_id = v_profile_id;

    IF v_result IS NOT NULL
       AND v_result ->> 'error' = 'in_progress'
       AND now() - v_claimed_at > INTERVAL '10 minutes' THEN
      UPDATE public.case_operation_log
      SET action = p_action,
          created_at = now()
      WHERE op_id = p_op_id
        AND tenant_id = v_tenant_id
        AND actor_profile_id = v_profile_id
        AND result ->> 'error' = 'in_progress';

      IF FOUND THEN
        v_claim := p_op_id;
      ELSE
        SELECT result
        INTO v_result
        FROM public.case_operation_log
        WHERE op_id = p_op_id
          AND tenant_id = v_tenant_id
          AND actor_profile_id = v_profile_id;
      END IF;
    END IF;

    IF v_claim IS NULL THEN
      IF v_result IS NULL THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'transient: op_in_progress',
          'code', 'transient: in_progress'
        );
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  <<work>>
  BEGIN
    IF p_action = 'insert' THEN
      -- The command boundary, insert half. submit_case_command is the only
      -- path into pending because it creates the approval requests in the
      -- same transaction; this RPC writes none, so a status the caller may
      -- not set is refused here rather than reaching enforce_case_insert_status
      -- as an exception the handler below would reduce to internal_error.
      IF p_payload ? 'status'
         AND NULLIF(p_payload ->> 'status', '') IS DISTINCT FROM 'draft' THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: command_boundary',
          'code', 'state_conflict'
        );
        EXIT work;
      END IF;

      FOR v_key IN SELECT jsonb_object_keys(p_payload)
      LOOP
        IF v_key NOT IN (
          'template_id',
          'patient_mrn',
          'patient_dob',
          'patient_age_years',
          'patient_hash',
          'case_date',
          'field_values',
          'status',
          'is_deidentified'
        ) THEN
          v_result := jsonb_build_object(
            'success', false,
            'error', 'validation: invalid_column:' || v_key,
            'code', 'invalid_column'
          );
          EXIT work;
        END IF;
      END LOOP;

      v_is_deidentified := COALESCE(
        (p_payload ->> 'is_deidentified')::BOOLEAN,
        TRUE
      );
      IF NOT v_is_deidentified
         AND NOT public.tenant_identifiable_allowed(v_tenant_id) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: identifiable_not_permitted',
          'code', 'policy_denied'
        );
        EXIT work;
      END IF;

      INSERT INTO public.case_entries (
        tenant_id,
        resident_id,
        template_id,
        patient_mrn,
        patient_dob,
        patient_age_years,
        patient_hash,
        case_date,
        field_values,
        status,
        is_deidentified,
        client_operation_id
      )
      VALUES (
        v_tenant_id,
        v_profile_id,
        NULLIF(p_payload ->> 'template_id', '')::UUID,
        NULLIF(p_payload ->> 'patient_mrn', ''),
        NULLIF(p_payload ->> 'patient_dob', '')::DATE,
        NULLIF(p_payload ->> 'patient_age_years', '')::INTEGER,
        NULLIF(p_payload ->> 'patient_hash', ''),
        COALESCE(NULLIF(p_payload ->> 'case_date', '')::DATE, CURRENT_DATE),
        COALESCE(p_payload -> 'field_values', '{}'::JSONB),
        COALESCE(p_payload ->> 'status', 'draft'),
        v_is_deidentified,
        p_op_id
      )
      RETURNING id INTO v_new_id;

      v_result := jsonb_build_object(
        'success', true,
        'id', v_new_id,
        'op_id', p_op_id
      );

    ELSIF p_action = 'update' THEN
      IF p_row_id IS NULL THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'validation: missing_row_id',
          'code', 'invalid_request'
        );
        EXIT work;
      END IF;

      SELECT *
      INTO v_row
      FROM public.case_entries
      WHERE id = p_row_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'not_found',
          'code', 'not_found'
        );
        EXIT work;
      END IF;

      -- The command boundary. submit_case_command is the only path into
      -- `pending` and decide_case_command the only path out of it, because each
      -- writes the approval request ledger in the same transaction as the status
      -- change and fails closed when the tenant has no eligible reviewer. This
      -- RPC writes neither, so a caller-supplied status that would cross that
      -- line is refused here -- before the ownership and role checks below, so a
      -- privileged caller cannot reach the UPDATE with one.
      IF p_payload ? 'status'
         AND NULLIF(p_payload ->> 'status', '') IS DISTINCT FROM v_row.status
         AND (
           NULLIF(p_payload ->> 'status', '') = 'pending'
           OR v_row.status = 'pending'
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: command_boundary',
          'code', 'state_conflict'
        );
        EXIT work;
      END IF;

      IF v_row.resident_id <> v_profile_id
         AND COALESCE(v_role, '') NOT IN (
           'supervisor',
           'director',
           'institution_admin',
           'admin'
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: forbidden',
          'code', 'forbidden'
        );
        EXIT work;
      END IF;
      IF v_row.status = 'approved'
         AND COALESCE(v_role, '') NOT IN (
           'supervisor',
           'director',
           'institution_admin',
           'admin'
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: approved_locked',
          'code', 'state_conflict'
        );
        EXIT work;
      END IF;
      -- A submitted case is with its reviewers. The owning resident may not edit
      -- it -- write_once_submitted_check refuses that too, but as an exception the
      -- handler has to reduce to a code; the stable code is stated here instead
      -- so the queue classifies it the same way whatever triggered it.
      IF v_row.status = 'pending'
         AND COALESCE(v_role, '') NOT IN (
           'supervisor',
           'director',
           'institution_admin',
           'admin'
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: submitted_locked',
          'code', 'state_conflict'
        );
        EXIT work;
      END IF;

      FOR v_key IN SELECT jsonb_object_keys(p_payload)
      LOOP
        IF v_key IN (
          'id',
          'tenant_id',
          'resident_id',
          'created_at',
          'patient_hash',
          'client_operation_id'
        ) THEN
          v_result := jsonb_build_object(
            'success', false,
            'error', 'validation: immutable_column:' || v_key,
            'code', 'immutable_column'
          );
          EXIT work;
        END IF;
        IF v_key NOT IN (
          'template_id',
          'patient_mrn',
          'patient_dob',
          'patient_age_years',
          'case_date',
          'field_values',
          'status',
          'is_deidentified'
        ) THEN
          v_result := jsonb_build_object(
            'success', false,
            'error', 'validation: invalid_column:' || v_key,
            'code', 'invalid_column'
          );
          EXIT work;
        END IF;
      END LOOP;

      IF p_payload ? 'is_deidentified'
         AND (p_payload ->> 'is_deidentified')::BOOLEAN
           IS DISTINCT FROM v_row.is_deidentified THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: mode_immutable',
          'code', 'policy_denied'
        );
        EXIT work;
      END IF;

      IF NOT COALESCE(v_row.is_deidentified, TRUE)
         AND NOT public.tenant_identifiable_allowed(v_tenant_id)
         AND (
           (
             p_payload ? 'patient_mrn'
             AND NULLIF(p_payload ->> 'patient_mrn', '')
               IS DISTINCT FROM v_row.patient_mrn
           )
           OR
           (
             p_payload ? 'patient_dob'
             AND NULLIF(p_payload ->> 'patient_dob', '')::DATE
               IS DISTINCT FROM v_row.patient_dob
           )
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: identifier_locked',
          'code', 'policy_denied'
        );
        EXIT work;
      END IF;

      UPDATE public.case_entries
      SET template_id = COALESCE(
            NULLIF(p_payload ->> 'template_id', '')::UUID,
            template_id
          ),
          patient_mrn = CASE
            WHEN p_payload ? 'patient_mrn'
            THEN NULLIF(p_payload ->> 'patient_mrn', '')
            ELSE patient_mrn
          END,
          patient_dob = CASE
            WHEN p_payload ? 'patient_dob'
            THEN NULLIF(p_payload ->> 'patient_dob', '')::DATE
            ELSE patient_dob
          END,
          patient_age_years = CASE
            WHEN p_payload ? 'patient_age_years'
            THEN NULLIF(p_payload ->> 'patient_age_years', '')::INTEGER
            ELSE patient_age_years
          END,
          case_date = COALESCE(
            NULLIF(p_payload ->> 'case_date', '')::DATE,
            case_date
          ),
          field_values = COALESCE(
            p_payload -> 'field_values',
            field_values
          ),
          status = COALESCE(
            NULLIF(p_payload ->> 'status', ''),
            status
          ),
          updated_at = now()
      WHERE id = v_row.id
        AND tenant_id = v_tenant_id;

      v_result := jsonb_build_object(
        'success', true,
        'id', v_row.id,
        'op_id', p_op_id
      );

    ELSE
      IF p_row_id IS NULL THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'validation: missing_row_id',
          'code', 'invalid_request'
        );
        EXIT work;
      END IF;

      SELECT *
      INTO v_row
      FROM public.case_entries
      WHERE id = p_row_id
        AND tenant_id = v_tenant_id
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        IF EXISTS (
          SELECT 1
          FROM public.case_entries
          WHERE id = p_row_id
            AND tenant_id = v_tenant_id
            AND deleted_at IS NOT NULL
        ) THEN
          v_result := jsonb_build_object(
            'success', true,
            'already_deleted', true,
            'op_id', p_op_id
          );
        ELSE
          v_result := jsonb_build_object(
            'success', false,
            'error', 'not_found',
            'code', 'not_found'
          );
        END IF;
      ELSIF v_row.resident_id <> v_profile_id THEN
        -- The owner tombstoning their own row is the resident path and stays.
        -- A privileged actor removing a clinical record is
        -- public.soft_delete_case's job -- the AAL2-attributable command for it,
        -- which 20260923000011 wrapped for exactly the reason this RPC used to
        -- need wrapping. A general-purpose write RPC is not a second door to it.
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: use_soft_delete_case',
          'code', 'forbidden'
        );
      ELSE
        UPDATE public.case_entries
        SET deleted_at = now()
        WHERE id = v_row.id
          AND tenant_id = v_tenant_id;

        v_result := jsonb_build_object(
          'success', true,
          'id', v_row.id,
          'op_id', p_op_id
        );
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The detail is logged server-side and reduced to a code. The client gets
    -- a fixed phrase it can branch on and nothing about this installation's
    -- schema, plan state, or constraint names.
    v_error_code := public.case_operation_error_code(SQLSTATE, SQLERRM);
    RAISE WARNING 'submit_case_operation op=% action=% state=% code=%', p_op_id, p_action, SQLSTATE, v_error_code;
    v_result := jsonb_build_object(
      'success', false,
      'error', public.case_operation_error_text(v_error_code),
      'code', v_error_code
    );
  END;

  UPDATE public.case_operation_log
  SET tenant_id = v_tenant_id,
      actor_profile_id = v_profile_id,
      action = p_action,
      row_id = CASE
        WHEN p_action = 'insert' THEN (v_result ->> 'id')::UUID
        ELSE p_row_id
      END,
      result = v_result
  WHERE op_id = p_op_id
    AND tenant_id = v_tenant_id
    AND actor_profile_id = v_profile_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource_type,
    resource_id,
    changes
  )
  VALUES (
    v_tenant_id,
    auth.uid(),
    'case_' || p_action,
    'case_entries',
    COALESCE((v_result ->> 'id')::UUID, p_row_id),
    jsonb_build_object(
      'op_id', p_op_id,
      'code', v_result ->> 'code',
      'denied', COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) = FALSE
    )
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.__a2_submit_case_operation(TEXT, TEXT, UUID, JSONB) IS
  'The case operation body: fixed-schema, tenant-scoped, the command boundary stated for both halves (a status the caller may not set is refused rather than rewritten), and every failure carrying a code from a closed vocabulary plus a fixed phrase. Reachable only through public.submit_case_operation, which holds the AAL2 boundary; revoked from every client role so the boundary cannot be stepped over.';

REVOKE ALL ON FUNCTION public.__a2_submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
-- ---------------------------------------------------------------------------
-- 3. soft_delete_case states the refusal itself.
--
-- The wrapper is unchanged apart from the status check: same principal
-- resolution, same AAL2 requirement for a privileged role, same ownership check
-- for a resident, same delegation to the body. An approved record now returns
-- the same 42501 the AAL2 gate already returns for an unattributable caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_case(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_resident_id UUID;
  v_status TEXT;
BEGIN
  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_principal.role <> 'resident' THEN
    IF NOT public.require_privileged_principal(
      ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
      v_principal.tenant_id,
      TRUE
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT entry.resident_id
    INTO v_resident_id
    FROM public.case_entries AS entry
    WHERE entry.id = p_entry_id
      AND entry.tenant_id = v_principal.tenant_id;
    IF v_resident_id IS DISTINCT FROM v_principal.profile_id THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT entry.status
  INTO v_status
  FROM public.case_entries AS entry
  WHERE entry.id = p_entry_id
    AND entry.tenant_id = v_principal.tenant_id;

  -- An approved clinical record is a signed record and no command exists to
  -- retract it. Refused before the body runs so the refusal is attributable to
  -- this RPC rather than surfacing as a trigger exception from a function whose
  -- contract is a JSONB result.
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'Approved clinical records cannot be soft-deleted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.__a2_soft_delete_case(p_entry_id);
END;
$$;

COMMENT ON FUNCTION public.soft_delete_case(UUID) IS
  'AAL2-gated tombstone for a case in any non-approved state. An approved clinical record is refused: no command in the design retracts one, so it leaves the register only through retention, the tenant lifecycle cascade, or the table owner.';

-- CREATE OR REPLACE resets the default PUBLIC execute grant on a replaced
-- function, so the ACL is re-asserted rather than inherited. p1_17, p1_26 and
-- p3_05 all read this function's grants.
REVOKE ALL ON FUNCTION public.soft_delete_case(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_case(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. approve_case / reject_case are not a second way to approve.
--
-- Revoked from every client role. They are retained, revoked and ungranted, so
-- an installation that still has them cannot reach them from a client: the only
-- path into an approval is decide_case_command.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.approve_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_case(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.approve_case(UUID, UUID, TEXT) IS
  'Retired. Approval is decide_case_command: it resolves one locked pending approval request in the same transaction as the status change, writes the idempotency ledger, the audit row and the outbox row, and is AAL2-attributable. This function holds no client execute grant.';
COMMENT ON FUNCTION public.reject_case(UUID, UUID, TEXT) IS
  'Retired. Rejection is decide_case_command with p_decision = ''reject''. This function holds no client execute grant.';

-- ---------------------------------------------------------------------------
-- 5. The authoritative PHI scan body, re-asserted and then verified.
--
-- Re-issued verbatim from 20260925000004, which is the boundary: the recursive
-- field_values_contain_phi() walk with its unknown-key allowlist, not an inline
-- regex. 20260927000003 had replaced this body with
-- `\m\d{6,}\m OR <ISO date> OR <US date>`, which detects an MRN-shaped digit
-- run and nothing else -- not an email address, not a telephone number, not a
-- labelled medical record number, and not an unknown key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.is_deidentified = true AND public.field_values_contain_phi(NEW.field_values) THEN
    RAISE EXCEPTION 'PHI detected in deidentified field values';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();

-- The three detectors stay out of reach of client roles: exposing them would
-- invite treating PHI detection as a supported API, and an unknown-key probe is
-- exactly what a caller would script.
REVOKE ALL ON FUNCTION public.scan_field_values_for_phi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_text_contains_phi(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_field_value_is_safe(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.field_values_contain_phi(JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assert the final state instead of assuming it.
--
-- A silent downgrade is the failure mode this migration exists to prevent: a
-- weaker scan body, a client-reachable approval RPC, or a tombstone guard that
-- no longer reads. Each is read back from the catalog, so a migration that
-- completes has verified the state rather than asserted it in a comment.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.scan_field_values_for_phi()'::regprocedure);

  IF v_def NOT ILIKE '%field_values_contain_phi(%' THEN
    RAISE EXCEPTION
      'SEC-013: scan_field_values_for_phi is not walking field_values_contain_phi(); the de-identified PHI boundary has been downgraded';
  END IF;

  IF v_def NOT ILIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION
      'SEC-013: scan_field_values_for_phi is not SECURITY DEFINER, so it no longer runs with the locked search_path the boundary requires';
  END IF;

  IF has_function_privilege('anon', 'public.approve_case(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.approve_case(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reject_case(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reject_case(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SEC-014: approve_case/reject_case are still client-reachable; decide_case_command is the only approval path';
  END IF;

  IF has_function_privilege('anon', 'public.write_once_submitted_check()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.enforce_case_insert_status()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'SEC-013: a case_entries guard function is executable by an anonymous caller';
  END IF;
END $$;

DO $$
DECLARE
  v_privileged TEXT;
BEGIN
  SELECT string_agg(policy_record.polname, ', ' ORDER BY policy_record.polname)
  INTO v_privileged
  FROM pg_policies AS policy_record
  WHERE policy_record.schemaname = 'public'
    AND policy_record.tablename = 'case_entries'
    AND policy_record.cmd IN ('UPDATE', 'ALL');

  -- The only UPDATE policies left are the two resident-scoped ones, both pinned
  -- to draft/rejected rows. A privileged UPDATE or soft-delete policy here
  -- would be a direct path around the command boundary.
  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename = 'case_entries'
      AND policy_record.cmd IN ('UPDATE', 'ALL')
      AND policy_record.polname NOT IN (
        'residents edit own draft or rejected entries',
        'residents soft delete own draft entries'
      )
  ) THEN
    RAISE EXCEPTION
      'SEC-015: a privileged or soft-delete UPDATE policy remains on case_entries: %', v_privileged;
  END IF;
END $$;
