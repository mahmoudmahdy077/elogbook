-- Temporary seed script for SC-012 performance validation.
-- Run with: psql <DATABASE_URL> -f scripts/seed-500-residents.sql
-- Or via Supabase SQL editor after replacing :tenant_id with a real UUID.

DO $$
DECLARE
  i INT;
  resident_id UUID;
  template_id UUID;
  tenant UUID := :tenant_id; -- replace with target tenant UUID
BEGIN
  SELECT id INTO template_id FROM case_templates WHERE tenant_id = tenant LIMIT 1;

  FOR i IN 1..500 LOOP
    resident_id := gen_random_uuid();

    INSERT INTO profiles (id, user_id, tenant_id, role, full_name, specialty, created_at, updated_at)
    VALUES (
      resident_id,
      gen_random_uuid(),
      tenant,
      'resident',
      'Perf Resident ' || i,
      'General Surgery',
      NOW() - (i || ' minutes')::INTERVAL,
      NOW() - (i || ' minutes')::INTERVAL
    );

    INSERT INTO case_entries (
      id, resident_id, tenant_id, template_id, status, is_deidentified,
      patient_age_years, field_values, case_date, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      resident_id,
      tenant,
      template_id,
      (ARRAY['draft', 'pending', 'approved', 'rejected'])[1 + (i % 4)],
      true,
      30 + (i % 50),
      '{}'::JSONB,
      NOW() - (i || ' hours')::INTERVAL,
      NOW() - (i || ' hours')::INTERVAL,
      NOW() - (i || ' hours')::INTERVAL
    FROM generate_series(1, 5);
  END LOOP;
END $$;
