-- ============================================================================
-- 00024: Add quota_used column and atomic decrement support
--
-- The ai-insights edge function references quota_used but the column
-- never existed in resident_ai_toggle. This made quota enforcement
-- non-functional (quota_used was always null, so quota_used >= quota_limit
-- was always false, meaning unlimited queries).
-- ============================================================================

ALTER TABLE resident_ai_toggle
  ADD COLUMN IF NOT EXISTS quota_used INTEGER NOT NULL DEFAULT 0;

-- Prevent negative quota (safety check for atomic decrement)
ALTER TABLE resident_ai_toggle
  ADD CONSTRAINT quota_used_non_negative CHECK (quota_used >= 0);
