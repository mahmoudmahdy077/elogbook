-- Migration 00029: Add missing CHECK constraints and performance indexes

-- CHECK constraints
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded', 'cancelled'));

ALTER TABLE ai_query_logs ADD CONSTRAINT ai_query_logs_tokens_used_check
  CHECK (tokens_used >= 0);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_intent ON payments(gateway_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_one_time_purchases_resident ON one_time_purchases(resident_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_tenant_resident ON ai_query_logs(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created_at ON ai_query_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_entry_id ON approval_requests(entry_id);
