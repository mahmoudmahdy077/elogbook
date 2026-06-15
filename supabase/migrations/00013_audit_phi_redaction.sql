-- ============================================================================
-- Audit PHI Redaction & Consent Tracking
-- ============================================================================

-- ============================================================================
-- 1. Fix audit_case_entry: NEVER log patient_mrn or patient_dob
--    The audit_logs table is not a HIPAA-compliant PHI container.
--    Always strip PHI fields regardless of is_deidentified status.
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_case_entry ON case_entries;
CREATE TRIGGER trg_audit_case_entry
  AFTER INSERT OR UPDATE OR DELETE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION audit_case_entry();

-- ============================================================================
-- 2. Consent records table
-- ============================================================================

CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('data_processing', 'ai_insights', 'data_export', 'marketing')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  version TEXT NOT NULL DEFAULT '1.0',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_records_tenant_user ON consent_records(tenant_id, user_id);
CREATE INDEX idx_consent_records_type ON consent_records(consent_type);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own consent records"
  ON consent_records FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admin can read all tenant consent records"
  ON consent_records FOR SELECT
  USING (tenant_id IN (
    SELECT t.id FROM tenants t
    JOIN profiles p ON p.tenant_id = t.id
    WHERE p.id = auth.uid()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  ));

CREATE POLICY "Users can insert own consent records"
  ON consent_records FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- 3. Data retention enforcement function
-- ============================================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- NOTE: To schedule enforce_data_retention() via pg_cron, configure it in the
-- Supabase dashboard under Database > Cron. Example schedule:
--   SELECT cron.schedule('enforce-data-retention', '0 3 * * *', $$SELECT enforce_data_retention()$$);