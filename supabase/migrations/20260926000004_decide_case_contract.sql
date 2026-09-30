CREATE OR REPLACE FUNCTION public.decide_case_command(
  p_case_id UUID,
  p_request_id TEXT,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_case public.case_entries%ROWTYPE;
  v_approval public.approval_requests%ROWTYPE;
  v_next_status TEXT;
  v_fingerprint TEXT;
  v_stored_fingerprint TEXT;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  IF p_case_id IS NULL
     OR p_request_id IS NULL
     OR char_length(p_request_id) < 1
     OR char_length(p_request_id) > 128
     OR p_decision IS NULL
     OR p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request', 'code', 'invalid_request');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'account is not active', 'code', 'account_inactive');
  END IF;

  IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant is not active', 'code', 'tenant_suspended');
  END IF;

  IF v_principal.role IS NULL
     OR v_principal.role NOT IN ('supervisor', 'director', 'institution_admin', 'admin')
     OR v_principal.aal IS DISTINCT FROM 'aal2' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  IF v_principal.role = 'admin' AND NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  v_next_status := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;
  v_fingerprint := p_case_id::text || '|' || p_decision;

  INSERT INTO public.clinical_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    v_principal.tenant_id, v_principal.profile_id, 'decide_case', p_request_id,
    v_fingerprint, '{"success":false,"error":"in_progress"}'::jsonb
  )
  ON CONFLICT (tenant_id, actor_profile_id, command, request_id) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  IF NOT COALESCE(v_claimed, FALSE) THEN
    SELECT request_fingerprint, result
    INTO v_stored_fingerprint, v_stored
    FROM public.clinical_command_log
    WHERE tenant_id = v_principal.tenant_id
      AND actor_profile_id = v_principal.profile_id
      AND command = 'decide_case'
      AND request_id = p_request_id;

    IF v_stored IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'transient: in_progress', 'code', 'state_conflict');
    END IF;
    IF v_stored ->> 'error' = 'in_progress' THEN
      RETURN v_stored;
    END IF;
    IF v_stored_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('success', false, 'error', 'request key reused with different input', 'code', 'idempotency_conflict');
    END IF;
    RETURN v_stored;
  END IF;

  <<work>> BEGIN
    SELECT *
    INTO v_case
    FROM public.case_entries
    WHERE id = p_case_id
      AND tenant_id = v_principal.tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_found', 'code', 'not_found');
      EXIT work;
    END IF;

    IF v_case.status <> 'pending' THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'state_conflict',
        'code', 'state_conflict',
        'current_status', v_case.status
      );
      EXIT work;
    END IF;

    SELECT *
    INTO v_approval
    FROM public.approval_requests
    WHERE entry_id = p_case_id
      AND tenant_id = v_principal.tenant_id
    ORDER BY
      (status = 'pending') DESC,
      (supervisor_id = v_principal.profile_id) DESC NULLS LAST,
      requested_at,
      id
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'no_approval_request', 'code', 'forbidden');
      EXIT work;
    END IF;

    IF v_approval.status IS DISTINCT FROM 'pending' THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'approval request already resolved',
        'code', 'state_conflict',
        'current_status', v_approval.status
      );
      EXIT work;
    END IF;

    IF v_approval.supervisor_id IS NOT NULL
       AND v_approval.supervisor_id IS DISTINCT FROM v_principal.profile_id
       AND v_principal.role NOT IN ('director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
      EXIT work;
    END IF;

    UPDATE public.case_entries
    SET status = v_next_status, updated_at = NOW()
    WHERE id = v_case.id;

    UPDATE public.approval_requests
    SET status = v_next_status,
        comment = COALESCE(p_reason, comment),
        resolved_at = NOW()
    WHERE id = v_approval.id;

    v_result := jsonb_build_object(
      'success', true,
      'case_id', v_case.id,
      'approval_id', v_approval.id,
      'status', v_next_status
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'decide_failed', 'code', 'internal_error');
  END;

  UPDATE public.clinical_command_log
  SET row_id = p_case_id, result = v_result
  WHERE tenant_id = v_principal.tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'decide_case'
    AND request_id = p_request_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_decide', 'case_entries', p_case_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'status', v_result ->> 'status',
      'has_reason', p_reason IS NOT NULL,
      'denied', NOT COALESCE((v_result ->> 'success')::boolean, FALSE)
    )
  );

  INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_decide', 'case_entries', p_case_id,
    jsonb_build_object('request_id', p_request_id, 'status', v_result ->> 'status')
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) IS
  'AAL2-gated command that returns stable lifecycle codes and resolves one locked pending approval request atomically.';

REVOKE ALL ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) TO authenticated;
