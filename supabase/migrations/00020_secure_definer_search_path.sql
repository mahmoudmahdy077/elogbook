-- ============================================================================
-- 00020: Add SET search_path to ALL SECURITY DEFINER functions
-- 
-- Without explicit search_path, SECURITY DEFINER functions are vulnerable to
-- search-path hijacking attacks. Setting search_path = '' (empty string)
-- ensures only pg_catalog is in the search path, preventing schema-based
-- privilege escalation.
-- Also fixes: hash_patient_mrn IMMUTABLE → STABLE (depends on current_setting)
-- ============================================================================

-- 1. update_updated_at (00001)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 2. get_tenant_id (00002)
CREATE OR REPLACE FUNCTION get_tenant_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::jsonb->>'tenant_id',
    (auth.jwt() ->> 'tenant_id')::UUID
  )::UUID;
END;
$$;

-- 3. get_user_role (00002)
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::jsonb->>'user_role',
    auth.jwt() ->> 'user_role',
    'resident'
  );
END;
$$;

-- 4. audit_case_entry (00003, redeclared in 00013)
CREATE OR REPLACE FUNCTION audit_case_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_user_agent TEXT;
  v_session_id TEXT;
  v_row JSONB;
  v_changed_fields JSONB;
BEGIN
  v_user_id := auth.uid();
  v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  v_session_id := COALESCE(
    current_setting('request.headers', true)::JSONB ->> 'x-session-id',
    auth.jwt() ->> 'session_id'
  );

  IF TG_OP = 'INSERT' THEN
    v_row := row_to_json(NEW)::JSONB - 'patient_mrn' - 'patient_dob';

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'INSERT',
      'case_entries',
      NEW.id,
      jsonb_build_object(
        'new', v_row,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_changed_fields := (
      SELECT jsonb_object_agg(key, jsonb_build_object('old', OLD_val, 'new', NEW_val))
      FROM (
        SELECT key,
               (row_to_json(OLD)::JSONB - 'patient_mrn' - 'patient_dob' -> key) AS OLD_val,
               (row_to_json(NEW)::JSONB - 'patient_mrn' - 'patient_dob' -> key) AS NEW_val
        FROM jsonb_object_keys(row_to_json(OLD)::JSONB || row_to_json(NEW)::JSONB) AS t(key)
      ) sub
      WHERE OLD_val IS DISTINCT FROM NEW_val
        AND key NOT IN ('created_at', 'updated_at', 'patient_mrn', 'patient_dob')
    );

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'UPDATE',
      'case_entries',
      NEW.id,
      jsonb_build_object(
        'changed_fields', v_changed_fields,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_row := row_to_json(OLD)::JSONB - 'patient_mrn' - 'patient_dob';

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      OLD.tenant_id,
      v_user_id,
      'DELETE',
      'case_entries',
      OLD.id,
      jsonb_build_object(
        'deleted', v_row,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 5. auto_approve_individual (00003)
CREATE OR REPLACE FUNCTION auto_approve_individual()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenants
    WHERE id = NEW.tenant_id
    AND tenant_type = 'individual'
  ) THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 6. recalc_goal_progress (00003)
CREATE OR REPLACE FUNCTION recalc_goal_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_resident_id UUID;
  v_tenant_id UUID;
  goal_record RECORD;
  v_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_resident_id := OLD.resident_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_resident_id := NEW.resident_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  FOR goal_record IN
    SELECT pg.id, pg.resident_id
    FROM program_goals pg
    WHERE pg.resident_id = v_resident_id
    AND pg.tenant_id = v_tenant_id
  LOOP
    SELECT COUNT(*) INTO v_count
    FROM case_entries ce
    WHERE ce.resident_id = goal_record.resident_id
    AND ce.tenant_id = v_tenant_id
    AND ce.status = 'approved'
    AND (goal_record.specialty IS NULL OR ce.template_id IN (
      SELECT ct.id FROM case_templates ct WHERE ct.specialty = goal_record.specialty AND ct.tenant_id = v_tenant_id
    ));

    INSERT INTO goal_progress (goal_id, resident_id, current_count, last_updated)
    VALUES (goal_record.id, goal_record.resident_id, v_count, NOW())
    ON CONFLICT (goal_id)
    DO UPDATE SET current_count = EXCLUDED.current_count, last_updated = NOW();
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 7. get_case_stats (00003, redeclared in 00012/00016)
CREATE OR REPLACE FUNCTION get_case_stats(
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_tenant_id UUID;
BEGIN
  v_tenant_id := get_tenant_id();

  SELECT jsonb_build_object(
    'total_cases', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)), 0),
    'by_status', (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::JSONB) FROM (
      SELECT status, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY status
    ) sub),
    'by_specialty', (SELECT COALESCE(jsonb_object_agg(ct.specialty, cnt), '{}'::JSONB) FROM (
      SELECT ct.specialty, COUNT(*) AS cnt FROM case_entries ce
      JOIN case_templates ct ON ct.id = ce.template_id
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY ct.specialty
    ) sub),
    'by_month', (SELECT COALESCE(jsonb_object_agg(month, cnt), '{}'::JSONB) FROM (
      SELECT to_char(ce.case_date, 'YYYY-MM') AS month, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)
      GROUP BY month ORDER BY month
    ) sub),
    'pending_approvals', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
      AND ce.deleted_at IS NULL
      AND ce.status = 'pending'), 0),
    'rejection_rate', CASE
      WHEN (SELECT COUNT(*) FROM case_entries ce
        WHERE ce.tenant_id = v_tenant_id
        AND ce.deleted_at IS NULL
        AND ce.status IN ('approved', 'rejected')) > 0
      THEN ROUND(
        ((SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL AND ce.status = 'rejected')::NUMERIC
        / (SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_tenant_id AND ce.deleted_at IS NULL AND ce.status IN ('approved', 'rejected'))::NUMERIC) * 100, 2
      )
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- 8. write_once_submitted_check (00003)
CREATE OR REPLACE FUNCTION write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_user_role();
  IF v_role = 'resident' AND OLD.status != 'draft' THEN
    RAISE EXCEPTION 'Cannot modify case entry once submitted (status: %)', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 9. audit_accreditation_framework (00003)
CREATE OR REPLACE FUNCTION audit_accreditation_framework()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_user_agent TEXT;
  v_session_id TEXT;
BEGIN
  v_user_id := auth.uid();
  v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  v_session_id := COALESCE(
    current_setting('request.headers', true)::JSONB ->> 'x-session-id',
    auth.jwt() ->> 'session_id'
  );

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'INSERT',
      'accreditation_frameworks',
      NEW.id,
      jsonb_build_object(
        'name', NEW.name,
        'version', NEW.version,
        'framework_type', NEW.framework_type,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'UPDATE',
      'accreditation_frameworks',
      NEW.id,
      jsonb_build_object(
        'name', NEW.name,
        'version', NEW.version,
        'framework_type', NEW.framework_type,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      OLD.tenant_id,
      v_user_id,
      'DELETE',
      'accreditation_frameworks',
      OLD.id,
      jsonb_build_object(
        'name', OLD.name,
        'version', OLD.version,
        'framework_type', OLD.framework_type,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 10. handle_new_user (00004, redeclared in 00012)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  IF role_text NOT IN ('resident', 'supervisor') THEN
    role_text := 'resident';
  END IF;

  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (NEW.email, 'user-' || NEW.id, 'individual')
  RETURNING id INTO new_tenant_id;

  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 11. hash_patient_mrn (00007/00011) - Fix: IMMUTABLE → STABLE
CREATE OR REPLACE FUNCTION hash_patient_mrn(p_mrn TEXT, p_tenant_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_salt TEXT;
BEGIN
  v_salt := COALESCE(
    current_setting('app.mrn_salt', true),
    'elogbook-mrn-salt-v1'
  );
  RETURN encode(digest(p_mrn || v_salt || p_tenant_id::text, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

-- 12. approve_case (00009, redeclared in 00012)
CREATE OR REPLACE FUNCTION approve_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'approved' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'approved', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'approved', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 13. reject_case (00009, redeclared in 00012)
CREATE OR REPLACE FUNCTION reject_case(
  p_entry_id UUID,
  p_supervisor_id UUID,
  p_comment TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_status TEXT;
  v_approval_id UUID;
  v_tenant_id UUID;
BEGIN
  IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'Insufficient permissions', 'code', 'forbidden');
  END IF;

  SELECT status, tenant_id INTO v_status, v_tenant_id
  FROM case_entries
  WHERE id = p_entry_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Case not found', 'code', 'not_found');
  END IF;

  IF v_tenant_id != get_tenant_id() THEN
    RETURN jsonb_build_object('error', 'Case does not belong to your tenant', 'code', 'forbidden');
  END IF;

  IF v_status != 'pending' THEN
    RETURN jsonb_build_object(
      'error', 'Case already reviewed',
      'code', 'already_reviewed',
      'current_status', v_status
    );
  END IF;

  UPDATE case_entries SET status = 'rejected' WHERE id = p_entry_id;

  INSERT INTO approval_requests (entry_id, supervisor_id, status, comment, resolved_at)
  VALUES (p_entry_id, p_supervisor_id, 'rejected', p_comment, NOW())
  ON CONFLICT (entry_id, supervisor_id)
  DO UPDATE SET status = 'rejected', comment = p_comment, resolved_at = NOW()
  RETURNING id INTO v_approval_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'approval_id', v_approval_id,
    'status', 'rejected'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 14. block_lapsed_tenant_submit (00010)
CREATE OR REPLACE FUNCTION block_lapsed_tenant_submit()
RETURNS TRIGGER AS $$
BEGIN
  IF get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'pending' THEN
    IF EXISTS (
      SELECT 1 FROM subscriptions
      WHERE subscriptions.tenant_id = NEW.tenant_id
        AND subscriptions.status IN ('past_due', 'unpaid')
    ) THEN
      RAISE EXCEPTION 'Cannot submit case for approval: subscription lapsed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 15. enforce_case_status_transition (00011)
CREATE OR REPLACE FUNCTION enforce_case_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE OLD.status
      WHEN 'draft' THEN
        IF NEW.status NOT IN ('draft', 'pending') THEN
          RAISE EXCEPTION 'Invalid status transition: draft -> %. Allowed: draft, pending', NEW.status;
        END IF;
      WHEN 'pending' THEN
        IF NEW.status NOT IN ('approved', 'rejected') THEN
          RAISE EXCEPTION 'Invalid status transition: pending -> %. Allowed: approved, rejected', NEW.status;
        END IF;
      WHEN 'approved' THEN
        RAISE EXCEPTION 'Invalid status transition: approved is immutable. No transitions allowed.';
      WHEN 'rejected' THEN
        IF NEW.status != 'draft' THEN
          RAISE EXCEPTION 'Invalid status transition: rejected -> %. Allowed: draft', NEW.status;
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown status: %', OLD.status;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 16. enforce_data_retention (00013)
CREATE OR REPLACE FUNCTION enforce_data_retention()
RETURNS TABLE(tenant_id UUID, tenant_name TEXT, records_soft_deleted BIGINT) AS $$
DECLARE
  v_tenant RECORD;
  v_count BIGINT;
BEGIN
  FOR v_tenant IN
    SELECT id, name, data_retention_days
    FROM tenants
    WHERE data_retention_days IS NOT NULL
  LOOP
    UPDATE case_entries
    SET deleted_at = NOW()
    WHERE tenant_id = v_tenant.id
      AND deleted_at IS NULL
      AND created_at < NOW() - (v_tenant.data_retention_days || ' days')::INTERVAL;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    tenant_id := v_tenant.id;
    tenant_name := v_tenant.name;
    records_soft_deleted := v_count;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 17. refresh_case_stats_mv (00016)
CREATE OR REPLACE FUNCTION refresh_case_stats_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY case_stats_mv;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 18. cleanup_ai_response_cache (00018)
CREATE OR REPLACE FUNCTION cleanup_ai_response_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_response_cache WHERE expires_at <= NOW();
END;
$$ LANGUAGE plpgsql SET search_path = '';
