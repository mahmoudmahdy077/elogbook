BEGIN;
SELECT plan(45);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000002101', 'Convergence Tenant A', 'convergence-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000002102', 'Convergence Tenant B', 'convergence-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000002111', '00000000-0000-0000-0000-000000000000', 'convergence-a@example.test'),
  ('00000000-0000-0000-0000-000000002112', '00000000-0000-0000-0000-000000000000', 'convergence-b@example.test'),
  ('00000000-0000-0000-0000-000000002113', '00000000-0000-0000-0000-000000000000', 'convergence-resident-a@example.test'),
  ('00000000-0000-0000-0000-000000002114', '00000000-0000-0000-0000-000000000000', 'convergence-resident-b@example.test'),
  ('00000000-0000-0000-0000-000000002115', '00000000-0000-0000-0000-000000000000', 'convergence-spare@example.test'),
  ('00000000-0000-0000-0000-000000002116', '00000000-0000-0000-0000-000000000000', 'convergence-supervisor-a@example.test'),
  ('00000000-0000-0000-0000-000000002117', '00000000-0000-0000-0000-000000000000', 'convergence-platform-a@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000002111',
  '00000000-0000-0000-0000-000000002112',
  '00000000-0000-0000-0000-000000002113',
  '00000000-0000-0000-0000-000000002114',
  '00000000-0000-0000-0000-000000002115',
  '00000000-0000-0000-0000-000000002116',
  '00000000-0000-0000-0000-000000002117'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000002121', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002111', 'institution_admin', 'Convergence Admin A', 'active'),
  ('00000000-0000-0000-0000-000000002122', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002112', 'institution_admin', 'Convergence Admin B', 'active'),
  ('00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002113', 'resident', 'Convergence Resident A', 'active'),
  ('00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002114', 'resident', 'Convergence Resident B', 'active'),
  ('00000000-0000-0000-0000-000000002125', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002115', 'resident', 'Convergence Spare', 'active'),
  ('00000000-0000-0000-0000-000000002126', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002116', 'supervisor', 'Convergence Supervisor A', 'active'),
  ('00000000-0000-0000-0000-000000002127', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002117', 'resident', 'Convergence Platform A', 'active');

INSERT INTO public.platform_admins (user_id, status)
VALUES ('00000000-0000-0000-0000-000000002117', 'active')
ON CONFLICT (user_id) DO UPDATE SET status = 'active';

INSERT INTO public.subscription_plans (id, name, slug, price_monthly, features, tenant_type)
VALUES ('00000000-0000-0000-0000-000000002131', 'Convergence Plan', 'convergence-plan', 0, '{"max_cases":0}'::jsonb, 'institution')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000002140', '00000000-0000-0000-0000-000000002101', 'surgery', 'Convergence Template A', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000002141', '00000000-0000-0000-0000-000000002102', 'surgery', 'Convergence Template B', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000002150', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002140', CURRENT_DATE, 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002151', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002141', CURRENT_DATE, 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002152', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002140', '2025-02-03', 'draft', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000002153', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002140', '2025-02-04', 'draft', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE public.case_entries
SET status = 'pending'
WHERE id IN (
  '00000000-0000-0000-0000-000000002152',
  '00000000-0000-0000-0000-000000002153'
);

UPDATE public.case_entries
SET status = CASE id
  WHEN '00000000-0000-0000-0000-000000002152' THEN 'approved'
  ELSE 'rejected'
END
WHERE id IN (
  '00000000-0000-0000-0000-000000002152',
  '00000000-0000-0000-0000-000000002153'
);

-- Carries a gateway subscription/customer binding: from
-- 20260926000002 an active entitlement must be bound to a provider
-- subscription (subscriptions_entitlement_binding_check), so a fixture row
-- without one would no longer be a representable entitlement.
INSERT INTO public.subscriptions (id, tenant_id, plan_id, status, gateway_subscription_id, stripe_customer_id)
VALUES ('00000000-0000-0000-0000-000000002161', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002131', 'active', 'sub_convergence_1', 'cus_convergence_1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenant_settings (id, tenant_id, branding)
VALUES ('00000000-0000-0000-0000-000000002171', '00000000-0000-0000-0000-000000002102', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.notifications (id, tenant_id, user_id, type, title)
VALUES ('00000000-0000-0000-0000-000000002181', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002114', 'test', 'Tenant B notification')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rotations (id, tenant_id, resident_id, supervisor_id, title, start_date, end_date)
VALUES ('00000000-0000-0000-0000-000000002191', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002122', 'Tenant B Rotation', '2026-01-01', '2026-01-31')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.shifts (id, rotation_id, tenant_id, resident_id, shift_date, shift_type)
VALUES ('00000000-0000-0000-0000-000000002201', '00000000-0000-0000-0000-000000002191', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '2026-01-02', 'regular')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.milestones (id, tenant_id, resident_id, competency_area, sub_competency, level, assessment_date)
VALUES ('00000000-0000-0000-0000-000000002211', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', 'Patient Care', 'PC1', 3, '2026-01-03')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.faculty_evaluations (id, tenant_id, resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures)
VALUES ('00000000-0000-0000-0000-000000002221', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002122', '2026-01-04', 4, 4, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.evaluation_forms (id, tenant_id, resident_id, evaluator_id, form_type, ratings, feedback, status)
VALUES ('00000000-0000-0000-0000-000000002231', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002122', 'mini_cex', '{}'::jsonb, 'original', 'completed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.comments (id, tenant_id, evaluation_id, author_id, body)
VALUES ('00000000-0000-0000-0000-000000002241', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002231', '00000000-0000-0000-0000-000000002124', 'original comment')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.scholarly_activities (id, tenant_id, resident_id, activity_type, title)
VALUES ('00000000-0000-0000-0000-000000002251', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', 'research', 'Original research')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.duty_periods (id, tenant_id, resident_id, shift_date, hours_worked, shift_type)
VALUES ('00000000-0000-0000-0000-000000002261', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '2026-01-05', 8, 'regular')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002111","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"institution_admin"}}';

SELECT is(
  (
    WITH deleted AS (
      DELETE FROM public.profiles
      WHERE id = '00000000-0000-0000-0000-000000002125'
      RETURNING id
    )
    SELECT count(*) FROM deleted
  ),
  0::bigint,
  'an institution admin cannot delete a profile from another tenant'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.subscriptions
      SET status = 'canceled'
      WHERE id = '00000000-0000-0000-0000-000000002161'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'an institution admin cannot update another tenant subscription'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.tenant_settings
      SET branding = '{"forged":true}'::jsonb
      WHERE id = '00000000-0000-0000-0000-000000002171'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'an institution admin cannot update another tenant settings row'
);

SELECT is_empty(
  $$SELECT id FROM public.notifications WHERE id = '00000000-0000-0000-0000-000000002181'$$,
  'a tenant admin cannot read another tenant notification'
);

SELECT throws_ok(
  $$INSERT INTO public.notifications (tenant_id, user_id, type, title)
    VALUES ('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002114', 'test', 'forged')$$,
  '42501',
  NULL,
  'a tenant admin cannot insert a notification for another tenant'
);

SELECT throws_ok(
  $$INSERT INTO public.faculty_evaluations (tenant_id, resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures)
    VALUES ('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002122', '2026-01-06', 4, 4, 4)$$,
  '42501',
  NULL,
  'a tenant admin cannot insert an evaluation in another tenant'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.evaluation_forms
      SET feedback = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002231'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant evaluation form'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.rotations
      SET title = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002191'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant rotation'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.shifts
      SET location = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002201'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant shift'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.milestones
      SET comments = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002211'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant milestone'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.comments
      SET body = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002241'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant comment'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.scholarly_activities
      SET title = 'forged'
      WHERE id = '00000000-0000-0000-0000-000000002251'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant scholarly activity'
);

SELECT is(
  (
    WITH changed AS (
      UPDATE public.duty_periods
      SET hours_worked = 1
      WHERE id = '00000000-0000-0000-0000-000000002261'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a tenant admin cannot update another tenant duty period'
);

SELECT throws_ok(
  $$INSERT INTO public.duty_periods (tenant_id, resident_id, shift_date, hours_worked, shift_type)
    VALUES ('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', '2026-01-07', 8, 'regular')$$,
  '42501',
  NULL,
  'a tenant admin cannot insert a duty period for another tenant'
);

SELECT throws_ok(
  $$SELECT public.get_dashboard_data('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002124', 'institution_admin')$$,
  '42501',
  NULL,
  'dashboard RPC rejects a cross-tenant tenant argument'
);

SELECT throws_ok(
  $$SELECT public.get_analytics_data('00000000-0000-0000-0000-000000002102')$$,
  '42501',
  NULL,
  'analytics RPC rejects a cross-tenant tenant argument'
);

SELECT throws_ok(
  $$SELECT public.get_report_counts('00000000-0000-0000-0000-000000002102', NULL, NULL)$$,
  '42501',
  NULL,
  'report RPC rejects a cross-tenant tenant argument'
);

SELECT throws_ok(
  $$SELECT public.get_duty_4wk_violations('00000000-0000-0000-0000-000000002102')$$,
  '42501',
  NULL,
  'duty-hour RPC rejects a cross-tenant tenant argument'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002113","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"resident"}}';

SELECT throws_ok(
  $$UPDATE public.profiles
    SET role = 'supervisor'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot change their own role'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET tenant_id = '00000000-0000-0000-0000-000000002102'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot move their own profile to another tenant'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET user_id = '00000000-0000-0000-0000-000000002116'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot change their own user identity'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET status = 'suspended'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot change their own status'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET invited_by = '00000000-0000-0000-0000-000000002116'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot change their own invitation authority'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET updated_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a resident cannot change profile administration timestamps'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002111","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$UPDATE public.profiles
    SET role = 'supervisor'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'tenant administrators require AAL2 to change profile authority'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002116","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"supervisor"}}';

SELECT is(
  (
    WITH changed AS (
      UPDATE public.profiles
      SET full_name = 'forged-admin-name'
      WHERE id = '00000000-0000-0000-0000-000000002121'
      RETURNING id
    )
    SELECT count(*) FROM changed
  ),
  0::bigint,
  'a supervisor cannot update a tenant administrator'
);

SELECT lives_ok(
  $$UPDATE public.profiles
    SET full_name = 'Supervisor Edited Resident'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  'a supervisor can update mutable fields on a resident row'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET role = 'admin'
    WHERE id = '00000000-0000-0000-0000-000000002123'$$,
  '42501',
  NULL,
  'a supervisor cannot promote a resident through the self-contained WITH CHECK policy'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002117","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"resident"}}';

SELECT throws_ok(
  $$DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000002121'$$,
  '42501',
  NULL,
  'the last active tenant administrator cannot be deleted'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET role = 'supervisor'
    WHERE id = '00000000-0000-0000-0000-000000002121'$$,
  '42501',
  NULL,
  'the last active tenant administrator cannot be demoted'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET status = 'suspended'
    WHERE id = '00000000-0000-0000-0000-000000002121'$$,
  '42501',
  NULL,
  'the last active tenant administrator cannot be suspended'
);

SELECT throws_ok(
  $$UPDATE public.profiles
    SET deleted_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000002121'$$,
  '42501',
  NULL,
  'the last active tenant administrator cannot be soft-deleted'
);

SELECT ok(
  position(
    'FOR UPDATE' IN upper(pg_get_functiondef(to_regprocedure('public.protect_profile_authorization_columns()')))
  ) > 0,
  'last-administrator checks serialize on the tenant row'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT throws_ok(
  $$UPDATE public.profiles
    SET status = 'suspended'
    WHERE id = '00000000-0000-0000-0000-000000002121'$$,
  '42501',
  NULL,
  'service-role profile updates cannot remove the last tenant administrator'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002113","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"resident"}}';

SELECT lives_ok(
  $$SELECT public.get_case_stats('00000000-0000-0000-0000-000000002123')$$,
  'an active resident can read their own case statistics'
);

SELECT is(
  public.get_case_stats(
    '00000000-0000-0000-0000-000000002123',
    DATE '2025-02-01',
    DATE '2025-02-28'
  ),
  jsonb_build_object(
    'total_cases', 2,
    'by_status', jsonb_build_object('approved', 1, 'rejected', 1),
    'by_specialty', jsonb_build_object('surgery', 2),
    'by_month', jsonb_build_object('2025-02', 2),
    'pending_approvals', 0,
    'rejection_rate', 50.00
  ),
  'every case-statistics aggregate applies the same date range'
);

SELECT throws_ok(
  $$SELECT public.get_case_stats('00000000-0000-0000-0000-000000002124')$$,
  '42501',
  NULL,
  'a resident cannot read another profile case statistics'
);

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{}';

SELECT throws_ok(
  $$SELECT public.get_case_stats()$$,
  '42501',
  NULL,
  'anonymous principals cannot read case statistics'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{}';

SELECT throws_ok(
  $$SELECT public.get_case_stats()$$,
  '42501',
  NULL,
  'authenticated principals without a user identity cannot read case statistics'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000002123';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002113","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"resident"}}';

SELECT throws_ok(
  $$SELECT public.get_case_stats('00000000-0000-0000-0000-000000002123')$$,
  '42501',
  NULL,
  'a suspended resident cannot read case statistics'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000002123';
UPDATE public.profiles
SET deleted_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000002123';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002113","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"resident"}}';

SELECT throws_ok(
  $$SELECT public.get_case_stats('00000000-0000-0000-0000-000000002123')$$,
  '42501',
  NULL,
  'a soft-deleted profile is not an active principal'
);

RESET ROLE;
UPDATE public.profiles
SET deleted_at = NULL
WHERE id = '00000000-0000-0000-0000-000000002123';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000002111","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000002101","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$SELECT public.get_case_stats()$$,
  '42501',
  NULL,
  'tenant-wide case statistics require AAL2 for privileged roles'
);

RESET ROLE;

SELECT is_empty(
  $$
  SELECT tablename
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'profiles', 'subscriptions', 'tenant_settings', 'notifications',
      'evaluation_forms', 'faculty_evaluations', 'rotations', 'shifts',
      'milestones', 'comments', 'scholarly_activities', 'duty_periods'
    )
    AND cmd = 'ALL'
  $$,
  'tenant-scoped policies do not retain broad FOR ALL policies'
);

SELECT is_empty(
  $$
  WITH required(tablename) AS (
    VALUES
      ('profiles'), ('subscriptions'), ('tenant_settings'), ('notifications'),
      ('evaluation_forms'), ('faculty_evaluations'), ('rotations'), ('shifts'),
      ('milestones'), ('comments'), ('scholarly_activities'), ('duty_periods')
  )
  SELECT r.tablename
  FROM required AS r
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename = r.tablename
      AND (
        (COALESCE(p.qual, '') ILIKE '%tenant_id%' AND COALESCE(p.qual, '') ILIKE '%get_tenant_id%')
        OR (COALESCE(p.with_check, '') ILIKE '%tenant_id%' AND COALESCE(p.with_check, '') ILIKE '%get_tenant_id%')
      )
  )
  $$,
  'each affected table has an explicit tenant predicate in a policy'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies AS policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename = 'profiles'
      AND policy_record.policyname = 'Tenant supervisors and administrators can update resident profiles'
      AND policy_record.cmd = 'UPDATE'
      AND COALESCE(policy_record.qual, '') ILIKE '%get_user_role%'
      AND COALESCE(policy_record.with_check, '') ILIKE '%get_user_role%'
      AND COALESCE(policy_record.with_check, '') ILIKE '%get_tenant_id%'
  ),
  'profile UPDATE WITH CHECK repeats the caller authorization predicate'
);

ROLLBACK;
