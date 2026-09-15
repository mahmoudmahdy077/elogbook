-- p3_02: publish contract — tenant authorization, CAS, transactional audit (M8.2).
BEGIN;
SELECT plan(8);

-- Fixtures: two tenants, one tenant-scope page with two revisions, one platform page.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Tenant A', 'tenant-a-p3', 'institution', 'salt-a-p3'),
  ('00000000-0000-0000-0000-0000000000b2', 'Tenant B', 'tenant-b-p3', 'institution', 'salt-b-p3')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_pages (id, scope, tenant_id, slug, locale)
VALUES ('00000000-0000-0000-0000-0000000000c3', 'tenant', '00000000-0000-0000-0000-0000000000a1', 'events-p3', 'en')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_page_revisions (id, page_id, content, status)
VALUES
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c3', '{"blocks":[]}', 'draft'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c3', '{"blocks":[]}', 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_pages (id, scope, slug, locale)
VALUES ('00000000-0000-0000-0000-0000000000e6', 'platform', 'about-p3', 'en')
ON CONFLICT (id) DO NOTHING;

INSERT INTO site_page_revisions (id, page_id, content, status)
VALUES ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000e6', '{"blocks":[]}', 'draft')
ON CONFLICT (id) DO NOTHING;

-- 1. Cross-tenant publish is rejected inside the database.
SELECT throws_ok(
  $$SELECT public.publish_site_page('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d4', NULL, false, NULL, '00000000-0000-0000-0000-0000000000b2')$$,
  'P0005',
  'tenant_mismatch: tenant B cannot publish tenant A pages'
);

-- 2. Stale pointer is rejected (409 contract).
SELECT throws_ok(
  $$SELECT public.publish_site_page('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d5', true, NULL, '00000000-0000-0000-0000-0000000000a1')$$,
  'P0003',
  'pointer_conflict: stale editors fail closed'
);

-- 3. Happy path: publish moves the pointer transactionally.
SELECT lives_ok(
  $$SELECT public.publish_site_page('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000d4', NULL, false, NULL, '00000000-0000-0000-0000-0000000000a1')$$,
  'tenant publish succeeds with matching tenant'
);

-- 4. Pointer + revision status converge (archive old, publish new).
SELECT is(
  (SELECT published_revision_id FROM site_pages WHERE id = '00000000-0000-0000-0000-0000000000c3'),
  '00000000-0000-0000-0000-0000000000d4'::uuid,
  'published pointer moved to the new revision'
);

-- 5. Publication is audited in the same transaction.
SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs WHERE resource_id = '00000000-0000-0000-0000-0000000000c3' AND action = 'site_page_publish'),
  'publish wrote a transactional audit row'
);

-- 6. Foreign revision is rejected.
SELECT throws_ok(
  $$SELECT public.publish_site_page('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000f7', NULL, false, NULL, '00000000-0000-0000-0000-0000000000a1')$$,
  'P0004',
  'revision_mismatch: revision must belong to the page'
);

-- 7. Audit failure lands in the durable outbox instead of vanishing.
SELECT lives_ok(
  $$SELECT public.publish_site_page('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000f7', NULL, false, NULL, '00000000-0000-0000-0000-00000000ffff')$$,
  'platform publish survives audit failure via outbox'
);
SELECT ok(
  EXISTS (SELECT 1 FROM audit_outbox WHERE resource_id = '00000000-0000-0000-0000-0000000000e6'),
  'failed audit event preserved in audit_outbox'
);

ROLLBACK;
