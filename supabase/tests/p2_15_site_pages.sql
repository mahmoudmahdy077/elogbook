-- p2_15: editorial scope boundaries (T24).
BEGIN;
SELECT plan(5);

-- 1-2. Authenticated users cannot read drafts/history or write pages.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000093","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000021","user_role":"resident"}}';
SELECT is_empty(
  $$SELECT FROM public.site_pages$$,
  'authenticated users cannot enumerate editorial pages'
);
SELECT is_empty(
  $$SELECT FROM public.site_page_revisions$$,
  'authenticated users cannot enumerate revisions'
);
RESET ROLE;

-- 3. Scope combinations enforced (platform rows carry no tenant).
SELECT throws_ok(
  $$INSERT INTO site_pages (scope, tenant_id, slug) VALUES ('platform', '00000000-0000-0000-0000-000000000021', 'bad-scope')$$,
  '23514',
  'platform scope rejects tenant linkage'
);

-- 4. Slug shape enforced.
SELECT throws_ok(
  $$INSERT INTO site_pages (scope, slug) VALUES ('platform', 'Bad Slug!')$$,
  '23514',
  'slug shape enforced'
);

-- 5. Duplicate platform slug+locale rejected (canonical addresses stay unique).
INSERT INTO site_pages (id, scope, slug, locale)
VALUES ('00000000-0000-0000-0000-000000000061', 'platform', 'about-dup', 'en')
ON CONFLICT DO NOTHING;
SELECT throws_ok(
  $$INSERT INTO site_pages (scope, slug, locale) VALUES ('platform', 'about-dup', 'en')$$,
  '23505',
  'duplicate platform slug rejected'
);

ROLLBACK;
