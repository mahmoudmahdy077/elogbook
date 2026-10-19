-- p1_33: billing entitlement authority (SPEC-CLINICAL-CORE section 9.3).
--
-- `subscriptions` and `subscription_plans` are entitlement state. Before
-- 20260926000002 a tenant administrator could:
--   * INSERT/UPDATE `subscriptions` for their own tenant with status='active',
--     which `check_case_quota` reads as full paid access;
--   * INSERT a `subscription_plans` row with arbitrary `features` -- including
--     `max_cases: 0`, which `check_case_quota` treats as UNLIMITED -- and an
--     arbitrary `price_monthly` of 0, then point their own subscription at it.
--
-- That is a self-activation path with no payment. Each vector below is asserted
-- twice: once that the write RAISES, and once that no row changed. The second
-- half matters -- a denial that still mutated state would be a silent grant.
BEGIN;
SELECT plan(28);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003301', 'Billing Tenant A', 'billing-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003302', 'Billing Tenant B', 'billing-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003311', '00000000-0000-0000-0000-000000000000', 'billing-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000003312', '00000000-0000-0000-0000-000000000000', 'billing-admin-b@example.test'),
  ('00000000-0000-0000-0000-000000003313', '00000000-0000-0000-0000-000000000000', 'billing-platform@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003311',
  '00000000-0000-0000-0000-000000003312',
  '00000000-0000-0000-0000-000000003313'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003321', '00000000-0000-0000-0000-000000003301', '00000000-0000-0000-0000-000000003311', 'institution_admin', 'Billing Admin A', 'active'),
  ('00000000-0000-0000-0000-000000003322', '00000000-0000-0000-0000-000000003302', '00000000-0000-0000-0000-000000003312', 'institution_admin', 'Billing Admin B', 'active'),
  ('00000000-0000-0000-0000-000000003323', '00000000-0000-0000-0000-000000003301', '00000000-0000-0000-0000-000000003313', 'resident', 'Billing Platform Operator', 'active');

INSERT INTO public.platform_admins (user_id, status)
VALUES ('00000000-0000-0000-0000-000000003313', 'active')
ON CONFLICT (user_id) DO UPDATE SET status = 'active';

-- Platform-owned catalog. `max_cases: 0` on the Pro plan is the shape the
-- self-activation path relied on; it is legitimate here only because the row
-- cannot be written by a tenant principal.
INSERT INTO public.subscription_plans (id, name, slug, price_monthly, features, tenant_type)
VALUES
  ('00000000-0000-0000-0000-000000003331', 'Billing Plan Basic', 'billing-plan-basic', 49.00, '{"max_cases": 100}'::jsonb, 'institution'),
  ('00000000-0000-0000-0000-000000003332', 'Billing Plan Pro', 'billing-plan-pro', 149.00, '{"max_cases": 0}'::jsonb, 'institution')
ON CONFLICT (id) DO NOTHING;

-- A tenant-scoped activation as the verified payment-event path writes it.
INSERT INTO public.subscriptions (id, tenant_id, plan_id, status, gateway_subscription_id, stripe_customer_id, stripe_event_created, stripe_object_version, last_stripe_event_id)
VALUES ('00000000-0000-0000-0000-000000003341', '00000000-0000-0000-0000-000000003301', '00000000-0000-0000-0000-000000003331', 'active', 'sub_verified_1', 'cus_verified_1', 100, 1, 'evt_verified_1')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1-6. Plan catalog immutability: a tenant admin cannot author an entitlement.
--
-- Note the two denial shapes, which are not interchangeable:
--   * INSERT raises (the BEFORE guard fires on the proposed row, and the RLS
--     WITH CHECK has no policy to satisfy);
--   * UPDATE/DELETE are silently filtered to zero rows by RLS, so the BEFORE
--     guard never sees a row. Asserting they "raise" would be wrong -- the
--     security property is that no row changes.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003311","role":"authenticated","aal":"aal2"}';

SELECT throws_ok(
  $$INSERT INTO public.subscription_plans (name, slug, price_monthly, features, tenant_type, is_custom, created_by)
    VALUES ('Unlimited', 'unlimited-forged', 0, '{"max_cases": 0}'::jsonb, 'institution', true, '00000000-0000-0000-0000-000000003311')$$,
  NULL,
  'an institution admin cannot insert a subscription plan'
);
SELECT is(
  (SELECT count(*) FROM public.subscription_plans WHERE slug = 'unlimited-forged'),
  0::bigint,
  'the forged plan was not created'
);

SELECT is(
  (WITH changed AS (
    UPDATE public.subscription_plans
    SET features = '{"max_cases": 0}'::jsonb, price_monthly = 0
    WHERE id = '00000000-0000-0000-0000-000000003331'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an institution admin cannot rewrite plan features or price'
);
SELECT is(
  (SELECT price_monthly::text FROM public.subscription_plans WHERE id = '00000000-0000-0000-0000-000000003331'),
  '49.00',
  'the catalog price is unchanged after the denied update'
);

SELECT is(
  (WITH removed AS (
    DELETE FROM public.subscription_plans
    WHERE id = '00000000-0000-0000-0000-000000003331'
    RETURNING id
  ) SELECT count(*) FROM removed),
  0::bigint,
  'an institution admin cannot delete a referenced plan'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.subscription_plans WHERE id = '00000000-0000-0000-0000-000000003331'),
  'the referenced plan still exists after the denied delete'
);

-- ---------------------------------------------------------------------------
-- 7-12. Entitlement self-activation and cross-tenant interference.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.subscriptions (tenant_id, plan_id, status)
    VALUES ('00000000-0000-0000-0000-000000003301', '00000000-0000-0000-0000-000000003332', 'active')$$,
  NULL,
  'an institution admin cannot self-activate a subscription by direct insert'
);
SELECT is(
  (SELECT count(*) FROM public.subscriptions WHERE tenant_id = '00000000-0000-0000-0000-000000003301'),
  1::bigint,
  'no extra subscription row was created for the self-activation attempt'
);

SELECT is(
  (WITH changed AS (
    UPDATE public.subscriptions
    SET plan_id = '00000000-0000-0000-0000-000000003332', status = 'active'
    WHERE tenant_id = '00000000-0000-0000-0000-000000003301'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an institution admin cannot escalate a subscription by direct update'
);
SELECT is(
  (SELECT plan_id::text FROM public.subscriptions WHERE id = '00000000-0000-0000-0000-000000003341'),
  '00000000-0000-0000-0000-000000003331',
  'the subscription is still on its original plan after the denied escalation'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003312","role":"authenticated","aal":"aal2"}';
SELECT is(
  (WITH changed AS (
    UPDATE public.subscriptions SET status = 'canceled'
    WHERE tenant_id = '00000000-0000-0000-0000-000000003301'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an institution admin cannot cancel another tenant subscription'
);
SELECT is(
  (SELECT status FROM public.subscriptions WHERE id = '00000000-0000-0000-0000-000000003341'),
  'active',
  'the other tenant subscription is still active after the denied cancel'
);

-- ---------------------------------------------------------------------------
-- 13-15. The entitlement audit trail cannot be authored by the tenant it
--         constrains, and reads are untouched.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003311","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$INSERT INTO public.subscription_changes (tenant_id, old_plan_id, new_plan_id, change_type, reason, changed_by)
    VALUES ('00000000-0000-0000-0000-000000003301', NULL, '00000000-0000-0000-0000-000000003332', 'upgrade', 'forged', '00000000-0000-0000-0000-000000003311')$$,
  NULL,
  'an institution admin cannot fabricate subscription change history'
);
SELECT is(
  (SELECT count(*) FROM public.subscription_changes WHERE reason = 'forged'),
  0::bigint,
  'the fabricated change record was not written'
);
SELECT ok(
  (SELECT count(*) FROM public.subscriptions) > 0,
  'tenant members can still read their subscription rows'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 16-19. Webhook-only activation, and the binding invariant that makes a
--         self-activation inert even if a policy ever regressed.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$INSERT INTO public.subscriptions (id, tenant_id, plan_id, status, gateway_subscription_id, stripe_customer_id, stripe_event_created, stripe_object_version, last_stripe_event_id)
    VALUES ('00000000-0000-0000-0000-000000003342', '00000000-0000-0000-0000-000000003302', '00000000-0000-0000-0000-000000003331', 'active', 'sub_verified_2', 'cus_verified_2', 200, 1, 'evt_verified_2')
    ON CONFLICT (id) DO NOTHING$$,
  'a verified payment event writes an active subscription'
);
SELECT is(
  (SELECT gateway_subscription_id FROM public.subscriptions WHERE id = '00000000-0000-0000-0000-000000003342'),
  'sub_verified_2',
  'the webhook-written subscription carries its gateway binding'
);
SELECT throws_ok(
  $$INSERT INTO public.subscriptions (id, tenant_id, plan_id, status)
    VALUES ('00000000-0000-0000-0000-000000003343', '00000000-0000-0000-0000-000000003302', '00000000-0000-0000-0000-000000003331', 'active')$$,
  NULL,
  'an active entitlement cannot be written without a gateway binding'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'subscriptions_entitlement_binding_check'
  ),
  'the entitlement binding constraint is installed'
);

-- ---------------------------------------------------------------------------
-- 20. No principal holds a write policy on an entitlement table.
-- ---------------------------------------------------------------------------
SELECT is_empty(
  $$
  SELECT catalog.table_name
  FROM unnest(ARRAY['subscriptions', 'subscription_plans', 'custom_plan_features', 'subscription_changes', 'payments']) AS catalog(table_name)
  WHERE EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = catalog.table_name
      AND policyname IS NOT NULL
      AND policyname NOT ILIKE '%read%'
  )
  $$,
  'entitlement tables expose no non-read policy to any principal'
);

-- ---------------------------------------------------------------------------
-- 21-26. The platform command RPC and the authority it depends on.
-- ---------------------------------------------------------------------------
SELECT ok(
  to_regprocedure('public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)') IS NOT NULL
    AND to_regprocedure('public.platform_cancel_subscription(uuid,uuid,text,text)') IS NOT NULL,
  'the platform entitlement command RPCs exist'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.platform_cancel_subscription(uuid,uuid,text,text)', 'EXECUTE'),
  'anonymous callers cannot execute the entitlement command RPCs'
);
SELECT ok(
  pg_get_functiondef('public.require_platform_entitlement_principal(uuid)'::regprocedure) LIKE '%aal2%',
  'entitlement commands require a live AAL2 principal'
);
SELECT ok(
  pg_get_functiondef('public.require_platform_entitlement_principal(uuid)'::regprocedure) LIKE '%is_platform_admin%',
  'entitlement commands require platform registry membership'
);
SELECT ok(
  pg_get_functiondef('public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)'::regprocedure) LIKE '%subscription_plans%'
    AND NOT pg_get_functiondef('public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)'::regprocedure) LIKE '%max_cases%'
    AND NOT pg_get_functiondef('public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)'::regprocedure) LIKE '%p_features%',
  'activation resolves the plan from the catalog rather than caller features'
);
SELECT ok(
  pg_get_functiondef('public.platform_activate_subscription(uuid,uuid,text,text,text,text,text)'::regprocedure) LIKE '%gateway_binding_required%',
  'activation requires a verified gateway subscription and customer binding'
);

-- ---------------------------------------------------------------------------
-- 27-28. End to end: the command refuses a tenant administrator, and the
--         verified activation stands afterwards.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003311","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$SELECT public.platform_activate_subscription(
       '00000000-0000-0000-0000-000000003301',
       '00000000-0000-0000-0000-000000003321',
       'billing-plan-pro', 'sub_forged', 'cus_forged', 'req-self-activation', 'self activation attempt')$$,
  NULL,
  'a tenant administrator cannot activate a subscription through the command RPC'
);
SELECT is(
  (SELECT status FROM public.subscriptions WHERE id = '00000000-0000-0000-0000-000000003342'),
  'active',
  'the webhook-activated subscription is still active after the denied self-activation'
);
RESET ROLE;

ROLLBACK;
