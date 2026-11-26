-- p2_17: submit_case RPC — residents cannot self-approve, RPC owns the checks.
BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000000', 'p217-resident@example.com'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000000', 'p217-other@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-0000000001c1', 'P217 Solo', 'p217-solo', 'individual', 'salt-p217-a'),
  ('00000000-0000-0000-0000-0000000001c2', 'P217 Other', 'p217-other', 'institution', 'salt-p217-b')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN
  ('00000000-0000-0000-0000-0000000001a1','00000000-0000-0000-0000-0000000001a2');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000001a1', 'resident', 'P217 R', 'active'),
  ('00000000-0000-0000-0000-0000000001d2', '00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-0000000001a2', 'resident', 'P217 O', 'active');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields)
VALUES ('00000000-0000-0000-0000-0000000001e1', '00000000-0000-0000-0000-0000000001c1', 'surgery', 'P217 T', '[]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified)
VALUES
  ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-0000000001c1',
   '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001e1',
   '2026-11-01', '{}'::jsonb, 'draft', true),
  ('00000000-0000-0000-0000-0000000001f2', '00000000-0000-0000-0000-0000000001c1',
   '00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000001e1',
   '2026-11-02', '{}'::jsonb, 'draft', true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000001a1","role":"authenticated","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000001c1","user_role":"resident"}}';

-- 1. A resident cannot set approved directly through PostgREST.
SELECT throws_ok(
  $$UPDATE public.case_entries SET status = 'approved' WHERE id = '00000000-0000-0000-0000-0000000001f1'$$,
  '42501',
  NULL,
  'resident cannot self-approve a case with a direct update'
);

-- 2. The RPC moves draft -> pending, and the individual-tenant trigger approves it.
SELECT is(
  (public.submit_case('00000000-0000-0000-0000-0000000001f1') ->> 'status'),
  'approved',
  'submit_case auto-approves a draft in an individual tenant'
);

-- 3. The row is no longer a draft.
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-0000000001f1'),
  'approved',
  'submitted row is approved'
);

-- 4. Submitting the same case again is refused.
SELECT throws_ok(
  $$SELECT public.submit_case('00000000-0000-0000-0000-0000000001f1')$$,
  '22000',
  NULL,
  'submit_case only accepts drafts'
);

-- 5. A resident of another tenant cannot submit this tenant's case.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000001a2","role":"authenticated","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000001c2","user_role":"resident"}}';
SELECT throws_ok(
  $$SELECT public.submit_case('00000000-0000-0000-0000-0000000001f1')$$,
  '42501',
  NULL,
  'cross-tenant submit is refused'
);

ROLLBACK;
