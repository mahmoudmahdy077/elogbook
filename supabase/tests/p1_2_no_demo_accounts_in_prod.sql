-- supabase/tests/p1_2_no_demo_accounts_in_prod.sql
-- Run with: supabase db test
-- Asserts that no auth.users row has a @demo.com email when
-- app.enable_demo_migrations is unset or 'false'.

SELECT 'FAIL: demo account exists in production' AS test_name, email
FROM auth.users
WHERE email LIKE '%@demo.com';
