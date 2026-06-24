-- Migration 00026: Fix stripe_events RLS policy
-- The previous policy used current_user which never matches service_role
-- because PostgreSQL's current_user returns the database role (authenticated/anon)
-- not the JWT claim. Use auth.role() instead.

-- Drop broken policy
DROP POLICY IF EXISTS "Only service role can manage stripe_events" ON stripe_events;

-- Create corrected policy using auth.role() which checks the JWT role claim
CREATE POLICY "Only service role can manage stripe_events"
  ON stripe_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
