-- Migration 00027: Add RLS to ai_response_cache
-- Previously had NO RLS — any authenticated user could read/write all cached AI responses

ALTER TABLE ai_response_cache ENABLE ROW LEVEL SECURITY;

-- Resident can read own cached responses
CREATE POLICY "Residents read own AI cache"
  ON ai_response_cache
  FOR SELECT
  USING (
    resident_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Edge function can insert new cache entries for own resident
CREATE POLICY "Insert AI cache"
  ON ai_response_cache
  FOR INSERT
  WITH CHECK (
    resident_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- Service role manages cache (cleanup, admin operations)
CREATE POLICY "Service role manages AI cache"
  ON ai_response_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
