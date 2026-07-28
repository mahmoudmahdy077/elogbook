BEGIN;
SELECT plan(3);

DO $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
BEGIN
  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email) VALUES (v_user_id, '00000000-0000-0000-0000-000000000000', 'test@example.com')
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
  VALUES (gen_random_uuid(), v_tenant_id, v_user_id, 'resident', 'Test Resident')
  ON CONFLICT (id) DO NOTHING;
END $$;

SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, patient_mrn, patient_dob, is_deidentified, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', '123456', '1990-01-01', true, now())$$,
  NULL, 'CHECK should block deidentified case with PHI'
);
SELECT lives_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, patient_mrn, patient_dob, is_deidentified, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', NULL, NULL, true, now())$$,
  'deidentified case without PHI should succeed'
);
SELECT * FROM finish();
ROLLBACK;
