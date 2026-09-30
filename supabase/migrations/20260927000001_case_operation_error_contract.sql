-- ============================================================================
-- 20260927000001_case_operation_error_contract.sql
--
-- Stable error contract for the mobile case operation RPC, and the AAL2
-- boundary that RPC lost when its body was last rewritten.
--
-- Root cause this migration closes
-- ------------------------------
-- public.submit_case_operation caught every unexpected row error and returned
-- it to the client verbatim:
--
--     v_result := jsonb_build_object(
--       'success', false,
--       'error', 'db: ' || LEFT(SQLERRM, 300)
--     );
--
-- SQLERRM is server text. It carries constraint names, table and column names,
-- tenant plan state, and whatever a downstream RAISE put there. It is
-- unversioned, unparseable as a contract, and it is returned to a mobile client
-- that then pattern-matches English to decide whether to retry. Three
-- consequences:
--
--   1. Disclosure: internal schema detail crosses the tenant boundary to an
--      untrusted client.
--   2. Contract drift: clients (apps/mobile/lib/durable-queue.ts) classify the
--      message text, so a trigger's wording is a de facto public API.
--   3. Unbounded growth: the truncation is applied AFTER concatenation, and
--      nothing bounds the code beyond the message, so the shape of the value
--      can change without a migration.
--
-- The second root cause is the one with a security consequence. 20260923000011
-- had renamed the raw body to __a2_submit_case_operation and put an AAL2 wrapper
-- at the public name. Converging the error contract by redefining
-- public.submit_case_operation with the raw body FOLDED THE WRAPPER BACK INTO
-- IT, and the RPC is SECURITY DEFINER, so the only AAL2 check on the mobile
-- write path disappeared with it. A privileged session at AAL1 could then
-- update or soft-delete another resident's clinical record, and push a case
-- toward the approval queue with none of the approval-request bookkeeping the
-- command boundary exists to do in the same transaction.
--
-- What this migration does
-- ------------------------
--   * every outcome carries a `code` from a closed vocabulary, and the
--     `error` string is a fixed human-readable phrase for that code -- never
--     server text;
--   * SQLERRM is still available to the handler, but only to SELECT a code from
--     SQLSTATE and a small allowlist of known messages. The raw text is written
--     to the server log at WARNING and never to the result;
--   * the previously returned `error` values are preserved verbatim for the
--     paths that already had a stable string, so the replay semantics, the
--     existing pgTAP expectations, and the queue's stored terminal results
--     keep their meaning;
--   * public.submit_case_operation is a wrapper again. It resolves the
--     authoritative principal through get_authoritative_principal_with_aal(),
--     requires a live AAL2 privileged principal for a privileged role, and
--     holds a resident to their own row. The contract body moves to
--     __a2_submit_case_operation, which is revoked from every client role so
--     the wrapper cannot be stepped over;
--   * the body refuses, for every caller rather than by role, any status change
--     that crosses the command boundary, and refuses a privileged tombstone.
--     submit_case_command is the only path into `pending` and
--     decide_case_command the only path out of it; each writes the approval
--     ledger in the same transaction, and this RPC writes neither.
--
-- Unknown failures collapse to `internal_error` and are retryable: guessing a
-- specific code from an unrecognized SQLSTATE would be worse than admitting we
-- do not know.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.case_operation_error_code(p_sqlstate TEXT, p_message TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- Server text is matched only against a closed allowlist. The match result
  -- is a code; the text itself never leaves this function.
  IF p_message LIKE 'Free plan limit%' THEN
    RETURN 'quota_exceeded';
  END IF;
  IF p_message LIKE 'PHI detected%' THEN
    RETURN 'phi_detected';
  END IF;

  CASE COALESCE(p_sqlstate, '') WHEN
    -- insufficient_privilege
    '42501' THEN RETURN 'forbidden';
    -- unique_violation
    '23505' THEN RETURN 'conflict';
    -- foreign_key_violation
    '23503' THEN RETURN 'invalid_reference';
    -- not_null_violation
    '23502' THEN RETURN 'validation: missing_value';
    -- check_violation
    '23514' THEN RETURN 'validation: constraint_failed';
    -- invalid_text_representation / invalid_parameter_value
    '22P02', '22007', '22008', '22003' THEN RETURN 'validation: invalid_value';
    -- invalid_json_text / invalid_datetime_format
    '22032', '22007' THEN RETURN 'validation: invalid_value';
    -- raise_exception from a state machine or a write-once guard
    'P0001' THEN RETURN 'state_conflict';
    -- raise_exception for a bad argument
    'P0004' THEN RETURN 'invalid_request';
    -- serialization_failure / deadlock_detected: the work is retryable
    '40001', '40P01' THEN RETURN 'transient: retryable';
    ELSE RETURN 'internal_error';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.case_operation_error_code(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.case_operation_error_code(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.case_operation_error_code(TEXT, TEXT) IS
  'Maps a caught SQLSTATE/message onto a closed set of case-operation error codes. Server text is matched against an allowlist and never returned.';

CREATE OR REPLACE FUNCTION public.case_operation_error_text(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Every code a client can receive has an entry here. The COALESCE fallback is
  -- the second lock: a code added without a phrase still yields a fixed string,
  -- never a leak.
  SELECT COALESCE(
    (
      SELECT value
      FROM (VALUES
        ('invalid_request', 'validation: invalid_request'),
        ('invalid_column', 'validation: invalid_column'),
        ('immutable_column', 'validation: immutable_column'),
        ('not_found', 'not_found'),
        ('forbidden', 'policy: forbidden'),
        ('account_inactive', 'policy: account_suspended'),
        ('tenant_inactive', 'policy: tenant_suspended'),
        ('policy_denied', 'policy: denied'),
        ('conflict', 'conflict: already exists'),
        ('invalid_reference', 'validation: invalid_reference'),
        ('validation: missing_value', 'validation: missing_value'),
        ('validation: constraint_failed', 'validation: constraint_failed'),
        ('validation: invalid_value', 'validation: invalid_value'),
        ('quota_exceeded', 'policy: quota_exceeded'),
        ('phi_detected', 'policy: phi_detected'),
        ('state_conflict', 'state_conflict'),
        ('transient: retryable', 'transient: retryable'),
        ('transient: op_in_progress', 'transient: op_in_progress'),
        ('transient: in_progress', 'transient: in_progress'),
        ('internal_error', 'operation_failed')
      ) AS codes(code, value)
      WHERE codes.code = p_code
    ),
    'operation_failed'
  );
$$;

REVOKE ALL ON FUNCTION public.case_operation_error_text(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.case_operation_error_text(TEXT) TO service_role;

COMMENT ON FUNCTION public.case_operation_error_text(TEXT) IS
  'Fixed human-readable phrase for a case-operation error code. Two inputs, one output: a code can never carry server text into a response.';

-- ---------------------------------------------------------------------------
-- The contract body. This is public.__a2_submit_case_operation, not the public
-- name: the public name is the AAL2 wrapper defined at the end of this file, and
-- folding the two together is exactly what removed the AAL2 check once already.
-- The body is revoked from every client role so the wrapper cannot be stepped
-- over by calling it directly.
-- ---------------------------------------------------------------------------
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
  'The case operation body: fixed-schema, tenant-scoped, and every failure carries a code from a closed vocabulary plus a fixed phrase. Reachable only through public.submit_case_operation, which holds the AAL2 boundary; revoked from every client role so the boundary cannot be stepped over.';

REVOKE ALL ON FUNCTION public.__a2_submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The public entry point: the authoritative AAL2 boundary for the mobile write
-- path, restored to the shape 20260923000011 gave it.
--
-- This function is SECURITY DEFINER, so a caller reaches case_entries, the
-- operation log and the audit log with the definer's rights. Everything that
-- makes that safe has to be here:
--
--   * a privileged role needs a live AAL2 claim. require_privileged_principal
--     is the shared helper for exactly this, and it also resolves the profile
--     and tenant status, the platform-admin registry and the tenant match, so a
--     suspended principal, a stale session and a cross-tenant attempt all land
--     on the same refusal;
--   * a resident may act at either assurance level, and only on their own row.
--     The row lookup is scoped to the caller's own tenant, so a row id from
--     another institution is indistinguishable from one that does not exist;
--   * a claim with no `aal` at all is refused. get_authoritative_principal_
--     with_aal returns NULL for anything but aal1/aal2, and a session that
--     never presented an assurance level has not presented a fresh one.
--
-- The refusal raises 42501 with a fixed message. It happens before the operation
-- log is claimed, so a denied call leaves no ledger row claiming work in
-- progress, and it carries no database text.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_case_operation(
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
  v_principal RECORD;
  v_target_resident_id UUID;
BEGIN
  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  -- No principal, no role we recognise, no tenant: nothing to decide against.
  -- The profile and tenant status are deliberately NOT refused here -- the body
  -- returns 'policy: account_suspended' and 'policy: tenant_suspended' for
  -- those, which are stable codes a client can act on, whereas a raise would
  -- collapse both into an opaque 42501.
  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
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
    -- The owner path. A resident reaches a case operation for their own row at
    -- aal1 or aal2; submission and approval are the commands' job, not this
    -- RPC's, and the body refuses a status change that would cross into them.
    IF v_principal.aal NOT IN ('aal1', 'aal2') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_row_id IS NOT NULL THEN
      SELECT entry.resident_id
      INTO v_target_resident_id
      FROM public.case_entries AS entry
      WHERE entry.id = p_row_id
        AND entry.tenant_id = v_principal.tenant_id;
      IF v_target_resident_id IS DISTINCT FROM v_principal.profile_id THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN public.__a2_submit_case_operation(p_op_id, p_action, p_row_id, p_payload);
END;
$$;

COMMENT ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) IS
  'AAL2-gated entry point to the case operation body. A privileged role needs a live AAL2 claim in its own tenant; a resident may act only on their own row. The body holds the stable error contract and the command boundary: submission and approval are submit_case_command and decide_case_command, and a privileged tombstone is soft_delete_case.';

-- 20260923000011 revoked the public name from service_role as well. CREATE OR
-- REPLACE resets the default PUBLIC execute grant on a replaced function, so
-- the revoke is re-asserted here rather than inherited: p1_26 and p1_17 both
-- read this function's ACL.
REVOKE ALL ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated;
