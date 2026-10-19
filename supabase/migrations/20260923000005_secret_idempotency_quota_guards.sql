CREATE OR REPLACE FUNCTION public.store_tenant_webhook(
  p_url TEXT,
  p_events TEXT[],
  p_secret TEXT,
  p_description TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT true,
  p_webhook_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID := public.get_tenant_id();
  v_key TEXT;
  v_id UUID;
BEGIN
  IF COALESCE(public.get_user_role(), '') NOT IN ('institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;
  IF p_secret IS NULL OR char_length(p_secret) < 8 OR char_length(p_secret) > 4096 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_secret');
  END IF;
  IF current_setting('app.environment', true) = 'production'
     AND p_url NOT ILIKE 'https://%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'https_required');
  END IF;
  IF array_length(p_events, 1) IS NULL OR array_length(p_events, 1) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'events_required');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'encryption_unavailable');
  END IF;

  IF p_webhook_id IS NULL THEN
    IF (
      SELECT COUNT(*)
      FROM public.tenant_webhooks
      WHERE tenant_id = v_tenant_id
    ) >= 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'webhook_limit');
    END IF;

    INSERT INTO public.tenant_webhooks (
      tenant_id,
      url,
      events,
      secret,
      secret_enc,
      description,
      is_active
    )
    VALUES (
      v_tenant_id,
      p_url,
      p_events,
      '[ENCRYPTED]',
      extensions.pgp_sym_encrypt(p_secret, v_key),
      p_description,
      p_is_active
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.tenant_webhooks
    SET url = p_url,
        events = p_events,
        secret = '[ENCRYPTED]',
        secret_enc = extensions.pgp_sym_encrypt(p_secret, v_key),
        description = p_description,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_webhook_id
      AND tenant_id = v_tenant_id
    RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_tenant_webhook(TEXT, TEXT[], TEXT, TEXT, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE VIEW public.secret_tenant_webhooks AS
SELECT
  webhook.id,
  webhook.tenant_id,
  webhook.url,
  webhook.events,
  webhook.description,
  webhook.is_active,
  webhook.created_at,
  webhook.updated_at,
  CASE
    WHEN NULLIF(current_setting('app.encryption_key', true), '') IS NOT NULL
         AND webhook.secret_enc IS NOT NULL
    THEN extensions.pgp_sym_decrypt(
      webhook.secret_enc,
      current_setting('app.encryption_key')
    )
    ELSE NULL
  END AS secret
FROM public.tenant_webhooks AS webhook
WHERE public.get_user_role() = 'admin'
   OR (
     webhook.tenant_id = public.get_tenant_id()
     AND public.get_user_role() = 'institution_admin'
   );

ALTER VIEW public.secret_tenant_webhooks SET (security_barrier = true);
GRANT SELECT ON public.secret_tenant_webhooks TO authenticated;

CREATE OR REPLACE FUNCTION public.rotate_tenant_webhook_secrets(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key TEXT;
  v_count INTEGER;
  v_rotated INTEGER := 0;
  v_item JSONB;
  v_webhook_id UUID;
  v_tenant_id UUID;
  v_secret TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'invalid_items');
  END IF;

  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 100 THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'invalid_batch_size');
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'encryption_unavailable');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_webhook_id := (v_item ->> 'webhook_id')::UUID;
    v_tenant_id := (v_item ->> 'tenant_id')::UUID;
    v_secret := v_item ->> 'secret';

    IF v_secret IS NULL OR char_length(v_secret) < 8 OR char_length(v_secret) > 4096 THEN
      RAISE EXCEPTION 'invalid rotation item' USING ERRCODE = '22023';
    END IF;

    UPDATE public.tenant_webhooks
    SET secret = '[ENCRYPTED]',
        secret_enc = extensions.pgp_sym_encrypt(v_secret, v_key),
        updated_at = now()
    WHERE id = v_webhook_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'rotation target not found' USING ERRCODE = 'P0002';
    END IF;

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
      NULL::UUID,
      'tenant_webhook_secret_rotation',
      'tenant_webhooks',
      v_webhook_id,
      jsonb_build_object(
        'changed_fields',
        jsonb_build_array('secret', 'secret_enc')
      )
    );

    v_rotated := v_rotated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'rotated',
    'count', v_rotated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_tenant_webhook_secrets(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_tenant_webhook_secrets(JSONB) TO service_role;
GRANT SELECT (id, tenant_id, secret, secret_enc) ON public.tenant_webhooks TO service_role;
GRANT UPDATE (secret, secret_enc, updated_at) ON public.tenant_webhooks TO service_role;
GRANT INSERT ON public.audit_logs TO service_role;

DO $$
DECLARE
  v_functions REGPROCEDURE[];
  v_function REGPROCEDURE;
BEGIN
  SELECT COALESCE(array_agg(function_record.oid::REGPROCEDURE), ARRAY[]::REGPROCEDURE[])
  INTO v_functions
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
  WHERE schema_record.nspname = 'public'
    AND function_record.proname ILIKE '%backup%';

  FOREACH v_function IN ARRAY v_functions
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp',
      v_function
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_function
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_table REGCLASS := to_regclass('public.case_operation_log');
  v_scoped_columns SMALLINT[];
  v_constraint_name NAME;
BEGIN
  IF v_table IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(attribute_record.attnum::SMALLINT ORDER BY column_record.ordinality)
  INTO v_scoped_columns
  FROM unnest(ARRAY['op_id', 'tenant_id', 'actor_profile_id']) WITH ORDINALITY AS column_record(column_name, ordinality)
  JOIN pg_attribute AS attribute_record
    ON attribute_record.attrelid = v_table
   AND attribute_record.attname = column_record.column_name
   AND NOT attribute_record.attisdropped;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = v_table
      AND constraint_record.contype IN ('p', 'u')
      AND constraint_record.conkey = v_scoped_columns
  ) THEN
    RETURN;
  END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ux_case_operation_log_scope ON public.case_operation_log (op_id, tenant_id, actor_profile_id)';

  FOR v_constraint_name IN
    SELECT constraint_record.conname
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = v_table
      AND constraint_record.contype = 'p'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.case_operation_log DROP CONSTRAINT %I',
      v_constraint_name
    );
  END LOOP;

  EXECUTE 'ALTER TABLE public.case_operation_log ADD CONSTRAINT case_operation_log_op_scope_key UNIQUE USING INDEX ux_case_operation_log_scope';
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_case_entries_client_op_scope
  ON public.case_entries (tenant_id, resident_id, client_operation_id)
  WHERE client_operation_id IS NOT NULL;

DROP INDEX IF EXISTS public.ux_case_entries_client_op;

CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_resident_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_new_used INTEGER;
  v_limit INTEGER;
  v_profile_id UUID;
  v_tenant_id UUID;
  v_role TEXT;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota count' USING ERRCODE = '22023';
  END IF;

  SELECT principal.profile_id, principal.tenant_id, principal.role
  INTO v_profile_id, v_tenant_id, v_role
  FROM public.get_authoritative_principal() AS principal;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;

  IF v_profile_id <> p_resident_id THEN
    IF COALESCE(v_role, '') NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('error', 'cannot consume quota for another resident', 'code', 'forbidden');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.resident_ai_toggle
      WHERE resident_id = p_resident_id
        AND tenant_id = v_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'cross-tenant quota consumption', 'code', 'forbidden');
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_used = quota_used + p_count
  WHERE resident_id = p_resident_id
    AND tenant_id = v_tenant_id
    AND enabled = true
    AND (quota_limit = 0 OR quota_used + p_count <= quota_limit)
  RETURNING quota_used, quota_limit
  INTO v_new_used, v_limit;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'quota exceeded or ai disabled',
      'code', 'quota_exceeded',
      'quota_used', 0,
      'quota_limit', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'quota_used', v_new_used,
    'quota_limit', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_ai_quota(
  p_resident_id UUID,
  p_count INTEGER DEFAULT 1
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
  v_new_used INTEGER;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota count' USING ERRCODE = '22023';
  END IF;

  SELECT principal.profile_id, principal.tenant_id, principal.role
  INTO v_profile_id, v_tenant_id, v_role
  FROM public.get_authoritative_principal() AS principal;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;

  IF v_profile_id <> p_resident_id THEN
    IF COALESCE(v_role, '') NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('error', 'cannot release quota for another resident', 'code', 'forbidden');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.resident_ai_toggle
      WHERE resident_id = p_resident_id
        AND tenant_id = v_tenant_id
    ) THEN
      RETURN jsonb_build_object('error', 'cross-tenant quota release', 'code', 'forbidden');
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_used = GREATEST(0, quota_used - p_count)
  WHERE resident_id = p_resident_id
    AND tenant_id = v_tenant_id
  RETURNING quota_used INTO v_new_used;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'resident not found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'quota_used', v_new_used
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_ai_quota(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.grant_ai_quota(
  p_resident_id UUID,
  p_new_limit INTEGER,
  p_reset BOOLEAN DEFAULT true
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
BEGIN
  IF p_new_limit IS NULL OR p_new_limit < 0 OR p_new_limit > 1000000 THEN
    RAISE EXCEPTION 'invalid quota limit' USING ERRCODE = '22023';
  END IF;

  SELECT principal.profile_id, principal.tenant_id, principal.role
  INTO v_profile_id, v_tenant_id, v_role
  FROM public.get_authoritative_principal() AS principal;

  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;
  IF COALESCE(v_role, '') NOT IN ('director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden', 'code', 'forbidden');
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_limit = p_new_limit,
      quota_used = CASE WHEN p_reset THEN 0 ELSE quota_used END,
      enabled = true
  WHERE resident_id = p_resident_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'resident not found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'resident_id', p_resident_id,
    'quota_limit', p_new_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_ai_quota(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_ai_quota(UUID, INTEGER, BOOLEAN) TO authenticated;

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
    RETURN jsonb_build_object('success', false, 'error', 'policy: profile_not_found');
  END IF;
  IF v_profile_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: account_suspended');
  END IF;
  IF v_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'policy: tenant_suspended');
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
    '{"success":false,"error":"in_progress"}'::JSONB
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
          'error', 'transient: op_in_progress'
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
            'error', 'validation: invalid_column:' || v_key
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
          'error', 'policy: identifiable_not_permitted'
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
          'error', 'validation: missing_row_id'
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
        v_result := jsonb_build_object('success', false, 'error', 'not_found');
        EXIT work;
      END IF;
      IF v_row.resident_id <> v_profile_id
         AND COALESCE(v_role, '') NOT IN (
           'supervisor',
           'director',
           'institution_admin',
           'admin'
         ) THEN
        v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
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
          'error', 'policy: approved_locked'
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
            'error', 'validation: immutable_column:' || v_key
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
            'error', 'validation: invalid_column:' || v_key
          );
          EXIT work;
        END IF;
      END LOOP;

      IF p_payload ? 'is_deidentified'
         AND (p_payload ->> 'is_deidentified')::BOOLEAN
           IS DISTINCT FROM v_row.is_deidentified THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: mode_immutable'
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
           OR (
             p_payload ? 'patient_dob'
             AND NULLIF(p_payload ->> 'patient_dob', '')::DATE
               IS DISTINCT FROM v_row.patient_dob
           )
         ) THEN
        v_result := jsonb_build_object(
          'success', false,
          'error', 'policy: identifier_locked'
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
          'error', 'validation: missing_row_id'
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
          v_result := jsonb_build_object('success', false, 'error', 'not_found');
        END IF;
      ELSIF v_row.resident_id <> v_profile_id
        AND COALESCE(v_role, '') NOT IN (
          'supervisor',
          'director',
          'institution_admin',
          'admin'
        ) THEN
        v_result := jsonb_build_object('success', false, 'error', 'policy: forbidden');
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
    v_result := jsonb_build_object(
      'success', false,
      'error', 'db: ' || LEFT(SQLERRM, 300)
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
      'denied', COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) = FALSE
    )
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_case_operation(TEXT, TEXT, UUID, JSONB) TO authenticated;
