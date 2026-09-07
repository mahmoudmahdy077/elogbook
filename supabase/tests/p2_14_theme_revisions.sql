-- p2_14: theme revision history boundaries (T22).
BEGIN;
SELECT plan(4);

-- 1-2. Authenticated users cannot read or write revision history directly.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000093","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';
SELECT is_empty(
  $$SELECT FROM public.tenant_theme_revisions$$,
  'authenticated users cannot enumerate theme revisions'
);
SELECT throws_ok(
  $$INSERT INTO tenant_theme_revisions (tenant_id, version, config) VALUES ('00000000-0000-0000-0000-000000000037', 1, '{}')$$,
  '42501',
  'authenticated users cannot write theme revisions'
);
RESET ROLE;

-- Fixture tenant (each file owns its fixtures; nothing persists past ROLLBACK).
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000037', 'Theme Tenant', 'theme-tenant-14', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- 3. Unknown revision status rejected.
SELECT throws_ok(
  $$INSERT INTO tenant_theme_revisions (tenant_id, version, config, status) VALUES ('00000000-0000-0000-0000-000000000037', 1, '{}', 'live')$$,
  '23514',
  'revision status is allowlisted'
);

-- 4. Version uniqueness per tenant (revert targets are unambiguous).
INSERT INTO tenant_theme_revisions (id, tenant_id, version, config, status)
VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000037', 1, '{}', 'published');
SELECT throws_ok(
  $$INSERT INTO tenant_theme_revisions (tenant_id, version, config) VALUES ('00000000-0000-0000-0000-000000000037', 1, '{}')$$,
  '23505',
  'duplicate revision version rejected'
);

ROLLBACK;
