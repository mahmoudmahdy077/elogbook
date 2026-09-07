-- Owner-run platform operator grant (T17).
-- Run with psql/service access as the installation owner. NEVER auto-run:
-- the first operator is attested out-of-band (bootstrap), every later
-- grant requires a CURRENT active operator (replace :granted_by with one).
--
--   psql $DATABASE_URL -v operator_email='boss@example.com' \
--     -v granted_by='00000000-0000-0000-0000-000000000000' \
--     -v reason='initial bootstrap operator' \
--     -f scripts/grant-platform-admin.sql
--
-- Verify afterwards:
--   SELECT user_id, status, created_at FROM platform_admins;

WITH target AS (
  SELECT id FROM auth.users WHERE email = :'operator_email'
)
INSERT INTO platform_admins (user_id, status, granted_by, reason)
SELECT id, 'active', NULLIF(:'granted_by', '')::uuid, :'reason'
FROM target
ON CONFLICT (user_id) DO UPDATE SET status = 'active', updated_at = NOW();
