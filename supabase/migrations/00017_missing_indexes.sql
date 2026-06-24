-- Migration: 00017_missing_indexes.sql
-- Description: Add missing database indexes for query performance
-- Created: 2026-06-23

-- 1. For "my cases" queries (resident + status filter)
CREATE INDEX IF NOT EXISTS idx_case_entries_resident_status
  ON case_entries(resident_id, status)
  WHERE deleted_at IS NULL;

-- 2. For approval dashboard (supervisor + status filter)
CREATE INDEX IF NOT EXISTS idx_approval_requests_supervisor_status
  ON approval_requests(supervisor_id, status)
  WHERE supervisor_id IS NOT NULL;

-- 3. For AI quota checks (resident + date range)
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_resident_date
  ON ai_query_logs(resident_id, created_at DESC)
  WHERE resident_id IS NOT NULL;

-- 4. For cursor pagination (tenant + resident + created_at + id)
CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_resident_created
  ON case_entries(tenant_id, resident_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- 5. For audit logs user lookups
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_tenant
  ON audit_logs(user_id, tenant_id)
  WHERE user_id IS NOT NULL;