-- p2_09: destination-role authorization for profile role writes (T04/F15).
-- An MFA-enrolled institution_admin must NOT be able to mint `admin`
-- authority via direct SQL/REST; only `admin` actors may assign it.
-- The MFA trigger is disabled in-transaction to isolate THIS guard
-- (enrollment proves nothing about destination authorization).
BEGIN;
SELECT plan(6);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000029', 'Role Tenant', 'role-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email) VALUES
  ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000000', 'role-ia@example.com'),
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000000', 'role-admin@example.com'),
  ('00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-000000000000', 'role-resident@example.com'),
  ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000000', 'role-target1@example.com'),
  ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-000000000000', 'role-target2@example.com')
ON CONFLICT (id) DO NOTHING;

-- Isolate the destination guard: enrollment is a separate control.
ALTER TABLE public.profiles DISABLE TRIGGER trg_enforce_mfa;

DELETE FROM profiles WHERE user_id IN (
  '00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000092',
  '00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000094',
  '00000000-0000-0000-0000-000000000095');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name) VALUES
  ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000091', 'institution_admin', 'Role IA'),
  ('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000092', 'admin', 'Role Admin'),
  ('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000093', 'resident', 'Role Resident'),
  ('00000000-0000-0000-0000-000000000194', '00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000094', 'resident', 'Role Target 1'),
  ('00000000-0000-0000-0000-000000000195', '00000000-0000-0000-0000-000000000029', '00000000-0000-0000-0000-000000000095', 'resident', 'Role Target 2');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000091","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000029","user_role":"institution_admin"}}';

-- 1. NEW: institution_admin cannot mint admin, even same-tenant.
SELECT throws_ok(
  $$UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000194'$$,
  'insufficient_privilege', 'Only admin may assign the admin role',
  'institution_admin direct write to admin is rejected'
);

-- 2. Existing: institution_admin can still assign non-admin roles.
SELECT lives_ok(
  $$UPDATE profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000000194'$$,
  'institution_admin can assign supervisor'
);

-- 3. Existing: admin can assign admin.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000092","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000029","user_role":"admin"}}';
SELECT lives_ok(
  $$UPDATE profiles SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000195'$$,
  'admin can assign admin'
);

-- 4. Existing: resident cannot change roles at all.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000093","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000029","user_role":"resident"}}';
SELECT throws_ok(
  $$UPDATE profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000000195'$$,
  'insufficient_privilege', 'Role changes require institution_admin or admin authorization',
  'resident direct role write is rejected'
);

-- 5. Existing: cross-tenant role write blocked (RLS denies before trigger).
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000091","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000022","user_role":"institution_admin"}}';
SELECT throws_ok(
  $$UPDATE profiles SET role = 'supervisor' WHERE id = '00000000-0000-0000-0000-000000000194'$$,
  '42501',
  'cross-tenant role write is rejected'
);

-- 6. Existing: system/definer path (no JWT) still permitted.
RESET ROLE;
SELECT lives_ok(
  $$UPDATE profiles SET role = 'resident' WHERE id = '00000000-0000-0000-0000-000000000195'$$,
  'service_role system path can set roles'
);

ROLLBACK;
