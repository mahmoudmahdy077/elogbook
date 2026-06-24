-- AI Response Cache Table
CREATE TABLE ai_response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  query_hash TEXT NOT NULL,
  query_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  tokens_used INTEGER,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(tenant_id, resident_id, query_hash)
);

CREATE INDEX idx_ai_response_cache_lookup 
  ON ai_response_cache(tenant_id, resident_id, query_hash);

-- Auto-cleanup function
CREATE OR REPLACE FUNCTION cleanup_ai_response_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_response_cache WHERE expires_at <= NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup every hour via pg_cron (uncomment to enable)
-- SELECT cron.schedule('cleanup-ai-cache', '0 * * * *', 'SELECT cleanup_ai_response_cache();');