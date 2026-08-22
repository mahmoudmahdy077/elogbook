CREATE INDEX IF NOT EXISTS idx_case_entries_deidentified ON case_entries(tenant_id) WHERE is_deidentified = true;
CREATE INDEX IF NOT EXISTS idx_case_entries_resident_status_active ON case_entries(resident_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_case_templates_tenant_specialty ON case_templates(tenant_id, specialty);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action ON audit_logs(tenant_id, action);
