BEGIN;
SELECT plan(4);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000041', 'Audit Tenant', 'audit-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000000', 'audit-director@example.com'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000000', 'audit-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'director', 'Audit Director'),
  ('00000000-0000-0000-0000-000000000097', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', 'resident', 'Audit Resident');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000041","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"director"}}';

-- program_goals insert must succeed and produce a valid audit row whose
-- user_id maps to the director's auth user id.
SELECT lives_ok(
  $$INSERT INTO public.program_goals (tenant_id, director_id, resident_id, title, target_count, deadline)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-000000000097', 'Test Goal', 10, '2026-12-31')$$,
  'program_goals insert succeeds (audit trigger no longer FK-violates)'
);

-- notifications: resident spoofing another user fails
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000042","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000041","user_role":"resident"}}';

SELECT throws_ok(
  $$INSERT INTO public.notifications (tenant_id, user_id, type, title, body)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'approval', 'x', 'x')$$,
  NULL,
  'resident cannot insert a notification addressed to another user'
);
SELECT lives_ok(
  $$INSERT INTO public.notifications (tenant_id, user_id, type, title, body)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042', 'approval', 'x', 'x')$$,
  'user can insert a notification addressed to themselves'
);

-- institutions audit trigger dropped: inserting an institution succeeds
SET LOCAL ROLE postgres;
SELECT lives_ok(
  $$INSERT INTO public.institutions (id, name, slug, tier) VALUES (gen_random_uuid(), 'Audit Institution', 'audit-institution', 'free')$$,
  'institutions insert succeeds after dropping the broken audit trigger'
);
ROLLBACK;
