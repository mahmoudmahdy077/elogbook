BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000002', 'Tenant B', 'tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'residentb@example.com')
ON CONFLICT (id) DO NOTHING;

-- Delete auto-created profile from handle_new_user trigger, then insert our own
DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000002';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'resident', 'Resident B');

GRANT SELECT ON profiles TO authenticated;
GRANT INSERT ON case_entries TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000002","tenant_id":"00000000-0000-0000-0000-000000000002","user_role":"resident"}';
SELECT lives_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, created_at)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099', (SELECT id FROM public.case_templates LIMIT 1), 'draft', now())$$,
  'same-tenant INSERT should succeed'
);
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, status, created_at)
    VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099', (SELECT id FROM public.case_templates LIMIT 1), 'draft', now())$$,
  NULL, 'RLS should block cross-tenant INSERT'
);
SELECT * FROM finish();
ROLLBACK;
