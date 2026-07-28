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
-- Self-contained fixture + test in one DO block so JWT claims can
-- reference the freshly-inserted supervisor profile.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_entry_id          UUID;
  v_supervisor        UUID;
  v_tenant_a          UUID;
  v_before_count      BIGINT;
  v_after_count       BIGINT;
  v_tenant_on_row     UUID;
  v_approve_result    JSONB;
  v_supervisor_user   UUID;
  v_resident_user     UUID;
  v_resident_profile  UUID;
BEGIN
  -- Fixture: tenant
  INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
  VALUES (gen_random_uuid(), 'Tenant A', 'tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'))
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO v_tenant_a FROM tenants WHERE slug = 'tenant-a' LIMIT 1;

  -- Fixture: supervisor (auth user + profile)
  v_supervisor_user := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email) VALUES (v_supervisor_user, '00000000-0000-0000-0000-000000000000', 'supervisor@example.com')
  ON CONFLICT (id) DO NOTHING;

  -- handle_new_user trigger created a profile; delete it so we can insert our own
  DELETE FROM profiles WHERE user_id = v_supervisor_user;

  INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
  VALUES (v_supervisor_user, v_tenant_a, v_supervisor_user, 'supervisor', 'Test Supervisor');

  v_supervisor := v_supervisor_user;

  -- Fixture: resident (auth user + profile + pending case)
  v_resident_user := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email) VALUES (v_resident_user, '00000000-0000-0000-0000-000000000000', 'resident@example.com')
  ON CONFLICT (id) DO NOTHING;

  -- handle_new_user trigger created a profile; delete it so we can insert our own
  DELETE FROM profiles WHERE user_id = v_resident_user;

  v_resident_profile := gen_random_uuid();
  INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
  VALUES (v_resident_profile, v_tenant_a, v_resident_user, 'resident', 'Test Resident');

  INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, status)
  VALUES (gen_random_uuid(), v_tenant_a, v_resident_profile, (SELECT id FROM case_templates LIMIT 1), CURRENT_DATE, 'pending')
  RETURNING id INTO v_entry_id;

  -- Set JWT claims so approve_case() can resolve auth.uid() and get_tenant_id()
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',           v_supervisor_user::text,
      'app_metadata',  json_build_object(
        'tenant_id',  v_tenant_a,
        'user_role',  'supervisor'
      )
    )::text,
    true
  );

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
  INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, status)
  VALUES (gen_random_uuid(), v_tenant_a, v_resident_profile, (SELECT id FROM case_templates LIMIT 1), CURRENT_DATE, 'pending')
  RETURNING id INTO v_entry_id;

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
