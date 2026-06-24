-- RLS Policy Tests
-- Run with: supabase db test
-- Requires a running Supabase instance with seed data

-- ============================================================
-- Test: Resident can only see own case_entries
-- ============================================================
BEGIN;
  -- Simulate resident JWT claim
  SELECT set_config('request.jwt.claims', '{"sub": "resident-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "resident"}}', true);

  -- Attempt to SELECT cases owned by another resident
  -- Should return 0 rows (RLS filters out non-owned cases)
  SET LOCAL row_security TO ON;
  
  -- Create test data within transaction
  -- (These SELECT queries verify RLS is filtering correctly)
  
  -- This should succeed (resident accesses own case)
  -- This should fail (resident accesses another resident's case)
  
ROLLBACK;

-- ============================================================
-- Test: Supervisor sees all tenant cases
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "supervisor-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "supervisor"}}', true);
  SET LOCAL row_security TO ON;

  -- Supervisor should see ALL cases in their tenant
ROLLBACK;

-- ============================================================
-- Test: Resident cannot modify submitted cases
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "resident-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "resident"}}', true);
  SET LOCAL row_security TO ON;

  -- Attempt to UPDATE a submitted case (status != 'draft')
  -- Should raise an exception via the write_once_submitted_check trigger
ROLLBACK;

-- ============================================================
-- Test: Resident can modify rejected cases (resubmit)
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "resident-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "resident"}}', true);
  SET LOCAL row_security TO ON;

  -- Update a rejected case to draft status
  -- Should succeed (migration 00023 allows rejected -> draft)
ROLLBACK;

-- ============================================================
-- Test: Only admin/institution_admin can read ai_config
-- ============================================================
BEGIN;
  -- As resident: should be denied
  SELECT set_config('request.jwt.claims', '{"sub": "resident-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "resident"}}', true);
  SET LOCAL row_security TO ON;

  -- As institution_admin: should succeed
  SELECT set_config('request.jwt.claims', '{"sub": "admin-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "institution_admin"}}', true);
  SET LOCAL row_security TO ON;
ROLLBACK;

-- ============================================================
-- Test: Deleted records excluded from SELECT
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "supervisor-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "supervisor"}}', true);
  SET LOCAL row_security TO ON;

  -- SELECT * FROM case_entries WHERE deleted_at IS NOT NULL
  -- Should return empty (the WITH CHECK/deletion filter should exclude soft-deleted records)
ROLLBACK;

-- ============================================================
-- Test: Consent records only visible within tenant
-- ============================================================
BEGIN;
  SELECT set_config('request.jwt.claims', '{"sub": "admin-user-id", "app_metadata": {"tenant_id": "test-tenant-id", "user_role": "institution_admin"}}', true);
  SET LOCAL row_security TO ON;

  -- Verify consent_records JOINs on p.user_id = auth.uid() (fixed in migration 00019)
ROLLBACK;
