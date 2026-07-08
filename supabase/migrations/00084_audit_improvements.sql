-- ============================================================================
-- 00084_audit_improvements.sql
--
-- Phase 1 — Audit log schema improvements for structured data
-- and request correlation.
--
-- Modifies:
--   1. audit_logs — add metadata JSONB column for structured audit data
--   2. audit_logs — add session_id TEXT column for request correlation
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add metadata column for structured audit data
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN public.audit_logs.metadata IS
  'Structured audit metadata — request context, client info, additional attributes';

-- ---------------------------------------------------------------------------
-- 2. Add session_id for request correlation
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS session_id TEXT;

COMMENT ON COLUMN public.audit_logs.session_id IS
  'Request correlation ID for grouping related audit entries across services';

-- ---------------------------------------------------------------------------
-- 3. Partial index for non-null session_ids
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_session
  ON public.audit_logs(session_id)
  WHERE session_id IS NOT NULL;
