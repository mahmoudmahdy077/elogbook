BEGIN;
SELECT plan(3);
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
