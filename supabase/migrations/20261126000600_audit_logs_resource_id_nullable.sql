-- ============================================================================
-- 20261126000600_audit_logs_resource_id_nullable.sql
--
-- audit_logs.resource_id was NOT NULL, but two audit writers legitimately have
-- no single target resource and passed NULL:
--
--   * POST /api/[tenant]/admin/invite  (action='invite_user')
--   * GET  /api/[tenant]/audit/export  (action='audit_export')
--
-- Both inserts failed with 23502 (null value in column "resource_id") and the
-- route awaited them without checking the error, so the audit row was silently
-- dropped: invitations and audit exports left no trace at all.
--
-- The audit UI already types the column as `string | null` and renders a
-- placeholder, so a nullable column is the intended model: a resource_id is
-- optional for tenant-level events.
--
-- destructive: no — widens a NOT NULL constraint; existing rows unchanged.
-- ============================================================================

ALTER TABLE public.audit_logs
  ALTER COLUMN resource_id DROP NOT NULL;

COMMENT ON COLUMN public.audit_logs.resource_id IS
  'Target row of the action; NULL for tenant-level events (invite send, audit export).';
