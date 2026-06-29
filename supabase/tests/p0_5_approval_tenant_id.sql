-- ============================================================================
-- Phase 0 P0.5 Regression Test
-- ============================================================================
-- Verifies that approve_case() and reject_case() populate tenant_id on the
-- approval_requests row they INSERT.
--
-- Before migration 00048: approval_requests.tenant_id is NOT NULL (added in
-- 00028) but the INSERT in approve_case/reject_case omits it, so PostgreSQL
-- raises a NOT NULL violation and the case status is left in 'pending'.
-- After migration 00048: the INSERT includes tenant_id sourced from the case
-- row, the function succeeds, and the approval_requests row carries the
-- correct tenant_id.
--
-- Run with:  psql -f tests/p0_5_approval_tenant_id.sql
-- Requires: a seeded local Supabase instance (supabase db reset).
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------
-- Setup: pretend we are a supervisor in tenant-A
-- --------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'supervisor-a-user-id',
    'app_metadata', json_build_object(
      'tenant_id', (SELECT id FROM tenants WHERE slug = 'tenant-a' LIMIT 1),
      'user_role', 'supervisor'
    )
  )::text,
  true
);

-- --------------------------------------------------------------------
-- Sanity: pick a pending case in tenant-A and a supervisor profile
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_entry_id   UUID;
  v_supervisor UUID;
  v_tenant_a   UUID;
  v_before_count BIGINT;
  v_after_count  BIGINT;
  v_tenant_on_row UUID;
  v_approve_result JSONB;
BEGIN
  SELECT id INTO v_tenant_a FROM tenants WHERE slug = 'tenant-a' LIMIT 1;
  IF v_tenant_a IS NULL THEN
    RAISE EXCEPTION 'tenant-a not seeded - run supabase db reset first';
  END IF;

  SELECT id INTO v_entry_id
    FROM case_entries
   WHERE tenant_id = v_tenant_a AND status = 'pending'
   ORDER BY created_at DESC
   LIMIT 1;

  SELECT id INTO v_supervisor
    FROM profiles
   WHERE tenant_id = v_tenant_a AND role = 'supervisor'
   LIMIT 1;

  IF v_entry_id IS NULL OR v_supervisor IS NULL THEN
    RAISE EXCEPTION 'missing fixture: need a pending case and a supervisor in tenant-a';
  END IF;

  -- Baseline: count approval_requests for this case before call
  SELECT COUNT(*) INTO v_before_count
    FROM approval_requests WHERE entry_id = v_entry_id;

  -- ------------------------------------------------------------------
  -- Act: call approve_case — must succeed and must persist tenant_id
  -- ------------------------------------------------------------------
  v_approve_result := approve_case(v_entry_id, v_supervisor, 'p0.5 test');

  IF v_approve_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'approve_case did not return success: %', v_approve_result;
  END IF;

  -- The newly-written (or upserted) approval_requests row MUST carry
  -- the correct tenant_id. If 00048 is missing, this column is NULL
  -- and the NOT NULL constraint from 00028 blows up earlier; the
  -- function never returns success, so we get here only post-fix.
  SELECT tenant_id INTO v_tenant_on_row
    FROM approval_requests
   WHERE entry_id = v_entry_id AND supervisor_id = v_supervisor;

  IF v_tenant_on_row IS NULL THEN
    RAISE EXCEPTION 'FAIL: approval_requests.tenant_id is NULL after approve_case';
  END IF;

  IF v_tenant_on_row <> v_tenant_a THEN
    RAISE EXCEPTION 'FAIL: tenant_id mismatch (expected %, got %)', v_tenant_a, v_tenant_on_row;
  END IF;

  -- Mirror the same checks for reject_case on a fresh pending case
  SELECT id INTO v_entry_id
    FROM case_entries
   WHERE tenant_id = v_tenant_a AND status = 'pending'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_entry_id IS NULL THEN
    RAISE EXCEPTION 'no second pending case to exercise reject_case';
  END IF;

  PERFORM reject_case(v_entry_id, v_supervisor, 'p0.5 test reject');

  SELECT tenant_id INTO v_tenant_on_row
    FROM approval_requests
   WHERE entry_id = v_entry_id AND supervisor_id = v_supervisor;

  IF v_tenant_on_row IS NULL OR v_tenant_on_row <> v_tenant_a THEN
    RAISE EXCEPTION 'FAIL: reject_case did not persist correct tenant_id';
  END IF;

  RAISE NOTICE 'PASS: approve_case and reject_case populate approval_requests.tenant_id';
END $$;

ROLLBACK;
