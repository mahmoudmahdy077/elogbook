BEGIN;
SELECT plan(19);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-000000002001', 'Attachment Tenant A', 'attachment-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex')),
  ('00000000-0000-0000-0000-000000002002', 'Attachment Tenant B', 'attachment-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000002011', '00000000-0000-0000-0000-000000000000', 'attachment-a@example.test'),
  ('00000000-0000-0000-0000-000000002012', '00000000-0000-0000-0000-000000000000', 'attachment-a2@example.test'),
  ('00000000-0000-0000-0000-000000002013', '00000000-0000-0000-0000-000000000000', 'attachment-supervisor@example.test'),
  ('00000000-0000-0000-0000-000000002014', '00000000-0000-0000-0000-000000000000', 'attachment-b@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000002011',
  '00000000-0000-0000-0000-000000002012',
  '00000000-0000-0000-0000-000000002013',
  '00000000-0000-0000-0000-000000002014'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000002021', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002011', 'resident', 'Attachment Owner', 'active'),
  ('00000000-0000-0000-0000-000000002022', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002012', 'resident', 'Attachment Peer', 'active'),
  ('00000000-0000-0000-0000-000000002023', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002013', 'supervisor', 'Attachment Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000002024', '00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000002014', 'resident', 'Attachment Other Tenant', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000002031', '00000000-0000-0000-0000-000000002001', 'surgery', 'Attachment Template A', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000002032', '00000000-0000-0000-0000-000000002002', 'surgery', 'Attachment Template B', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000002041', '00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000002021', '00000000-0000-0000-0000-000000002031', 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002042', '00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000002024', '00000000-0000-0000-0000-000000002032', 'draft', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_attachments (
  id, entry_id, tenant_id, file_path, file_name, file_type, file_size,
  uploaded_by, mime_signature, malware_scan_status
)
VALUES
  ('00000000-0000-0000-0000-000000002051', '00000000-0000-0000-0000-000000002041', '00000000-0000-0000-0000-000000002001', 'attachment-tenant-a/case-a/clean.pdf', 'clean.pdf', 'application/pdf', 12, '00000000-0000-0000-0000-000000002021', 'application/pdf', 'clean'),
  ('00000000-0000-0000-0000-000000002052', '00000000-0000-0000-0000-000000002041', '00000000-0000-0000-0000-000000002001', 'attachment-tenant-a/case-a/pending.pdf', 'pending.pdf', 'application/pdf', 12, '00000000-0000-0000-0000-000000002021', 'application/pdf', 'pending'),
  ('00000000-0000-0000-0000-000000002053', '00000000-0000-0000-0000-000000002041', '00000000-0000-0000-0000-000000002001', 'attachment-tenant-a/case-a/clean-privileged.pdf', 'clean-privileged.pdf', 'application/pdf', 12, '00000000-0000-0000-0000-000000002021', 'application/pdf', 'clean')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_attachments (
  entry_id, tenant_id, file_path, file_name, file_type, file_size,
  uploaded_by, mime_signature, malware_scan_status
)
SELECT
  '00000000-0000-0000-0000-000000002041',
  '00000000-0000-0000-0000-000000002001',
  'attachment-tenant-a/case-a/limit-' || series_value || '.pdf',
  'limit-' || series_value || '.pdf',
  'application/pdf',
  12,
  '00000000-0000-0000-0000-000000002021',
  'application/pdf',
  'quarantined'
FROM generate_series(1, 17) AS series_value;

SELECT throws_ok(
  $$INSERT INTO public.case_attachments (
    id, entry_id, tenant_id, file_path, file_name, file_type, file_size,
    uploaded_by, mime_signature, malware_scan_status
  ) VALUES (
    '00000000-0000-0000-0000-000000002060',
    '00000000-0000-0000-0000-000000002041',
    '00000000-0000-0000-0000-000000002001',
    'attachment-tenant-a/case-a/limit-21.pdf',
    'limit-21.pdf',
    'application/pdf',
    12,
    '00000000-0000-0000-0000-000000002021',
    'application/pdf',
    'quarantined'
  )$$,
  '23514',
  'case attachment count limit exceeded',
  'a case cannot exceed the attachment count limit'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002001","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000002051' AND malware_scan_status = 'clean'),
  1::bigint,
  'the owner can read a clean attachment'
);

SELECT is_empty(
  $$SELECT id FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000002052'$$,
  'the owner cannot read a pending attachment'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002012","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002001","user_role":"resident"}}';

SELECT is(
  (
    WITH changed AS (
      UPDATE public.case_attachments
      SET file_name = 'forged.pdf'
      WHERE id = '00000000-0000-0000-0000-000000002051'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a same-tenant non-owner cannot mutate an attachment'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002001","user_role":"resident"}}';

SELECT is(
  (
    WITH deleted AS (
      DELETE FROM public.case_attachments
      WHERE id = '00000000-0000-0000-0000-000000002052'
      RETURNING id
    )
    SELECT count(*) FROM deleted
  ),
  0::bigint,
  'the owner cannot delete a non-clean attachment'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002014","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002002","user_role":"resident"}}';

SELECT is_empty(
  $$SELECT id FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000002051'$$,
  'another tenant cannot read an attachment'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.case_attachments
      SET file_name = 'cross-tenant.pdf'
      WHERE id = '00000000-0000-0000-0000-000000002051'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'another tenant cannot update an attachment'
);

SELECT is(
  (
    WITH deleted AS (
      DELETE FROM public.case_attachments
      WHERE id = '00000000-0000-0000-0000-000000002051'
      RETURNING id
    )
    SELECT count(*) FROM deleted
  ),
  0::bigint,
  'another tenant cannot delete an attachment'
);

SELECT throws_ok(
  $$INSERT INTO public.case_attachments (id, entry_id, tenant_id, file_path, file_name, file_type, file_size, uploaded_by, mime_signature, malware_scan_status)
    VALUES ('00000000-0000-0000-0000-000000002054', '00000000-0000-0000-0000-000000002042', '00000000-0000-0000-0000-000000002001', 'attachment-tenant-a/case-b/forged.pdf', 'forged.pdf', 'application/pdf', 12, '00000000-0000-0000-0000-000000002021', 'application/pdf', 'clean')$$,
  '42501',
  NULL,
  'a tenant member cannot attach to another tenant case'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002011","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002001","user_role":"resident"}}';

SELECT is(
  (
    WITH deleted AS (
      DELETE FROM public.case_attachments
      WHERE id = '00000000-0000-0000-0000-000000002051'
      RETURNING id
    )
    SELECT count(*) FROM deleted
  ),
  0::bigint,
  'the owner cannot bypass the broker with a direct metadata delete'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002013","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002001","user_role":"supervisor"}}';

SELECT is(
  (
    WITH deleted AS (
      DELETE FROM public.case_attachments
      WHERE id = '00000000-0000-0000-0000-000000002053'
      RETURNING id
    )
    SELECT count(*) FROM deleted
  ),
  0::bigint,
  'an authorized tenant role cannot bypass the broker with a direct metadata delete'
);

RESET ROLE;

SELECT is(
  (
    has_table_privilege('anon', 'storage.objects', 'select')
    OR has_table_privilege('anon', 'storage.objects', 'insert')
    OR has_table_privilege('anon', 'storage.objects', 'update')
    OR has_table_privilege('anon', 'storage.objects', 'delete')
  ),
  false,
  'anon has no direct Storage object mutation or read privilege'
);

SELECT is_empty(
  $$
  SELECT policyname
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND cmd IN ('ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE')
    AND (
      COALESCE(qual, '') ILIKE '%case-attachments%'
      OR COALESCE(with_check, '') ILIKE '%case-attachments%'
    )
  $$,
  'ordinary clients have no direct case-attachment Storage policies'
);

SELECT is(
  COALESCE((SELECT public FROM storage.buckets WHERE id = 'case-attachments' LIMIT 1), true),
  false,
  'the case-attachment Storage bucket remains private'
);

SELECT is_empty(
  $$
  SELECT policyname
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'case_attachments'
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  $$,
  'ordinary clients have no case-attachment mutation policies'
);

SELECT is(
  (
    has_table_privilege('authenticated', 'public.case_attachments', 'insert')
    OR has_table_privilege('authenticated', 'public.case_attachments', 'update')
    OR has_table_privilege('authenticated', 'public.case_attachments', 'delete')
  ),
  false,
  'authenticated has no direct case-attachment mutation privilege'
);

SELECT is(
  (
    has_table_privilege('authenticated', 'storage.objects', 'insert')
    OR has_table_privilege('authenticated', 'storage.objects', 'update')
    OR has_table_privilege('authenticated', 'storage.objects', 'delete')
  ),
  false,
  'authenticated has no direct Storage mutation privilege'
);

SELECT is(
  (SELECT scanner_enabled FROM public.attachment_security_config WHERE id = 1),
  false,
  'external attachment scanning is disabled by default'
);

SELECT throws_ok(
  $$UPDATE public.case_attachments
    SET malware_scan_status = 'trusted'
    WHERE id = '00000000-0000-0000-0000-000000002051'$$,
  '23514',
  NULL,
  'unknown attachment scan states are rejected'
);

ROLLBACK;
