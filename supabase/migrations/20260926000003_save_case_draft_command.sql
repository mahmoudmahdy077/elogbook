CREATE OR REPLACE FUNCTION public.save_case_draft_command(
  p_request_id TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_template_id UUID;
  v_template_fields JSONB;
  v_template_required JSONB;
  v_case_date DATE;
  v_patient_age_years INTEGER;
  v_fingerprint TEXT;
  v_stored_fingerprint TEXT;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
  v_new_case_id UUID;
  v_key TEXT;
  v_field_type TEXT;
  v_field_value JSONB;
  v_missing_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_request_id IS NULL
     OR char_length(p_request_id) < 1
     OR char_length(p_request_id) > 128
     OR p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid request', 'code', 'invalid_request');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.user_id IS NULL
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.aal IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'account is not active', 'code', 'account_inactive');
  END IF;

  IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant is not active', 'code', 'tenant_suspended');
  END IF;

  IF v_principal.role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  IF v_principal.role = 'admin' AND NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  IF p_payload->>'template_id' IS NULL
     OR p_payload->>'template_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid template', 'code', 'invalid_request');
  END IF;

  v_template_id := p_payload->>'template_id'::uuid;
  v_fingerprint := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.clinical_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    v_principal.tenant_id, v_principal.profile_id, 'save_case_draft', p_request_id,
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
      AND command = 'save_case_draft'
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
    IF p_payload->>'is_deidentified' IS DISTINCT FROM 'true' THEN
      v_result := jsonb_build_object('success', false, 'error', 'identifiable mode is not available', 'code', 'policy_denied');
      EXIT work;
    END IF;

    IF (p_payload ? 'patient_mrn' AND p_payload->'patient_mrn' IS DISTINCT FROM 'null'::jsonb)
       OR (p_payload ? 'patient_dob' AND p_payload->'patient_dob' IS DISTINCT FROM 'null'::jsonb)
       OR (p_payload ? 'patient_hash' AND p_payload->'patient_hash' IS DISTINCT FROM 'null'::jsonb) THEN
      v_result := jsonb_build_object('success', false, 'error', 'identifiable fields are not available', 'code', 'policy_denied');
      EXIT work;
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
      IF v_key NOT IN (
        'template_id', 'case_date', 'field_values', 'accreditation_mappings',
        'is_deidentified', 'patient_age_years', 'patient_mrn', 'patient_dob', 'patient_hash'
      ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'invalid column: ' || v_key,
          'code', 'invalid_column'
        );
        EXIT work;
      END IF;
    END LOOP;

    IF p_payload ? 'field_values'
       AND jsonb_typeof(p_payload->'field_values') <> 'object' THEN
      v_result := jsonb_build_object('success', false, 'error', 'field_values must be an object', 'code', 'invalid_request');
      EXIT work;
    END IF;

    IF p_payload ? 'accreditation_mappings'
       AND jsonb_typeof(p_payload->'accreditation_mappings') <> 'array' THEN
      v_result := jsonb_build_object('success', false, 'error', 'accreditation_mappings must be an array', 'code', 'invalid_request');
      EXIT work;
    END IF;

    IF p_payload->>'case_date' IS NOT NULL
       AND p_payload->>'case_date' <> ''
       AND p_payload->>'case_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid case_date', 'code', 'invalid_request');
      EXIT work;
    END IF;

    BEGIN
      v_case_date := COALESCE(NULLIF(p_payload->>'case_date', '')::date, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid case_date', 'code', 'invalid_request');
      EXIT work;
    END;

    IF p_payload->>'patient_age_years' IS NOT NULL
       AND p_payload->>'patient_age_years' !~ '^\d{1,3}$' THEN
      v_result := jsonb_build_object('success', false, 'error', 'invalid patient_age_years', 'code', 'invalid_request');
      EXIT work;
    END IF;

    IF p_payload->>'patient_age_years' IS NOT NULL THEN
      v_patient_age_years := p_payload->>'patient_age_years'::integer;
      IF v_patient_age_years < 0 OR v_patient_age_years > 150 THEN
        v_result := jsonb_build_object('success', false, 'error', 'invalid patient_age_years', 'code', 'invalid_request');
        EXIT work;
      END IF;
    END IF;

    SELECT template.fields, template.required_fields
    INTO v_template_fields, v_template_required
    FROM public.case_templates AS template
    WHERE template.id = v_template_id
      AND (
        template.tenant_id = v_principal.tenant_id
        OR template.tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
      )
    FOR SHARE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'template not found', 'code', 'not_found');
      EXIT work;
    END IF;

    FOR v_key IN
      SELECT jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(v_template_required) = 'array' THEN v_template_required
          ELSE '[]'::jsonb
        END
      )
    LOOP
      v_field_value := COALESCE(p_payload->'field_values', '{}'::jsonb) -> v_key;

      SELECT field ->> 'type'
      INTO v_field_type
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(v_template_fields) = 'array' THEN v_template_fields
          ELSE '[]'::jsonb
        END
      ) AS field
      WHERE COALESCE(field ->> 'key', field ->> 'name') = v_key
      LIMIT 1;

      IF v_field_value IS NULL
         OR v_field_value = 'null'::jsonb
         OR (jsonb_typeof(v_field_value) = 'string' AND btrim(v_field_value #>> '{}') = '')
         OR (v_field_type = 'checkbox' AND v_field_value IS DISTINCT FROM 'true'::jsonb) THEN
        v_missing_fields := array_append(v_missing_fields, v_key);
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_missing_fields, 1), 0) > 0 THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'required template fields are missing',
        'code', 'required_field_missing',
        'missing_fields', to_jsonb(v_missing_fields)
      );
      EXIT work;
    END IF;

    IF public.field_values_contain_phi(COALESCE(p_payload->'field_values', '{}'::jsonb)) THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'field values rejected by the de-identified data boundary',
        'code', 'policy_denied'
      );
      EXIT work;
    END IF;

    INSERT INTO public.case_entries (
      tenant_id, resident_id, template_id, case_date, field_values,
      accreditation_mappings, is_deidentified, patient_age_years,
      patient_mrn, patient_dob, patient_hash, status
    ) VALUES (
      v_principal.tenant_id, v_principal.profile_id, v_template_id, v_case_date,
      COALESCE(p_payload->'field_values', '{}'::jsonb),
      COALESCE(p_payload->'accreditation_mappings', '[]'::jsonb),
      TRUE, v_patient_age_years, NULL, NULL, NULL, 'draft'
    )
    RETURNING id INTO v_new_case_id;

    v_result := jsonb_build_object(
      'success', true,
      'case_id', v_new_case_id,
      'status', 'draft'
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object(
      'success', false,
      'error', 'draft creation failed',
      'code', CASE
        WHEN SQLERRM LIKE 'Free plan limit%' THEN 'policy_denied'
        WHEN SQLERRM LIKE 'PHI detected%' THEN 'policy_denied'
        ELSE 'internal_error'
      END
    );
  END;

  UPDATE public.clinical_command_log
  SET row_id = v_new_case_id,
      result = v_result
  WHERE tenant_id = v_principal.tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'save_case_draft'
    AND request_id = p_request_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id,
    auth.uid(),
    'case_draft_create',
    CASE WHEN COALESCE((v_result ->> 'success')::boolean, FALSE)
      THEN 'case_entries' ELSE 'case_templates' END,
    COALESCE(v_new_case_id, v_template_id),
    jsonb_build_object(
      'request_id', p_request_id,
      'template_id', v_template_id,
      'status', v_result ->> 'status',
      'code', v_result ->> 'code',
      'denied', NOT COALESCE((v_result ->> 'success')::boolean, FALSE)
    )
  );

  INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id,
    auth.uid(),
    'case_draft_create',
    CASE WHEN COALESCE((v_result ->> 'success')::boolean, FALSE)
      THEN 'case_entries' ELSE 'case_templates' END,
    COALESCE(v_new_case_id, v_template_id),
    jsonb_build_object(
      'request_id', p_request_id,
      'template_id', v_template_id,
      'status', v_result ->> 'status',
      'code', v_result ->> 'code'
    )
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.save_case_draft_command(TEXT, JSONB) IS
  'Creates an idempotent de-identified clinical draft after authoritative principal, template ownership, required-field, and PHI-boundary validation.';

REVOKE ALL ON FUNCTION public.save_case_draft_command(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_case_draft_command(TEXT, JSONB) TO authenticated;
