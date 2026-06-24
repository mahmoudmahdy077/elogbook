-- ============================================================================
-- 00021: Create stripe_events table for webhook idempotency
--
-- The payment-webhook edge function references this table but it was
-- never created in any migration. This causes webhook processing to fail.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Only service-role should access this (webhook processing)
CREATE POLICY "Only service role can manage stripe_events"
  ON stripe_events
  USING (current_user = 'service_role')
  WITH CHECK (current_user = 'service_role');
