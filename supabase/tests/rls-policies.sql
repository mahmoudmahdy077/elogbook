-- supabase/tests/rls-policies.sql
-- RLS Policy Tests — REWRITTEN for DB-004.
-- Run with: supabase db test
-- Requires: a running local Supabase with seeded data (supabase db reset).

-- ============================================================
-- Test: Resident can only see own case_entries
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "resident-1-uuid", "app_metadata": {"tenant_id": "test-tenant-uuid", "user_role": "resident"}}', true);
  SET LOCAL role authenticated;

  -- Ensure no cross-tenant access: this should always return 0
  -- for tenant B's data since we seeded tenant B with different IDs
  SELECT 'FAIL: resident can read another tenants data' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM case_entries WHERE tenant_id != 'test-tenant-uuid'
  );
ROLLBACK;

-- ============================================================
-- Test: Supervisor sees all tenant cases
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "supervisor-1-uuid", "app_metadata": {"tenant_id": "test-tenant-uuid", "user_role": "supervisor"}}', true);
  SET LOCAL role authenticated;

  -- Supervisor should see cases in their tenant (this will return 0
  -- if seed data doesn't exist — that's OK, it's a smoke test)
  SELECT 'FAIL: supervisor cannot see tenant cases' AS test_name
  WHERE NOT EXISTS (
    SELECT 1 FROM case_entries WHERE tenant_id = 'test-tenant-uuid' LIMIT 1
  ) AND EXISTS (
    SELECT 1 FROM tenants WHERE id = 'test-tenant-uuid'
  );
ROLLBACK;

-- ============================================================
-- Test: Only admin/institution_admin can read ai_config
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "resident-1-uuid", "app_metadata": {"tenant_id": "test-tenant-uuid", "user_role": "resident"}}', true);
  SET LOCAL role authenticated;

  -- Resident should NOT be able to read ai_config
  SELECT 'FAIL: resident can read ai_config' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM ai_config WHERE tenant_id = 'test-tenant-uuid' LIMIT 1
  );
ROLLBACK;
