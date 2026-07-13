-- P3.3: Performance indexes for common query patterns

-- Case entries: tenant + status + date (dashboard queries)
CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_status_created
  ON public.case_entries(tenant_id, status, created_at DESC);

-- Audit logs: tenant + created_at (audit trail queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_desc
  ON public.audit_logs(tenant_id, created_at DESC);

-- Profiles: tenant + role (user management)
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role_active
  ON public.profiles(tenant_id, role) WHERE role IN ('resident', 'supervisor');

-- Duty periods: tenant + date (duty hour reports)
CREATE INDEX IF NOT EXISTS idx_duty_periods_tenant_date_range
  ON public.duty_periods(tenant_id, shift_date);
