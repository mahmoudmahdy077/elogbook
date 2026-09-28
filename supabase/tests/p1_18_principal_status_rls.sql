BEGIN;
SELECT plan(12);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000001801', 'Status Tenant A', 'status-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000001802', 'Status Tenant B', 'status-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000001811', '00000000-0000-0000-0000-000000000000', 'status-a@example.test'),
  ('00000000-0000-0000-0000-000000001812', '00000000-0000-0000-0000-000000000000', 'status-suspended@example.test'),
  ('00000000-0000-0000-0000-000000001813', '00000000-0000-0000-0000-000000000000', 'status-b@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000001811',
  '00000000-0000-0000-0000-000000001812',
  '00000000-0000-0000-0000-000000001813'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000001821', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001811', 'resident', 'Status Resident A', 'active'),
  ('00000000-0000-0000-0000-000000001822', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001812', 'resident', 'Status Resident Suspended', 'active'),
  ('00000000-0000-0000-0000-000000001823', '00000000-0000-0000-0000-000000001802', '00000000-0000-0000-0000-000000001813', 'resident', 'Status Resident B', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000001831', '00000000-0000-0000-0000-000000001801', 'surgery', 'Status Template A', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000001832', '00000000-0000-0000-0000-000000001802', 'surgery', 'Status Template B', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000001841', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001821', '00000000-0000-0000-0000-000000001831', 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000001842', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001822', '00000000-0000-0000-0000-000000001831', 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000001843', '00000000-0000-0000-0000-000000001802', '00000000-0000-0000-0000-000000001823', '00000000-0000-0000-0000-000000001832', 'draft', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{}';

SELECT is_empty(
  $$SELECT id FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001841'$$,
  'anonymous principals cannot read clinical rows'
);

SELECT throws_ok(
  $$INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
    VALUES ('00000000-0000-0000-0000-000000001891', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001821', '00000000-0000-0000-0000-000000001831', 'draft', true, '{}'::jsonb)$$,
  NULL,
  'anonymous principals cannot write clinical rows'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001811","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001801","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001841'),
  1::bigint,
  'an active resident can read their own case'
);

SELECT is_empty(
  $$SELECT id FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001843'$$,
  'an active resident cannot read another tenant case'
);

SELECT throws_ok(
  $$INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
    VALUES ('00000000-0000-0000-0000-000000001892', '00000000-0000-0000-0000-000000001802', '00000000-0000-0000-0000-000000001823', '00000000-0000-0000-0000-000000001832', 'draft', true, '{}'::jsonb)$$,
  NULL,
  'an active resident cannot write another tenant case'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001812","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001801","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001842'),
  1::bigint,
  'an active resident can read their own case before suspension'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000001822';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001812","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001801","user_role":"resident"}}';

SELECT is_empty(
  $$SELECT id FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001842'$$,
  'a suspended resident cannot read their own case'
);

SELECT throws_ok(
  $$INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
    VALUES ('00000000-0000-0000-0000-000000001893', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001822', '00000000-0000-0000-0000-000000001831', 'draft', true, '{}'::jsonb)$$,
  NULL,
  'a suspended resident cannot write a case'
);

SELECT ok(
  (public.submit_case_operation('p1-18-user-op', 'insert', NULL, '{"template_id":"00000000-0000-0000-0000-000000001831","is_deidentified":true}'::jsonb) ->> 'error') IN ('policy: account_suspended', 'account_suspended'),
  'the case operation RPC denies a suspended account'
);

RESET ROLE;
UPDATE public.tenants
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000001801';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001811","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001801","user_role":"resident"}}';

SELECT is_empty(
  $$SELECT id FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000001841'$$,
  'a resident cannot read while the tenant is suspended'
);

SELECT throws_ok(
  $$INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
    VALUES ('00000000-0000-0000-0000-000000001894', '00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001821', '00000000-0000-0000-0000-000000001831', 'draft', true, '{}'::jsonb)$$,
  NULL,
  'a resident cannot write while the tenant is suspended'
);

SELECT ok(
  (public.submit_case_operation('p1-18-tenant-op', 'insert', NULL, '{"template_id":"00000000-0000-0000-0000-000000001831","is_deidentified":true}'::jsonb) ->> 'error') IN ('policy: tenant_suspended', 'tenant_suspended'),
  'the case operation RPC denies a suspended tenant'
);

ROLLBACK;
