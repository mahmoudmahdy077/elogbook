-- ============================================================================
-- 00022: Add UNIQUE(tenant_id) to subscriptions table
--
-- The payment-webhook uses ON CONFLICT (tenant_id) for upsert, but
-- no UNIQUE constraint existed on tenant_id. This caused upsert to fail.
-- ============================================================================

-- Add unique constraint for upsert conflict resolution
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tenant_id_key UNIQUE (tenant_id);

-- Also add index on gateway_subscription_id for lookups in webhook
CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway_id
  ON subscriptions (gateway_subscription_id);
