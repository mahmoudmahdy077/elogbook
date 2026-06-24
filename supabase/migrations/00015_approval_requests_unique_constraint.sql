-- ============================================================================
-- 00015: Add UNIQUE CONSTRAINT on approval_requests(entry_id, supervisor_id)
-- ============================================================================
-- Migration 00011 created a UNIQUE INDEX but ON CONFLICT requires a CONSTRAINT.
-- The approve_case() and reject_case() functions use:
--   ON CONFLICT (entry_id, supervisor_id)
-- which needs a UNIQUE CONSTRAINT, not just an index.
-- Must drop index first (same name conflict), then create constraint.

DO $$
BEGIN
  -- Drop the index if it exists (same name as desired constraint)
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'approval_requests_entry_supervisor_unique'
  ) THEN
    DROP INDEX approval_requests_entry_supervisor_unique;
  END IF;
  
  -- Now create the constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'approval_requests_entry_supervisor_unique'
  ) THEN
    ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_entry_supervisor_unique
    UNIQUE (entry_id, supervisor_id);
  END IF;
END $$;

-- Verify the constraint exists and can be used by ON CONFLICT
-- Note: The index from 00011 will be used by the constraint automatically