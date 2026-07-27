-- supabase/tests/p1_1_cross_tenant_isolation.sql
-- Cross-tenant isolation tests (P1.1) — REWRITTEN for DB-004.
-- Run with: supabase db test
-- Requires: a running local Supabase (supabase db reset).
--
-- Strategy: insert two tenants and two resident users, set the JWT
-- claim to simulate tenant A's resident, and assert that a SELECT
-- against tenant B's rows returns 0 rows. Without set_config, the
-- old test passed vacuously because get_tenant_id() returned NULL
-- and `tenant_id != NULL` is NULL → EXISTS(NULL) is false.

BEGIN;
  -- Seed two tenants
  INSERT INTO tenants (id, name, slug, tenant_type, settings)
  VALUES
    ('11111111-0000-0000-0000-000000000001', 'Tenant A', 'tenant-a', 'institution', '{}'),
    ('22222222-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b', 'institution', '{}')
  ON CONFLICT (id) DO NOTHING;

  -- Insert a case in each tenant (de-identified, no PHI)
  INSERT INTO case_entries (id, tenant_id, resident_id, template_id, patient_mrn, patient_dob, patient_age_years, patient_hash, case_date, field_values, accreditation_mappings, is_deidentified, status)
  VALUES
    ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', NULL, NULL, NULL, NULL, '2026-01-01', '{}'::JSONB, '[]'::JSONB, true, 'draft'),
    ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', NULL, NULL, NULL, NULL, '2026-01-01', '{}'::JSONB, '[]'::JSONB, true, 'draft')
  ON CONFLICT (id) DO NOTHING;

  -- Simulate tenant A's resident JWT
  SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","app_metadata":{"tenant_id":"11111111-0000-0000-0000-000000000001","user_role":"resident"}}', true);
  SET LOCAL role authenticated;

  -- Assert: tenant A resident CANNOT read tenant B's case (0 rows expected)
  SELECT 'FAIL: tenant A resident can read tenant B case_entries' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM case_entries WHERE tenant_id = '22222222-0000-0000-0000-000000000002'
  );

  -- Assert: tenant A resident CANNOT read tenant B's profiles
  SELECT 'FAIL: tenant A resident can read tenant B profiles' AS test_name
  WHERE EXISTS (
    SELECT 1 FROM profiles WHERE tenant_id = '22222222-0000-0000-0000-000000000002'
  );
ROLLBACK;
