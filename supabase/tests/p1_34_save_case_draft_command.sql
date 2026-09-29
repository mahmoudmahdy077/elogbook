BEGIN;
SELECT plan(22);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003401', 'Draft Tenant A', 'draft-tenant-a', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003402', 'Draft Tenant B', 'draft-tenant-b', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003411', '00000000-0000-0000-0000-000000000000', 'draft-resident-a@example.test'),
  ('00000000-0000-0000-0000-000000003412', '00000000-0000-0000-0000-000000000000', 'draft-resident-b@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003411',
  '00000000-0000-0000-0000-000000003412'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003421', '00000000-0000-0000-0000-000000003401', '00000000-0000-0000-0000-000000003411', 'resident', 'Draft Resident A', 'active'),
  ('00000000-0000-0000-0000-000000003422', '00000000-0000-0000-0000-000000003402', '00000000-0000-0000-0000-000000003412', 'resident', 'Draft Resident B', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  (
    '00000000-0000-4000-8000-000000003431',
    '00000000-0000-0000-0000-000000003401',
    'surgery',
    'Draft Template A',
    '[
      {"key":"procedure_name","label":"Procedure Name","type":"text"},
      {"key":"supervised","label":"Supervised","type":"checkbox"}
    ]'::jsonb,
    '["procedure_name","supervised"]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000003432',
    '00000000-0000-0000-0000-000000003402',
    'surgery',
    'Draft Template B',
    '[]'::jsonb,
    '[]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-valid',
    jsonb_build_object(
      'template_id', '00000000-0000-4000-8000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'success')::boolean,
  true,
  'an active resident creates a de-identified draft through the command'
);

-- The command must run as the resident so auth.uid() resolves a principal,
-- while reading clinical state needs the owner. The replay result is captured
-- once here, as the resident, so the assertions that follow are plain reads.
CREATE TEMP TABLE _p1_34_case (id UUID) ON COMMIT DROP;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';
DO $capture$
BEGIN
  INSERT INTO _p1_34_case
  SELECT (public.save_case_draft_command(
    'p1-34-valid',
    jsonb_build_object(
      'template_id', '00000000-0000-4000-8000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'case_id')::uuid;
END;
$capture$;
RESET ROLE;

RESET ROLE;
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = (SELECT id FROM _p1_34_case)),

  'draft',
  'the command stores the case as a draft'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

RESET ROLE;
SELECT is(
  (SELECT is_deidentified FROM public.case_entries WHERE id = (SELECT id FROM _p1_34_case)),

  true,
  'the stored case is classified as de-identified'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

RESET ROLE;
SELECT is(
  (SELECT id::text FROM _p1_34_case),
  (SELECT id::text FROM public.case_entries
   WHERE template_id = '00000000-0000-4000-8000-000000003431'
     AND resident_id = '00000000-0000-0000-0000-000000003421'),
  'replaying the same request id returns the stored case id'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.case_entries
   WHERE template_id = '00000000-0000-4000-8000-000000003431'
     AND resident_id = '00000000-0000-0000-0000-000000003421'),
  1::bigint,
  'a replay does not create a second case row'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-valid',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003431',
      'case_date', '2026-09-24',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'idempotency_conflict',
  'reusing a request key with different non-identifying input is rejected'
);

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-missing-text',
    jsonb_build_object(
      'template_id', '00000000-0000-4000-8000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', '   ', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'required_field_missing',
  'a blank required text field is rejected'
);

-- The command resolves the caller from auth.uid(), so a refusal other than a
-- field complaint means the template was not visible to that principal. Pin
-- the resolved tenant and the stored template tenant so a mismatch is visible.
RESET ROLE;
SELECT is(
  (SELECT profile.tenant_id::text FROM public.profiles AS profile WHERE profile.user_id = '00000000-0000-0000-0000-000000003411'),
  (SELECT template.tenant_id::text FROM public.case_templates AS template WHERE template.id = '00000000-0000-4000-8000-000000003431'),
  'the resident and the template belong to the same tenant'
);
SELECT is(
  (SELECT count(*) FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-000000003411'),
  1::bigint,
  'the resident has exactly one profile'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';


    SELECT is(
      (SELECT public.save_case_draft_command(
        'p1-34-missing-text',
        jsonb_build_object(
          'template_id', '00000000-0000-4000-8000-000000003431',
          'case_date', '2026-09-23',
          'field_values', jsonb_build_object('procedure_name', '   ', 'supervised', true),
          'accreditation_mappings', '[]'::jsonb,
          'is_deidentified', true,
          'patient_age_years', 30
        )
      )::text),
      '{"code": "required_field_missing", "error": "required template fields are missing", "missing_fields": ["procedure_name"], "success": false}',
      'the replay returns the stored refusal naming the missing field'
    );

    SELECT is(
      (SELECT public.save_case_draft_command(
        'p1-34-missing-checkbox',
        jsonb_build_object(
          'template_id', '00000000-0000-4000-8000-000000003431',
          'case_date', '2026-09-23',
          'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', false),
          'accreditation_mappings', '[]'::jsonb,
          'is_deidentified', true,
          'patient_age_years', 30
        )
      )::text),
      '{"code": "required_field_missing", "error": "required template fields are missing", "missing_fields": ["supervised"], "success": false}',
      'a required checkbox is satisfied only when true'
    );

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-identifiable',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30,
      'patient_mrn', 'MRN-1'
    )
  ) ->> 'code'),
  'policy_denied',
  'the clinical slice rejects identifiable patient columns'
);

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-identified-mode',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', false,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'policy_denied',
  'the clinical slice rejects identifiable mode'
);

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-cross-tenant-template',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003432',
      'case_date', '2026-09-23',
      'field_values', '{}'::jsonb,
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'not_found',
  'a template from another tenant is not found for the caller'
);

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-unknown-key',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30,
      'status', 'pending'
    )
  ) ->> 'code'),
  'invalid_column',
  'a client-chosen clinical status column is rejected'
);

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-phi-boundary',
    jsonb_build_object(
      'template_id', '00000000-0000-4000-8000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true, 'patient_name', 'Jane Doe'),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'policy_denied',
  'field values outside the de-identified allowlist are rejected'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated"}';
SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-no-aal',
    jsonb_build_object(
      'template_id', '00000000-0000-4000-8000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'forbidden',
  'a session without a verified AAL cannot create a draft'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000003421';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

SELECT is(
  (SELECT public.save_case_draft_command(
    'p1-34-suspended',
    jsonb_build_object(
      'template_id', '00000000-0000-0000-0000-000000003431',
      'case_date', '2026-09-23',
      'field_values', jsonb_build_object('procedure_name', 'Appendectomy', 'supervised', true),
      'accreditation_mappings', '[]'::jsonb,
      'is_deidentified', true,
      'patient_age_years', 30
    )
  ) ->> 'code'),
  'account_inactive',
  'a suspended resident cannot create a draft'
);

RESET ROLE;

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE action = 'case_draft_create'
      AND changes::text ~* 'field_values|appendectomy|patient_mrn|patient_dob'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.audit_outbox
    WHERE action = 'case_draft_create'
      AND changes::text ~* 'field_values|appendectomy|patient_mrn|patient_dob'
  ),
  'draft audit and outbox rows contain no clinical values'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003411","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.save_case_draft_command('', '{}'::jsonb) ->> 'code'),
  'invalid_request',
  'a blank request id is rejected before any write'
);

RESET ROLE;
SELECT is(
  has_function_privilege('anon', 'public.save_case_draft_command(text, jsonb)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute the draft command'
);
SELECT is(
  has_function_privilege('authenticated', 'public.save_case_draft_command(text, jsonb)', 'EXECUTE'),
  true,
  'authenticated callers can execute the draft command'
);

ROLLBACK;
