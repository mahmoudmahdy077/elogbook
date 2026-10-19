BEGIN;
SELECT plan(18);

SELECT is_empty(
  $$
  SELECT required.role_name
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS required(role_name)
  WHERE to_regrole(required.role_name) IS NULL
  $$,
  'required Supabase roles exist for privilege inspection'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class AS class_record
    JOIN pg_namespace AS schema_record ON schema_record.oid = class_record.relnamespace
    WHERE schema_record.nspname = 'public'
      AND class_record.relkind IN ('r', 'p')
  ),
  'the public table inventory is non-empty'
);

SELECT is_empty(
  $$
  SELECT c.relname
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relrowsecurity = false
  $$,
  'every public table has row-level security enabled'
);

SELECT is_empty(
  $$
  SELECT c.relname
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relforcerowsecurity = false
  $$,
  'every public table has force row-level security enabled'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('authenticated', c.oid, 'TRUNCATE')
  $$,
  'authenticated has no effective TRUNCATE privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('authenticated', c.oid, 'REFERENCES')
  $$,
  'authenticated has no effective REFERENCES privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('authenticated', c.oid, 'TRIGGER')
  $$,
  'authenticated has no effective TRIGGER privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('anon', c.oid, 'TRUNCATE')
  $$,
  'anon has no effective TRUNCATE privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('anon', c.oid, 'REFERENCES')
  $$,
  'anon has no effective REFERENCES privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege('anon', c.oid, 'TRIGGER')
  $$,
  'anon has no effective TRIGGER privilege on any public table'
);

SELECT is_empty(
  $$
  SELECT c.oid::regclass::text
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS client(role_name)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND has_table_privilege(client.role_name::name, c.oid, 'SELECT')
    AND has_table_privilege(client.role_name::name, c.oid, 'INSERT')
    AND has_table_privilege(client.role_name::name, c.oid, 'UPDATE')
    AND has_table_privilege(client.role_name::name, c.oid, 'DELETE')
    AND has_table_privilege(client.role_name::name, c.oid, 'TRUNCATE')
    AND has_table_privilege(client.role_name::name, c.oid, 'REFERENCES')
    AND has_table_privilege(client.role_name::name, c.oid, 'TRIGGER')
  $$,
  'anon and authenticated have no effective table-level ALL grants'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc AS function_record
    JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
    WHERE schema_record.nspname = 'public'
      AND function_record.prosecdef
  ),
  'the public SECURITY DEFINER inventory is non-empty'
);

SELECT is_empty(
  $$
  SELECT function_record.oid::regprocedure::text
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
  CROSS JOIN LATERAL (
    SELECT COUNT(*)::int AS setting_count
    FROM unnest(COALESCE(function_record.proconfig, ARRAY[]::text[])) AS config_entry(config_value)
    WHERE config_entry.config_value LIKE 'search_path=%'
  ) AS search_path_config
  WHERE schema_record.nspname = 'public'
    AND function_record.prosecdef
    AND (
      search_path_config.setting_count <> 1
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(function_record.proconfig, ARRAY[]::text[])) AS config_entry(config_value)
        CROSS JOIN LATERAL regexp_split_to_array(
          substring(config_entry.config_value FROM '^search_path=(.*)$'),
          '\s*,\s*'
        ) AS configured_path(search_path)
        WHERE config_entry.config_value LIKE 'search_path=%'
          AND substring(config_entry.config_value FROM '^search_path=(.*)$') <> ''
          AND (
            configured_path.search_path[1] <> 'pg_catalog'
            OR configured_path.search_path[cardinality(configured_path.search_path)] <> 'pg_temp'
            OR EXISTS (
              SELECT 1
              FROM unnest(configured_path.search_path) AS path_entry(schema_name)
              WHERE path_entry.schema_name NOT IN ('pg_catalog', 'public', 'pg_temp')
            )
          )
      )
    )
  $$,
  'security-definer functions use an empty or pg_catalog-first, pg_temp-last search_path'
);

SELECT is_empty(
  $$
  WITH allowed_anon_definers(signature) AS (
    SELECT unnest(ARRAY[]::regprocedure[])
  )
  SELECT function_record.oid::regprocedure::text
  FROM pg_proc AS function_record
  JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
  WHERE schema_record.nspname = 'public'
    AND function_record.prosecdef
    AND (
      has_function_privilege('public', function_record.oid, 'EXECUTE')
      OR has_function_privilege('anon', function_record.oid, 'EXECUTE')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM allowed_anon_definers
      WHERE allowed_anon_definers.signature = function_record.oid::regprocedure
    )
  $$,
  'public SECURITY DEFINER functions have no effective PUBLIC or anon execute privilege outside the explicit allowlist'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc AS function_record
    JOIN pg_namespace AS schema_record ON schema_record.oid = function_record.pronamespace
    WHERE schema_record.nspname = 'public'
      AND function_record.proname = 'get_case_stats'
  ),
  1::int,
  'get_case_stats has exactly one public signature'
);

SELECT ok(
  to_regprocedure('public.get_case_stats(uuid,date,date)') IS NOT NULL,
  'get_case_stats exposes the tenant-derived signature'
);

SELECT is(
  has_function_privilege(
    'anon',
    to_regprocedure('public.get_case_stats(uuid,date,date)'),
    'EXECUTE'
  ),
  false,
  'anon cannot execute get_case_stats'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    to_regprocedure('public.get_case_stats(uuid,date,date)'),
    'EXECUTE'
  ),
  true,
  'authenticated can execute get_case_stats'
);

ROLLBACK;
