BEGIN;
SELECT plan(17);

SELECT has_column('public', 'attachment_security_config', 'connector_approved', 'connector approval flag exists');
SELECT has_column('public', 'attachment_security_config', 'scanner_connector_id', 'connector id exists');
SELECT has_column('public', 'attachment_security_config', 'scanner_connector_revision', 'connector revision exists');
SELECT has_column('public', 'attachment_security_config', 'scanner_approval_reference', 'approval reference exists');
SELECT has_column('public', 'attachment_security_config', 'scanner_timeout_ms', 'scanner timeout exists');
SELECT has_column('public', 'attachment_security_config', 'max_scan_bytes', 'scanner byte limit exists');
SELECT has_column('public', 'case_attachments', 'scan_attempts', 'durable scan attempt counter exists');
SELECT has_function('public', 'request_attachment_scan', ARRAY['uuid'], 'durable scan request RPC exists');

SELECT is(
  (SELECT scanner_enabled FROM public.attachment_security_config WHERE id = 1),
  false,
  'scanner remains disabled by default'
);
SELECT is(
  (SELECT connector_approved FROM public.attachment_security_config WHERE id = 1),
  false,
  'connector approval remains false by default'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.attachment_security_config', 'update'),
  'service role cannot activate scanner configuration directly'
);
SELECT ok(
  NOT has_table_privilege('service_role', 'public.case_attachments', 'update'),
  'service role cannot update attachment scan state directly'
);
SELECT throws_ok(
  $$UPDATE public.attachment_security_config
    SET scanner_enabled = TRUE,
        connector_approved = TRUE,
        scanner_vendor = 'pending-vendor',
        scanner_connector_id = 'pending-connector',
        scanner_connector_revision = 'pending',
        scanner_approval_reference = 'pending'
    WHERE id = 1$$,
  '23514',
  NULL,
  'placeholder connector activation is rejected'
);
SELECT throws_ok(
  $$UPDATE public.attachment_security_config
    SET scanner_enabled = TRUE,
        connector_approved = TRUE,
        scanner_vendor = 'reviewed-vendor',
        scanner_connector_id = '',
        scanner_connector_revision = 'reviewed-revision',
        scanner_approval_reference = 'SEC-2026-001'
    WHERE id = 1$$,
  '23514',
  NULL,
  'empty connector activation is rejected'
);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000003001', 'Scanner Tenant', 'scanner-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000000000', 'scanner@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES ('00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000003002', 'resident', 'Scanner Resident', 'active');
INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES ('00000000-0000-0000-0000-000000003004', '00000000-0000-0000-0000-000000003001', 'surgery', 'Scanner Template', '[]', '[]');
INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, is_deidentified, field_values)
VALUES ('00000000-0000-0000-0000-000000003005', '00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000003003', '00000000-0000-0000-0000-000000003004', 'draft', true, '{}');
INSERT INTO public.case_attachments (
  id, entry_id, tenant_id, file_path, file_name, file_type, file_size,
  uploaded_by, mime_signature, malware_scan_status
)
VALUES (
  '00000000-0000-0000-0000-000000003006',
  '00000000-0000-0000-0000-000000003005',
  '00000000-0000-0000-0000-000000003001',
  'scanner-tenant/quarantine/case/file.pdf',
  'file.pdf',
  'application/pdf',
  12,
  '00000000-0000-0000-0000-000000003003',
  'application/pdf',
  'quarantined'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  (SELECT count(*) FROM public.request_attachment_scan('00000000-0000-0000-0000-000000003006')),
  1::bigint,
  'scanner RPC durably claims the attachment'
);
SELECT is(
  (SELECT malware_scan_status FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000003006'),
  'pending',
  'claimed attachment remains durably pending'
);
SELECT throws_ok(
  $$UPDATE public.case_attachments
    SET malware_scan_status = 'clean'
    WHERE id = '00000000-0000-0000-0000-000000003006'$$,
  '42501',
  NULL,
  'service role cannot mark an attachment clean'
);

RESET ROLE;
ROLLBACK;
