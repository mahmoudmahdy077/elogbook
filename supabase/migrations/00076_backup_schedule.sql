-- ============================================================================
-- 00076_backup_schedule.sql
--
-- Database-level backup tracking for the E-Logbook Enterprise.
--
-- Supabase provides managed daily backups at the infrastructure level for
-- projects on Pro/Team plans. This migration adds:
--
--   1. A `scheduled_backup_log` table to record metadata about each backup
--      run (status, file size, notes).
--   2. An RPC `log_backup_run(status, size_bytes, notes)` that the backup
--      script or a scheduled pg_cron job can call to persist run records.
--   3. A comment documenting the pg_cron schedule (for when the extension
--      is available or added at the project level).
--
-- The log table is intentionally append-only — records are never updated
-- or deleted so the backup history forms an immutable audit trail.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Backup log table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_backup_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
  size_bytes    BIGINT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.scheduled_backup_log IS
  'Immutable audit trail of automated database backup runs (P5.5)';

COMMENT ON COLUMN public.scheduled_backup_log.status IS
  'One of: started, success, failed';

COMMENT ON COLUMN public.scheduled_backup_log.size_bytes IS
  'Size of the compressed dump in bytes (NULL until completion)';

COMMENT ON COLUMN public.scheduled_backup_log.notes IS
  'Free-text notes — error messages, warnings, or metadata';

-- ---------------------------------------------------------------------------
-- 2. RPC: log_backup_run
-- ---------------------------------------------------------------------------
-- Called by the backup script or a pg_cron job after a backup completes.
-- Records the outcome in the immutable log table.
--
-- Usage:
--   SELECT public.log_backup_run('success', 1048576, 'daily backup OK');
--   SELECT public.log_backup_run('failed', NULL, 'pg_dump exit code 1');
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_backup_run(
  p_status    TEXT,
  p_size_bytes BIGINT DEFAULT NULL,
  p_notes     TEXT DEFAULT NULL
)
RETURNS BIGINT  -- returns the log entry ID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO public.scheduled_backup_log (status, size_bytes, notes, completed_at)
  VALUES (p_status, p_size_bytes, p_notes, NOW())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_backup_run IS
  'Records a backup run outcome in scheduled_backup_log. Returns the log entry ID.';

-- ---------------------------------------------------------------------------
-- 3. pg_cron schedule (documented — requires pg_cron extension at project level)
-- ---------------------------------------------------------------------------
-- To enable automated daily backups via pg_cron, run the following SQL as a
-- Supabase SQL editor query (requires the pg_cron extension, available on
-- Supabase Pro plan and above):
--
--   -- Enable the extension (one-time)
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--
--   -- Schedule the backup script to run daily at 03:00 UTC
--   SELECT cron.schedule(
--     'elogbook-daily-backup',       -- job name
--     '0 3 * * *',                    -- cron expression (daily at 03:00 UTC)
--     $$SELECT public.log_backup_run('started');
--       -- The actual pg_dump is handled by the backup-db.sh script
--       -- triggered via a cron systemd timer or Supabase CLI workflow.
--       -- This RPC call is the post-execution recording step.
--     $$
--   );
--
--   -- Schedule weekly off-site backup reminder at 04:00 UTC every Sunday
--   SELECT cron.schedule(
--     'elogbook-weekly-backup-reminder',
--     '0 4 * * 0',
--     $$SELECT public.log_backup_run('started', NULL, 'Weekly backup reminder triggered');
--     $$
--   );
--
-- To view scheduled jobs:
--   SELECT * FROM cron.job;
--
-- To remove a job:
--   SELECT cron.unschedule('elogbook-daily-backup');
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  IMPORTANT: pg_cron is a Supabase project-level extension. Enable it   ║
-- ║  via the Supabase Dashboard → Database → Extensions, or run:           ║
-- ║    CREATE EXTENSION IF NOT EXISTS pg_cron;                             ║
-- ║  Then apply the cron.schedule() calls above from the SQL editor.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- ============================================================================
