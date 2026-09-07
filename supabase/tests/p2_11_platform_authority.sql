-- p2_11: platform authority boundaries (T17).
-- Registry/grants deny direct access; reserved slugs rejected; grants expire.
BEGIN;
SELECT plan(6);

-- 1-2. Authenticated users cannot read the registry or grants (deny by default).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000093","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';
SELECT is_empty(
  $$SELECT FROM public.platform_admins$$,
  'authenticated users cannot enumerate platform operators'
);
SELECT is_empty(
  $$SELECT FROM public.platform_tenant_access$$,
  'authenticated users cannot enumerate support grants'
);
RESET ROLE;

-- Fixtures for constraint tests (superuser; ROLLBACK undoes all).
-- NOTE: every file runs in its own rolled-back transaction, so fixtures
-- from other suites (e.g. p2_02's tenants) do NOT exist here.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000036', 'Grant Tenant', 'grant-tenant-11', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email) VALUES
  ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000000', 'role-admin@example.com'),
  ('00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-000000000000', 'role-pending@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO platform_admins (user_id, status) VALUES
  ('00000000-0000-0000-0000-000000000092', 'active')
ON CONFLICT (user_id) DO NOTHING;

-- 3. Reserved slugs rejected.
SELECT throws_ok(
  $$INSERT INTO tenants (id, name, slug, tenant_type) VALUES ('00000000-0000-0000-0000-000000000031', 'Fake Platform', 'platform', 'institution')$$,
  '23514',
  'tenant slug "platform" is reserved'
);

-- 4. Expired-at-birth grants rejected.
SELECT throws_ok(
  $$INSERT INTO platform_tenant_access (platform_user_id, tenant_id, purpose, expires_at) VALUES ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000036', 'test', NOW() - INTERVAL '1 hour')$$,
  '23514',
  'grant expiry must be in the future'
);

-- 5. Unknown grant scope rejected.
SELECT throws_ok(
  $$INSERT INTO platform_tenant_access (platform_user_id, tenant_id, purpose, scope, expires_at) VALUES ('00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-000000000036', 'test', 'clinical:write', NOW() + INTERVAL '1 hour')$$,
  '23514',
  'grant scope is allowlisted (no clinical access grant exists)'
);

-- 6. Unknown operator status rejected.
SELECT throws_ok(
  $$INSERT INTO platform_admins (user_id, status) VALUES ('00000000-0000-0000-0000-000000000096', 'super')$$,
  '23514',
  'operator status is allowlisted'
);

ROLLBACK;
