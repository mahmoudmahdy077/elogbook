-- ============================================================================
-- 00025: BRIN indexes for time-series tables + PHI check constraint
-- ============================================================================

-- BRIN indexes are much more efficient than B-tree for monotonically
-- increasing values (like created_at) on large append-only tables.
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin
  ON audit_logs USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created_at_brin
  ON ai_query_logs USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at_brin
  ON ai_response_cache USING BRIN (expires_at);

CREATE INDEX IF NOT EXISTS idx_case_entries_created_at_brin
  ON case_entries USING BRIN (created_at);

-- B-tree index on expires_at for cleanup function performance
CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at
  ON ai_response_cache USING BTREE (expires_at);

-- PHI check constraint: when is_deidentified = true, PHI columns must be NULL
-- First clean existing records that violate this constraint
UPDATE case_entries
SET patient_mrn = NULL, patient_dob = NULL
WHERE is_deidentified = true
  AND (patient_mrn IS NOT NULL OR patient_dob IS NOT NULL);

ALTER TABLE case_entries ADD CONSTRAINT deidentified_no_phi
  CHECK (NOT is_deidentified OR (patient_mrn IS NULL AND patient_dob IS NULL));
