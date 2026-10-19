-- p1_3: the de-identified data boundary.
--
-- Two separate things are asserted here, and the difference matters:
--
--   * the column-level CHECK, which refuses a de-identified row that still
--     carries MRN or DOB in its own columns;
--   * the field_values scan, which is the boundary that matters for free-text
--     clinical content. 20260927000003 had replaced that scan with an inline
--     three-regex check (`\m\d{6,}\m` plus two date shapes), which detects a
--     bare digit run and nothing else: an email address, a telephone number, a
--     labelled `MRN 123456` and an unknown key all passed it. The recursive
--     field_values_contain_phi() walk with its unknown-key allowlist is the
--     control, so each of those shapes is asserted individually below.
--
-- `bodypart` is used as the carrier because it is an allow-listed key that
-- accepts a short string, so a value that trips the PHI detectors is rejected
-- for being PHI rather than for being the wrong type. An unknown key is
-- rejected on its own: field_values_contain_phi returns TRUE for a key outside
-- the allowlist even when its value is harmless, because an unreviewed key is
-- an unreviewed place to put a patient identifier.
BEGIN;
SELECT plan(7);

DO $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
BEGIN
  v_user_id := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email) VALUES (v_user_id, '00000000-0000-0000-0000-000000000000', 'test@example.com')
  ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  DELETE FROM profiles WHERE user_id = v_user_id;
  INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
  VALUES (gen_random_uuid(), v_tenant_id, v_user_id, 'resident', 'Test Resident');
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

-- field_values carrying an email address. The inline regex this replaces
-- matched a digit run and two date shapes, so an address passed it.
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, is_deidentified, field_values, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', true, '{"bodypart":"jane.doe@example.com"}'::jsonb, now())$$,
  NULL, 'an email address in a de-identified field value is rejected'
);

-- A telephone number, which is not a date and not a bare identifier either.
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, is_deidentified, field_values, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', true, '{"bodypart":"02079460958"}'::jsonb, now())$$,
  NULL, 'a telephone number in a de-identified field value is rejected'
);

-- A labelled medical record number: the digit run is short, so only the label
-- rule can catch it.
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, is_deidentified, field_values, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', true, '{"bodypart":"MRN 123456"}'::jsonb, now())$$,
  NULL, 'a labelled medical record number in a de-identified field value is rejected'
);

-- An unknown key with a harmless value. The allowlist is the control here: an
-- unreviewed key is an unreviewed place to put a patient identifier, whatever
-- it currently holds.
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, is_deidentified, field_values, created_at)
    VALUES ((SELECT id FROM public.tenants LIMIT 1), (SELECT id FROM public.profiles WHERE role='resident' LIMIT 1), (SELECT id FROM public.case_templates LIMIT 1), 'draft', true, '{"surgeon_notes":"n/a"}'::jsonb, now())$$,
  NULL, 'an unknown field key is rejected even when its value is harmless'
);

-- The live body, not a lookalike: only the recursive walk reaches the detectors
-- above, so this fails for a downgraded scan whatever the fixtures do.
SELECT ok(
  position('field_values_contain_phi' IN pg_get_functiondef('public.scan_field_values_for_phi()'::regprocedure)) > 0,
  'the installed PHI scan walks field_values_contain_phi, not an inline regex'
);
ROLLBACK;
