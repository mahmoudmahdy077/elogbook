BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000031', 'Duty Tenant', 'duty-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000000', 'duty-resident@example.com'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000000', 'duty-other@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000031', 'resident', 'Duty Resident'),
  ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032', 'resident', 'Other Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000031","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000031","user_role":"resident"}}';

SELECT throws_ok(
  $$INSERT INTO public.duty_periods (tenant_id, resident_id, shift_date, hours_worked, shift_type)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000095', '2026-08-12', 8, 'regular')$$,
  NULL,
  'resident cannot log duty hours for another resident'
);
SELECT lives_ok(
  $$INSERT INTO public.duty_periods (tenant_id, resident_id, shift_date, hours_worked, shift_type)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000094', '2026-08-12', 8, 'regular')$$,
  'resident can log their own duty hours'
);
SELECT throws_ok(
  $$INSERT INTO public.faculty_evaluations (tenant_id, resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures)
    VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000094', '2026-08-12', 4, 4, 4)$$,
  NULL,
  'resident cannot insert faculty evaluations'
);
SELECT is(
  (SELECT count(*) FROM public.duty_periods WHERE tenant_id = '00000000-0000-0000-0000-000000000031'),
  1::bigint,
  'caller sees only their own tenant rows (1 row inserted above)'
);
ROLLBACK;
