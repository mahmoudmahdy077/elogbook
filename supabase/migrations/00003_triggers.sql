-- ============================================================================
-- Database Triggers & Functions
-- ============================================================================

-- ============================================================================
-- 1. audit_case_entry: INSERT/UPDATE/DELETE on case_entries → audit_logs
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_case_entry()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_user_agent TEXT;
  v_session_id TEXT;
  v_row JSONB;
  v_deleted_row JSONB;
BEGIN
  v_user_id := auth.uid();
  v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  v_session_id := COALESCE(
    current_setting('request.headers', true)::JSONB ->> 'x-session-id',
    auth.jwt() ->> 'session_id'
  );

  IF TG_OP = 'INSERT' THEN
    v_row := row_to_json(NEW)::JSONB;
    IF (NEW.is_deidentified) THEN
      v_row := v_row - 'patient_mrn' - 'patient_dob';
    END IF;

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
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'UPDATE',
      'case_entries',
      NEW.id,
      jsonb_build_object(
        'changed_fields', (
          SELECT jsonb_object_agg(key, jsonb_build_object('old', OLD_val, 'new', NEW_val))
          FROM (
            SELECT key,
                   (row_to_json(OLD)::JSONB -> key) AS OLD_val,
                   (row_to_json(NEW)::JSONB -> key) AS NEW_val
            FROM jsonb_object_keys(row_to_json(OLD)::JSONB || row_to_json(NEW)::JSONB) AS t(key)
          ) sub
          WHERE OLD_val IS DISTINCT FROM NEW_val
            AND key NOT IN ('created_at', 'updated_at')
        ),
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_deleted_row := row_to_json(OLD)::JSONB;
    IF (OLD.is_deidentified) THEN
      v_deleted_row := v_deleted_row - 'patient_mrn' - 'patient_dob';
    END IF;

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      OLD.tenant_id,
      v_user_id,
      'DELETE',
      'case_entries',
      OLD.id,
      jsonb_build_object(
        'deleted', v_deleted_row,
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_case_entry
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION audit_case_entry();

-- ============================================================================
-- 2. auto_approve_individual: auto-set status='approved' for individual tenants
--    BEFORE INSERT/UPDATE on case_entries
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_approve_individual
  BEFORE INSERT OR UPDATE ON case_entries
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION auto_approve_individual();

-- ============================================================================
-- 3. update_goal_progress: AFTER INSERT/UPDATE/DELETE on case_entries
--    → recalculate goal_progress for affected resident
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_goal_progress
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION recalc_goal_progress();

-- ============================================================================
-- 4. get_case_stats RPC function returning JSONB
-- ============================================================================

CREATE OR REPLACE FUNCTION get_case_stats(
  p_tenant_id UUID DEFAULT NULL,
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_effective_tenant_id UUID;
BEGIN
  v_effective_tenant_id := COALESCE(p_tenant_id, get_tenant_id());

  SELECT jsonb_build_object(
    'total_cases', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_effective_tenant_id
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)), 0),
    'by_status', (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::JSONB) FROM (
      SELECT status, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_effective_tenant_id
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY status
    ) sub),
    'by_specialty', (SELECT COALESCE(jsonb_object_agg(ct.specialty, cnt), '{}'::JSONB) FROM (
      SELECT ct.specialty, COUNT(*) AS cnt FROM case_entries ce
      JOIN case_templates ct ON ct.id = ce.template_id
      WHERE ce.tenant_id = v_effective_tenant_id
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      GROUP BY ct.specialty
    ) sub),
    'by_month', (SELECT COALESCE(jsonb_object_agg(month, cnt), '{}'::JSONB) FROM (
      SELECT to_char(ce.case_date, 'YYYY-MM') AS month, COUNT(*) AS cnt FROM case_entries ce
      WHERE ce.tenant_id = v_effective_tenant_id
      AND (p_resident_id IS NULL OR ce.resident_id = p_resident_id)
      AND (p_from_date IS NULL OR ce.case_date >= p_from_date)
      AND (p_to_date IS NULL OR ce.case_date <= p_to_date)
      GROUP BY month ORDER BY month
    ) sub),
    'pending_approvals', COALESCE((SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_effective_tenant_id
      AND ce.status = 'pending'), 0),
    'rejection_rate', CASE
      WHEN (SELECT COUNT(*) FROM case_entries ce
        WHERE ce.tenant_id = v_effective_tenant_id
        AND ce.status IN ('approved', 'rejected')) > 0
      THEN ROUND(
        ((SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_effective_tenant_id AND ce.status = 'rejected')::NUMERIC
        / (SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_effective_tenant_id AND ce.status IN ('approved', 'rejected'))::NUMERIC) * 100, 2
      )
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- 5. write_once_submitted_check: blocks residents from modifying submitted entries
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_write_once_submitted_check
  BEFORE UPDATE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION write_once_submitted_check();

-- ============================================================================
-- 6. audit_accreditation_framework: logs framework name, version, type
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_accreditation_framework
    AFTER INSERT OR UPDATE OR DELETE ON accreditation_frameworks
    FOR EACH ROW EXECUTE FUNCTION audit_accreditation_framework();
EXCEPTION WHEN undefined_table THEN NULL; END $$;
