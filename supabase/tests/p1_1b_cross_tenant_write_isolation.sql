BEGIN;
SELECT plan(3);
SELECT isnt(
  (SELECT result FROM public.create_test_token('tenant_a', 'resident')),
  NULL, 'token created for tenant_a resident'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"test-resident","app_metadata":{"tenant_id":"tenant_a","role":"resident"}}';
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, created_at)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099', (SELECT id FROM public.case_templates LIMIT 1), 'draft', now())$$,
  NULL, 'RLS should block cross-tenant INSERT'
);
SELECT * FROM finish();
ROLLBACK;
