-- ============================================================================
-- 20261126000100_public_read_subscription_plans.sql
--
-- /pricing is a public page. It reads subscription_plans with the server-side
-- anon client, but the only SELECT policy was `TO authenticated`, so RLS
-- filtered every row and the page rendered an empty grid in production.
-- The table holds public price-list data (name, price, feature flags) and no
-- tenant or personal data, so anon may read it.
--
-- The admin write policies are unchanged: anon still cannot INSERT/UPDATE or
-- DELETE, even though it holds the table grants.
--
-- destructive: no — adds one SELECT policy; removes no rows or tables.
-- ============================================================================

DROP POLICY IF EXISTS "Public can read subscription plans" ON subscription_plans;

CREATE POLICY "Public can read subscription plans"
  ON subscription_plans FOR SELECT
  TO anon
  USING (true);
