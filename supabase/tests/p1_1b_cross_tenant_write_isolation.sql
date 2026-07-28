BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000002","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000002","role":"resident"}}';
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, created_at)
    VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099', (SELECT id FROM public.case_templates LIMIT 1), 'draft', now())$$,
  NULL, 'RLS should block cross-tenant INSERT'
);
SELECT * FROM finish();
ROLLBACK;
