-- ============================================================================
-- 20260909000003_case_operation_rpc.sql (N1/N3)
--
-- Fixed-schema, tenant-scoped case operation RPC. Replaces the dynamic-SQL
-- sync_push_batch path (id-only UPDATE predicate, no column allowlist, no
-- operation identity) for all mobile queue submissions:
--   * caller resolved from auth.uid() -> profiles (id, tenant, role, status)
--   * non-active accounts denied before any write
--   * tenant forced from the caller; rows locked with tenant predicates
--   * ownership: resident may touch OWN rows; approver roles any tenant row
--   * approved rows are locked to approver roles (no silent overwrite)
--   * fixed per-action column allowlists; unknown keys rejected
--   * is_deidentified flips rejected here (see mode-immutability trigger)
--   * identifiable payloads require tenant_identifiable_allowed()
--   * delete is a real tombstone (deleted_at), idempotent
--   * operation log keyed by client op ID: duplicate delivery returns the
--     stored result without re-executing (replay-safe)
--   * audit_logs row written in the same transaction (no swallow)
-- Row triggers (mode/quota/status-transition/PHI-scan) still fire normally.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.case_operation_log (
  op_id TEXT PRIMARY KEY CHECK (char_length(op_id) BETWEEN 1 AND 64),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  row_id UUID,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.case_operation_log ENABLE ROW LEVEL SECURITY;
-- No policies: RPC/service-role only.

CREATE OR REPLACE FUNCTION public.submit_case_operation(
  p_op_id TEXT,
  p_action TEXT,
  p_row_id UUID DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
  v_status TEXT;
  v_row case_entries;
  v_new_id UUID;
  v_result JSONB;
  v_claim TEXT;
  v_claimed_at TIMESTAMPTZ;
  v_key TEXT;
  v_is_deidentified BOOLEAN;
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

  -- Caller identity from the JWT (never from payload).
  SELECT id, tenant_id, role, COALESCE(status, 'active')
    INTO v_profile_id, v_tenant_id, v_role, v_status
  FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: profile_not_found');
  END IF;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: account_suspended');
  END IF;

  -- Replay + mutual exclusion: claim the op ID BEFORE doing work. A recorded
  -- result returns untouched (replay-safe). A concurrent duplicate sees
  -- in_progress and retries (never forks a second row). A stale in_progress
  -- claim (crashed worker, > 10 min) is reclaimed by the new worker.
  INSERT INTO public.case_operation_log (op_id, tenant_id, actor_profile_id, action, result)
  VALUES (p_op_id, v_tenant_id, v_profile_id, p_action, '{"success":false,"error":"in_progress"}'::jsonb)
  ON CONFLICT (op_id) DO NOTHING
  RETURNING op_id INTO v_claim;
  IF v_claim IS NULL THEN
    SELECT result, created_at INTO v_result, v_claimed_at
      FROM public.case_operation_log WHERE op_id = p_op_id;
    IF v_result IS NOT NULL AND v_result ->> 'error' = 'in_progress'
       AND NOW() - v_claimed_at > interval '10 minutes' THEN
      UPDATE public.case_operation_log
         SET actor_profile_id = v_profile_id, action = p_action, created_at = NOW()
       WHERE op_id = p_op_id AND result ->> 'error' = 'in_progress';
      IF FOUND THEN
        v_claim := p_op_id;
      ELSE
        SELECT result INTO v_result FROM public.case_operation_log WHERE op_id = p_op_id;
      END IF;
    END IF;
    IF v_claim IS NULL THEN
      IF v_result IS NULL THEN
        v_result := jsonb_build_object('success', false, 'error', 'transient: op_in_progress');
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- Single-exit work block: every denial assigns v_result and exits; the
  -- shared finalize below records the op log + audit exactly once, so no
  -- denial can strand the claim in 'in_progress'. Unexpected row errors
  -- (quota/status/PHI triggers, bad casts) are recorded as terminal results
  -- instead of wedging the claim: only a torn connection leaves in_progress
  -- for the 10-minute stale takeover above.
  <<work>> BEGIN
  IF p_action = 'insert' THEN
    -- Unknown keys rejected (client drift fails loudly, not silently).
    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
      IF v_key NOT IN ('template_id','patient_mrn','patient_dob','patient_age_years',
                       'patient_hash','case_date','field_values','status','is_deidentified') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: invalid_column:' || v_key);
        EXIT work;
      END IF;
    END LOOP;
    v_is_deidentified := COALESCE((p_payload ->> 'is_deidentified')::boolean, TRUE);
    IF NOT v_is_deidentified AND NOT public.tenant_identifiable_allowed(v_tenant_id) THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: identifiable_not_permitted');
      EXIT work;
    END IF;
    INSERT INTO public.case_entries (
      tenant_id, resident_id, template_id, patient_mrn, patient_dob,
      patient_age_years, patient_hash, case_date, field_values, status,
      is_deidentified, client_operation_id
    ) VALUES (
      v_tenant_id, v_profile_id,
      NULLIF(p_payload ->> 'template_id', '')::uuid,
      NULLIF(p_payload ->> 'patient_mrn', ''),
      NULLIF(p_payload ->> 'patient_dob', '')::date,
      NULLIF(p_payload ->> 'patient_age_years', '')::int,
      NULLIF(p_payload ->> 'patient_hash', ''),
      COALESCE(NULLIF(p_payload ->> 'case_date', '')::date, CURRENT_DATE),
      COALESCE(p_payload -> 'field_values', '{}'::jsonb),
      COALESCE(p_payload ->> 'status', 'draft'),
      v_is_deidentified,
      p_op_id
    ) RETURNING id INTO v_new_id;
    v_result := jsonb_build_object('success', true, 'id', v_new_id, 'op_id', p_op_id);

  ELSIF p_action = 'update' THEN
    IF p_row_id IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'validation: missing_row_id');
      EXIT work;
    END IF;
    SELECT * INTO v_row FROM public.case_entries
     WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_found');
      EXIT work;
    END IF;
    IF v_row.resident_id <> v_profile_id
       AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
      EXIT work;
    END IF;
    IF v_row.status = 'approved'
       AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: approved_locked');
      EXIT work;
    END IF;
    -- Immutable identity/audit fields can never move through this path.
    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
      IF v_key IN ('id','tenant_id','resident_id','created_at','patient_hash','client_operation_id') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: immutable_column:' || v_key);
        EXIT work;
      END IF;
      IF v_key NOT IN ('template_id','patient_mrn','patient_dob','patient_age_years',
                       'case_date','field_values','status','is_deidentified') THEN
        v_result := jsonb_build_object('success', false, 'error', 'validation: invalid_column:' || v_key);
        EXIT work;
      END IF;
    END LOOP;
    -- Mode flips are rejected here; the trigger is the second lock.
    IF (p_payload ? 'is_deidentified')
       AND (p_payload ->> 'is_deidentified')::boolean IS DISTINCT FROM v_row.is_deidentified THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: mode_immutable');
      EXIT work;
    END IF;
    IF (NOT COALESCE(v_row.is_deidentified, TRUE))
       AND NOT public.tenant_identifiable_allowed(v_tenant_id)
       AND ((p_payload ? 'patient_mrn' AND NULLIF(p_payload ->> 'patient_mrn', '') IS DISTINCT FROM v_row.patient_mrn)
            OR (p_payload ? 'patient_dob' AND NULLIF(p_payload ->> 'patient_dob', '')::date IS DISTINCT FROM v_row.patient_dob)) THEN
      v_result := jsonb_build_object('success', false, 'error', 'policy: identifier_locked');
      EXIT work;
    END IF;
    UPDATE public.case_entries SET
      template_id = COALESCE(NULLIF(p_payload ->> 'template_id', '')::uuid, template_id),
      patient_mrn = CASE WHEN p_payload ? 'patient_mrn' THEN NULLIF(p_payload ->> 'patient_mrn', '') ELSE patient_mrn END,
      patient_dob = CASE WHEN p_payload ? 'patient_dob' THEN NULLIF(p_payload ->> 'patient_dob', '')::date ELSE patient_dob END,
      patient_age_years = CASE WHEN p_payload ? 'patient_age_years' THEN NULLIF(p_payload ->> 'patient_age_years', '')::int ELSE patient_age_years END,
      case_date = COALESCE(NULLIF(p_payload ->> 'case_date', '')::date, case_date),
      field_values = COALESCE(p_payload -> 'field_values', field_values),
      status = COALESCE(p_payload ->> 'status', status),
      updated_at = NOW()
     WHERE id = v_row.id;
    v_result := jsonb_build_object('success', true, 'id', v_row.id, 'op_id', p_op_id);

  ELSE -- delete: real tombstone, idempotent.
    IF p_row_id IS NULL THEN
      v_result := jsonb_build_object('success', false, 'error', 'validation: missing_row_id');
      EXIT work;
    END IF;
    SELECT * INTO v_row FROM public.case_entries
     WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.case_entries
                  WHERE id = p_row_id AND tenant_id = v_tenant_id AND deleted_at IS NOT NULL) THEN
        v_result := jsonb_build_object('success', true, 'already_deleted', true, 'op_id', p_op_id);
      ELSE
        v_result := jsonb_build_object('success', false, 'error', 'not_found');
      END IF;
    ELSE
      IF v_row.resident_id <> v_profile_id
         AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
        v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
      ELSE
        UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_row.id;
        v_result := jsonb_build_object('success', true, 'id', v_row.id, 'op_id', p_op_id);
      END IF;
    END IF;
  END IF;
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'db: ' || LEFT(SQLERRM, 300));
  END; -- <<work>>

  -- Operation log + audit in the same transaction (no swallow). Denials are
  -- recorded too, so replays return the terminal denial instead of retrying.
  UPDATE public.case_operation_log
     SET tenant_id = v_tenant_id, actor_profile_id = v_profile_id, action = p_action,
         row_id = CASE WHEN p_action = 'insert' THEN (v_result ->> 'id')::uuid ELSE p_row_id END,
         result = v_result
   WHERE op_id = p_op_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (v_tenant_id, auth.uid(), 'case_' || p_action, 'case_entries',
          COALESCE((v_result ->> 'id')::uuid, p_row_id),
          jsonb_build_object('op_id', p_op_id,
                             'denied', COALESCE((v_result ->> 'success')::boolean, FALSE) = FALSE));

  RETURN v_result;
END;
$$;

-- Lock down the new RPC and RETIRE the dynamic bypass path.
REVOKE ALL ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_batch(TEXT, JSONB) FROM authenticated;
