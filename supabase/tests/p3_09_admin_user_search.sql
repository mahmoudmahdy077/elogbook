-- p3_09: public.search_users -- tenant-scoped user search that does not strip the
-- characters people actually type in names.
--
-- The admin user list used to express a name-or-specialty search as
-- `.or('full_name.ilike.%t%,specialty.ilike.%t%')`. That grammar treats `.` and
-- `,` as structure and has no escape for `%` or `_`, so the only safe value was a
-- character class that excluded the apostrophe and the period. `O'Brien` and
-- `Dr. Smith` were therefore unfindable -- a correctness failure that presented as
-- a security fix.
--
-- The search now lives here, where the term is a bound parameter. What this suite
-- pins is that the move did not trade one problem for another: the term is taken
-- literally (no wildcards, no dropped characters), the tenant comes from the
-- authoritative principal rather than the argument, the page is bounded, and the
-- projection stays the non-sensitive one the list already showed.
BEGIN;
SELECT plan(30);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003901', 'Search Tenant A', 'search-tenant-a', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003902', 'Search Tenant B', 'search-tenant-b', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003911', '00000000-0000-0000-0000-000000000000', 'search-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000003912', '00000000-0000-0000-0000-000000000000', 'search-admin-b@example.test'),
  ('00000000-0000-0000-0000-000000003913', '00000000-0000-0000-0000-000000000000', 'search-resident-a@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003911',
  '00000000-0000-0000-0000-000000003912',
  '00000000-0000-0000-0000-000000003913'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, specialty, status)
VALUES
  ('00000000-0000-0000-0000-000000003921', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000003911', 'institution_admin', 'Search Admin A', NULL, 'active'),
  ('00000000-0000-0000-0000-000000003922', '00000000-0000-0000-0000-000000003902', '00000000-0000-0000-0000-000000003912', 'institution_admin', 'Search Admin B', NULL, 'active'),
  ('00000000-0000-0000-0000-000000003923', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000003913', 'resident', 'Search Resident A', 'emergency', 'active'),
  ('00000000-0000-0000-0000-000000003924', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000000000', 'resident', 'O''Brien, Aoife', 'anaesthesia', 'active'),
  ('00000000-0000-0000-0000-000000003925', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000000000', 'director', 'Dr. Amara Smith', 'cardiology', 'active'),
  ('00000000-0000-0000-0000-000000003926', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000000000', 'supervisor', 'Percent Person', '100% effort', 'active'),
  ('00000000-0000-0000-0000-000000003927', '00000000-0000-0000-0000-000000003901', '00000000-0000-0000-0000-000000000000', 'resident', 'Suspended Person', 'surgery', 'suspended'),
  ('00000000-0000-0000-0000-000000003928', '00000000-0000-0000-0000-000000003902', '00000000-0000-0000-0000-000000000000', 'resident', 'O''Brien, Tomas', 'anaesthesia', 'active');

-- 100 further residents so the page ceiling is a real number and not a coincidence
-- of a five-person tenant.
DO $$
DECLARE
  v_index INTEGER;
  v_suffix TEXT;
BEGIN
  FOR v_index IN 0..99 LOOP
    v_suffix := lpad(v_index::TEXT, 2, '0');
    INSERT INTO auth.users (id, instance_id, email)
    VALUES (
      ('00000000-0000-0000-0000-0000000039' || v_suffix)::UUID,
      '00000000-0000-0000-0000-000000000000',
      'search-bulk-' || v_suffix || '@example.test'
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, specialty, status)
    VALUES (
      ('00000000-0000-0000-0000-0000000038' || v_suffix)::UUID,
      '00000000-0000-0000-0000-000000003901',
      ('00000000-0000-0000-0000-0000000039' || v_suffix)::UUID,
      'resident',
      'Bulk Resident ' || v_suffix,
      'bulk specialty ' || v_suffix,
      'active'
    );
  END LOOP;
END;
$$;

-- 1. The RPC exists with the documented signature.
SELECT has_function(
  'public',
  'search_users',
  ARRAY['uuid', 'text', 'text', 'text', 'integer', 'integer'],
  'search_users exists with the documented signature'
);

-- 2. It is a definer, so the tenant predicate is not the caller's to satisfy.
SELECT ok(
  COALESCE((
    SELECT function_record.prosecdef
    FROM pg_proc AS function_record
    WHERE function_record.oid = to_regprocedure('public.search_users(uuid,text,text,text,integer,integer)')
  ), false),
  'search_users runs as the definer so the tenant predicate is not the caller''s to satisfy'
);

-- 3. And it pins a search_path, like every other definer in the catalog.
SELECT ok(
  COALESCE((
    SELECT bool_and(config_entry LIKE 'search_path=%')
    FROM unnest(COALESCE(
      (SELECT function_record.proconfig
       FROM pg_proc AS function_record
       WHERE function_record.oid = to_regprocedure('public.search_users(uuid,text,text,text,integer,integer)')),
      ARRAY[]::TEXT[]
    )) AS config_entry
  ), false),
  'search_users pins a search_path'
);

-- 4-7. Grants: authenticated, and only authenticated.
SELECT is(
  has_function_privilege('anon', 'public.search_users(uuid,text,text,text,integer,integer)', 'EXECUTE'),
  false,
  'anon cannot execute search_users'
);
SELECT is(
  has_function_privilege('public', 'public.search_users(uuid,text,text,text,integer,integer)', 'EXECUTE'),
  false,
  'PUBLIC cannot execute search_users'
);
SELECT is(
  has_function_privilege('authenticated', 'public.search_users(uuid,text,text,text,integer,integer)', 'EXECUTE'),
  true,
  'authenticated can execute search_users'
);
SELECT is(
  has_function_privilege('service_role', 'public.search_users(uuid,text,text,text,integer,integer)', 'EXECUTE'),
  false,
  'service_role cannot execute search_users'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003911","role":"authenticated","aal":"aal2"}';

-- 8. The apostrophe survives: O'Brien is findable by the very character that makes
--    the PostgREST grammar unsafe.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', 'O''Brien')),
  1::bigint,
  'a name containing an apostrophe is searchable'
);

-- 9. The period survives.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', 'Dr. Smith')),
  1::bigint,
  'a name containing a period is searchable'
);

-- 10. Either column counts, not both: a specialty term finds the person whose name
--     does not contain it.
SELECT is(
  (SELECT full_name FROM public.search_users('00000000-0000-0000-0000-000000003901', 'cardiology')),
  'Dr. Amara Smith',
  'a specialty term matches a person whose name does not contain it'
);

-- 11-12. `%` and `_` are literal characters, not wildcards. A `%` term must not
--       match every profile in the tenant.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', '%')),
  1::bigint,
  'a percent sign matches only the row that literally contains one'
);
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', '_')),
  0::bigint,
  'an underscore is not a single-character wildcard'
);

-- 13-14. PostgREST grammar characters are data here: no error, no extra clause, no
--       second column compared against the term.
SELECT lives_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003901', 'a,b.c(d)e')$$,
  'commas, periods and parentheses are accepted as ordinary search text'
);
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', 'role.eq.admin')),
  0::bigint,
  'a filter-shaped term matches no column'
);

-- 15. A blank term is not a filter, it is the whole tenant.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', '   ')),
  105::bigint,
  'an empty term lists the tenant rather than matching nothing'
);

-- 16-17. The projection is the non-sensitive one, exactly.
SELECT is(
  (
    SELECT array_agg(out_column.attname::TEXT ORDER BY out_column.attnum)
    FROM pg_proc AS function_record
    CROSS JOIN LATERAL unnest(function_record.proargnames) WITH ORDINALITY AS out_column(attname, attnum)
    WHERE function_record.oid = to_regprocedure('public.search_users(uuid,text,text,text,integer,integer)')
  ),
  ARRAY['id','user_id','tenant_id','role','full_name','specialty','status','created_at','last_login_at','deactivated_at','total_count']::TEXT[],
  'the RPC returns exactly the documented non-sensitive projection'
);
SELECT is_empty(
  $$
  SELECT forbidden_column.column_name
  FROM unnest(ARRAY['email','phone','invited_by','pending_role','deleted_at','user_metadata']) AS forbidden_column(column_name)
  WHERE EXISTS (
    SELECT 1
    FROM pg_proc AS function_record
    CROSS JOIN LATERAL unnest(function_record.proargnames) AS out_column(attname)
    WHERE function_record.oid = to_regprocedure('public.search_users(uuid,text,text,text,integer,integer)')
      AND out_column.attname::TEXT = forbidden_column.column_name
  )
  $$,
  'the search projection carries no contact, invite, role-pending or deletion column'
);

-- 18. Inactive rows stay out, exactly as the RLS read they replaced did.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', 'Suspended')),
  0::bigint,
  'a suspended profile is not returned by the search'
);

-- 19-20. Role narrows, and a role outside the known set is refused rather than
--       ignored -- silently ignoring one would return a wider set than asked for.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL, 'director')),
  1::bigint,
  'a role filter narrows the result'
);
SELECT throws_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL, 'superuser')$$,
  '22023',
  NULL,
  'a role outside the known set is refused rather than ignored'
);

-- 21-24. Page and limit are bounded by the database, not only by the route.
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL, NULL, NULL, 1, 1000000)),
  100::bigint,
  'an oversized limit is clamped to the page ceiling rather than dumping the tenant'
);
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL, NULL, NULL, 2, 1000000)),
  5::bigint,
  'the following page returns the remainder'
);
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL, NULL, NULL, -5, 0)),
  1::bigint,
  'a negative page and a zero limit are clamped to the first page at one row'
);
SELECT is(
  (SELECT total_count FROM public.search_users('00000000-0000-0000-0000-000000003901', 'Bulk', NULL, NULL, 1, 1)),
  100::bigint,
  'the row count reports the whole match, not the page'
);

-- 25-26. Tenant scope comes from the principal, not the argument.
SELECT throws_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003902', NULL)$$,
  '42501',
  NULL,
  'a caller cannot search another tenant by passing its id'
);
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003901', 'Tomas')),
  0::bigint,
  'a name that exists only in another tenant matches nothing here'
);

-- 27. A non-administrator of the same tenant is refused.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003913","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL)$$,
  '42501',
  NULL,
  'a resident cannot enumerate the tenant user list'
);

-- 28-29. The other tenant's administrator sees only their own tenant: the
--       identically named person in tenant B is invisible to tenant A, and
--       naming tenant A from tenant B is refused.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003912","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT count(*) FROM public.search_users('00000000-0000-0000-0000-000000003902', 'O''Brien')),
  1::bigint,
  'each tenant finds only its own O''Brien'
);
SELECT throws_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL)$$,
  '42501',
  NULL,
  'tenant B cannot read tenant A by naming tenant A'
);

-- 30. No anon context at all: there is no principal, so there is no search.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.search_users('00000000-0000-0000-0000-000000003901', NULL)$$,
  '42501',
  NULL,
  'an anonymous caller cannot execute the search at all'
);

ROLLBACK;
