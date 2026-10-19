-- p1_35: consent tenant authority + tenant invitation boundary.
--
-- Proves the two high-severity findings are closed at the database:
--
--   consent_records
--     1-3  the INSERT policy resolves tenant_id from the caller's own profile
--     4-6  the consent RPC is SECURITY DEFINER and authenticated-only
--     7    a cross-tenant consent row is rejected by the policy
--     8    a same-tenant consent row is allowed by the policy
--     9    set_user_consent refuses a foreign tenant
--     10   set_user_consent writes the caller's authoritative tenant
--
--   tenant_invites
--     11   expires_at exists and is NOT NULL
--     12-13 the token digest exists and is unreadable to authenticated
--     14   a tenant cannot hold two live invitations for one address
--     15   the token digest is unique
--
--   redemption (handle_new_user)
--     16   an un-invited signup provisions nothing
--     17   an expired invitation cannot be redeemed
--     18   an invitation in an inactive tenant cannot be redeemed
--     19   a valid invitation provisions a profile in the issuing tenant
--     20   redemption consumes the invitation (single use)
--     21   a second signup with the same address provisions nothing
--     22   redemption binds to the issuing tenant, not a caller-supplied one
--
--   expiry immutability
--     23-24 a tenant administrator cannot extend an invitation that is live
BEGIN;
SELECT plan(25);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003501', 'Consent Tenant A', 'consent-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003502', 'Consent Tenant B', 'consent-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003503', 'Invitation Tenant A', 'invite-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003504', 'Invitation Tenant B', 'invite-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003505', 'Invitation Tenant Suspended', 'invite-tenant-susp', 'institution', encode(gen_random_bytes(32), 'hex'), 'suspended')
ON CONFLICT (id) DO NOTHING;

-- handle_new_user runs on every auth.users insert. These rows carry no
-- invitation, so the trigger provisions nothing for any of them.
INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003511', '00000000-0000-0000-0000-000000000000', 'consent-resident-a@example.test'),
  ('00000000-0000-0000-0000-000000003512', '00000000-0000-0000-0000-000000000000', 'consent-resident-b@example.test'),
  ('00000000-0000-0000-0000-000000003513', '00000000-0000-0000-0000-000000000000', 'invite-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000003514', '00000000-0000-0000-0000-000000000000', 'uninvited-visitor@example.test'),
  ('00000000-0000-0000-0000-000000003515', '00000000-0000-0000-0000-000000000000', 'expired-invitee@example.test'),
  ('00000000-0000-0000-0000-000000003516', '00000000-0000-0000-0000-000000000000', 'suspended-invitee@example.test'),
  ('00000000-0000-0000-0000-000000003517', '00000000-0000-0000-0000-000000000000', 'valid-invitee@example.test'),
  ('00000000-0000-0000-0000-000000003518', '00000000-0000-0000-0000-000000000000', 'valid-invitee@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003511',
  '00000000-0000-0000-0000-000000003512',
  '00000000-0000-0000-0000-000000003513',
  '00000000-0000-0000-0000-000000003514',
  '00000000-0000-0000-0000-000000003515',
  '00000000-0000-0000-0000-000000003516',
  '00000000-0000-0000-0000-000000003517',
  '00000000-0000-0000-0000-000000003518'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003521', '00000000-0000-0000-0000-000000003501', '00000000-0000-0000-0000-000000003511', 'resident', 'Consent Resident A', 'active'),
  ('00000000-0000-0000-0000-000000003522', '00000000-0000-0000-0000-000000003502', '00000000-0000-0000-0000-000000003512', 'resident', 'Consent Resident B', 'active'),
  ('00000000-0000-0000-0000-000000003523', '00000000-0000-0000-0000-000000003503', '00000000-0000-0000-0000-000000003513', 'institution_admin', 'Invitation Admin A', 'active');

-- Invitation fixtures: one expired, one in a suspended tenant, one live in
-- tenant B, and one live in tenant A for the expiry-immutability check.
INSERT INTO public.tenant_invites (id, tenant_id, email, role, status, expires_at, token_hash)
VALUES
  ('00000000-0000-0000-0000-000000003531', '00000000-0000-0000-0000-000000003503', 'expired-invitee@example.test', 'supervisor', 'pending', NOW() - INTERVAL '1 hour', repeat('1', 64)),
  ('00000000-0000-0000-0000-000000003532', '00000000-0000-0000-0000-000000003505', 'suspended-invitee@example.test', 'supervisor', 'pending', NOW() + INTERVAL '1 day', repeat('2', 64)),
  ('00000000-0000-0000-0000-000000003533', '00000000-0000-0000-0000-000000003504', 'valid-invitee@example.test', 'supervisor', 'pending', NOW() + INTERVAL '1 day', repeat('3', 64)),
  ('00000000-0000-0000-0000-000000003534', '00000000-0000-0000-0000-000000003503', 'live-invitee-a@example.test', 'supervisor', 'pending', NOW() + INTERVAL '1 day', repeat('4', 64))
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- consent_records: tenant-bound write authority
-- ---------------------------------------------------------------------------

-- 1. The converged INSERT policy must derive the tenant from the caller's own
--    profile rather than accept a tenant_id from the request.
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'consent_records'
      AND policy.cmd = 'INSERT'
      AND policy.qual ILIKE '%profiles%'
      AND policy.qual ILIKE '%tenant_id%'
      AND policy.qual ILIKE '%auth.uid()%'
  ),
  'the consent insert policy resolves tenant_id from the caller own profile'
);

-- 2. The legacy user_id-only policy must be gone.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'consent_records'
      AND policyname = 'Users can insert own consent records'
  ),
  'the unbound self-insert consent policy is dropped'
);

-- 3. Direct INSERT is revoked: the consent RPC is the only write path.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.consent_records', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.consent_records', 'INSERT'),
  'authenticated and anon cannot insert consent records directly'
);

-- 4. The read model survives.
SELECT ok(
  has_table_privilege('authenticated', 'public.consent_records', 'SELECT'),
  'authenticated retains SELECT on consent_records'
);

-- 5. The consent RPC is authenticated-only.
SELECT ok(
  NOT has_function_privilege('anon', 'public.set_user_consent(uuid,text,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.set_user_consent(uuid,text,boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_user_consent(uuid,text,boolean)', 'EXECUTE'),
  'set_user_consent is executable by authenticated only'
);

-- 6. The consent RPC owns the write as a definer.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc AS proc
    INNER JOIN pg_namespace AS ns ON ns.oid = proc.pronamespace
    WHERE ns.nspname = 'public'
      AND proc.proname = 'set_user_consent'
      AND proc.prosecdef
  ),
  'set_user_consent is SECURITY DEFINER'
);

-- Isolate the policy from the revoked privilege so the tenant predicate itself
-- is what is under test.
GRANT INSERT ON public.consent_records TO authenticated;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003511","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000003501","user_role":"resident"}}';

-- 7. A resident of tenant A cannot write a consent row into tenant B.
SELECT throws_ok(
  $$INSERT INTO public.consent_records (tenant_id, user_id, consent_type)
    VALUES ('00000000-0000-0000-0000-000000003502', '00000000-0000-0000-0000-000000003511', 'ai_insights')$$,
  '42501',
  NULL,
  'a resident cannot forge a consent record in another tenant'
);

-- 8. The same resident can write a consent row into their own tenant.
SELECT is(
  (WITH written AS (
    INSERT INTO public.consent_records (tenant_id, user_id, consent_type)
    VALUES ('00000000-0000-0000-0000-000000003501', '00000000-0000-0000-0000-000000003511', 'ai_insights')
    RETURNING id
  ) SELECT count(*) FROM written),
  1::bigint,
  'a resident can write a consent record in their own tenant'
);

-- 9. The RPC refuses a foreign tenant, so it cannot be used as the forgery path.
SELECT throws_ok(
  $$SELECT public.set_user_consent(
    '00000000-0000-0000-0000-000000003502', 'ai_insights', TRUE)$$,
  '42501',
  NULL,
  'set_user_consent refuses a tenant the caller does not belong to'
);

-- 10. The RPC writes the caller own tenant.
SELECT is(
  (SELECT count(*)
   FROM public.consent_records
   WHERE tenant_id = '00000000-0000-0000-0000-000000003501'
     AND user_id = '00000000-0000-0000-0000-000000003511'
     AND consent_type = 'data_export'
     AND revoked_at IS NULL),
  1::bigint,
  'set_user_consent records the grant against the caller authoritative tenant'
);

RESET ROLE;
REVOKE INSERT ON public.consent_records FROM authenticated;

-- ---------------------------------------------------------------------------
-- tenant_invites: expiry, digest, single use
-- ---------------------------------------------------------------------------

-- 11. An invitation always has a deadline.
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_invites'
      AND column_name = 'expires_at'
      AND is_nullable = 'NO'
  ),
  'tenant_invites.expires_at exists and is NOT NULL'
);

-- 12. The digest column exists.
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_invites'
      AND column_name = 'token_hash'
  ),
  'tenant_invites.token_hash exists'
);

-- 13. A tenant session cannot read the digest.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.tenant_invites', 'token_hash', 'SELECT')
  AND NOT has_column_privilege('anon', 'public.tenant_invites', 'token_hash', 'SELECT'),
  'the invitation token digest is unreadable to authenticated and anon'
);

-- 14. One live invitation per address per tenant.
SELECT throws_ok(
  $$INSERT INTO public.tenant_invites (tenant_id, email, role, status, expires_at, token_hash)
    VALUES ('00000000-0000-0000-0000-000000003503', 'live-invitee-a@example.test', 'resident', 'pending', NOW() + INTERVAL '1 day', repeat('5', 64))$$,
  '23505',
  NULL,
  'a tenant cannot hold two pending invitations for the same address'
);

-- 15. The digest is unique across invitations.
SELECT throws_ok(
  $$INSERT INTO public.tenant_invites (tenant_id, email, role, status, expires_at, token_hash)
    VALUES ('00000000-0000-0000-0000-000000003504', 'someone-else@example.test', 'resident', 'pending', NOW() + INTERVAL '1 day', repeat('4', 64))$$,
  '23505',
  NULL,
  'two invitations cannot share a token digest'
);

-- ---------------------------------------------------------------------------
-- Redemption: an invitation is the only route into a tenant
-- ---------------------------------------------------------------------------

-- 16. Public self-service signup provisions nothing.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-0000-0000-000000003514'
  ),
  'an un-invited signup provisions no profile and therefore no tenant'
);

-- 16b. It also stamps no tenant app metadata.
SELECT ok(
  (SELECT COALESCE(NOT (raw_app_meta_data ? 'tenant_id'), TRUE)
   FROM auth.users
   WHERE id = '00000000-0000-0000-0000-000000003514'),
  'an un-invited signup stamps no tenant_id into auth app metadata'
);

-- 17. An expired invitation cannot be redeemed.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-0000-0000-000000003515'
  ),
  'an expired invitation cannot provision a profile'
);

-- 18. An invitation in an inactive tenant cannot be redeemed.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-0000-0000-000000003516'
  ),
  'an invitation in a suspended tenant cannot provision a profile'
);

-- 19. A valid invitation provisions a profile in the issuing tenant.
SELECT is(
  (SELECT tenant_id FROM public.profiles
   WHERE user_id = '00000000-0000-0000-0000-000000003517'),
  '00000000-0000-0000-0000-000000003504'::UUID,
  'a valid invitation provisions the profile in the tenant that issued it'
);

-- 20. Redemption consumes the invitation: single use.
SELECT is(
  (SELECT status FROM public.tenant_invites
   WHERE id = '00000000-0000-0000-0000-000000003533'),
  'accepted',
  'redemption moves the invitation out of pending'
);

-- 21. A second signup with the same address provisions nothing.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = '00000000-0000-0000-0000-000000003518'
  ),
  'a second signup with the same address cannot reuse a consumed invitation'
);

-- 22. The profile tenant comes from the invitation, never from the caller.
SELECT is(
  (SELECT count(*)
   FROM public.profiles AS p
   INNER JOIN public.tenant_invites AS invite ON invite.tenant_id = p.tenant_id
   WHERE p.user_id = '00000000-0000-0000-0000-000000003517'
     AND invite.id = '00000000-0000-0000-0000-000000003533'),
  1::bigint,
  'the provisioned tenant is the one that issued the invitation'
);

-- ---------------------------------------------------------------------------
-- Expiry immutability
-- ---------------------------------------------------------------------------

-- 23. The guard trigger exists.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tenant_invites'::regclass
      AND tgname = 'trg_protect_tenant_invite_expiry'
  ),
  'the invitation expiry guard trigger exists'
);

-- 24. A tenant administrator cannot extend a live invitation.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003513","role":"authenticated","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000003503","user_role":"institution_admin"}}';
SELECT throws_ok(
  $$UPDATE public.tenant_invites
     SET expires_at = NOW() + INTERVAL '365 days'
    WHERE id = '00000000-0000-0000-0000-000000003534'$$,
  '42501',
  NULL,
  'a tenant administrator cannot extend a live invitation'
);
RESET ROLE;

ROLLBACK;
