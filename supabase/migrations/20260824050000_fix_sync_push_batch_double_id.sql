-- ============================================================================
-- FIX: sync_push_batch generated "INSERT INTO t (id, id, ...)" — insert_cols
-- already began with 'id, ' and format() prepended another id. Every call
-- failed with 42701 (column "id" specified more than once), meaning the
-- mobile offline-sync push RPC has never worked.
--
-- Minimal fix (keeps original structure): stop double-prefixing id.
--   insert_cols := array_to_string(col_names, ', ')   -- was: 'id, ' || ...
-- VALUES already passes the row id as the first %L. No other behavior change:
-- tenant forcing, allowlist, upsert semantics all preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_push_batch(
  p_table_name text,
  p_rows jsonb
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_tables text[] := ARRAY[
    'case_entries', 'case_templates', 'program_goals', 'rotations',
    'milestones', 'evaluation_forms', 'comments', 'shifts'
  ];
  row_obj jsonb;
  affected int := 0;
  col_names text[];
  col_val text;
  insert_cols text;
  insert_vals text;
  update_clause text;
  sql_query text;
  row_count int;
  v_tenant_id UUID := get_tenant_id();
BEGIN
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  -- SECURITY: this function is SECURITY DEFINER and would otherwise let any
  -- authenticated caller write rows into ANY tenant. Force every row's
  -- tenant_id to the caller's own tenant before touching the table.

  -- Get column names from the table (excluding id which is always present)
  SELECT array_agg(column_name) INTO col_names
  FROM information_schema.columns
  WHERE table_name = p_table_name
    AND table_schema = 'public'
    AND column_name <> 'id';

  insert_cols := array_to_string(col_names, ', ');

  -- Build update clause for ON CONFLICT
  update_clause := '';
  FOREACH col_val IN ARRAY col_names LOOP
    IF update_clause <> '' THEN update_clause := update_clause || ', '; END IF;
    update_clause := update_clause || col_val || ' = EXCLUDED.' || col_val;
  END LOOP;

  -- Process each row in the batch
  FOR row_obj IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    -- Skip rows without id
    IF NOT (row_obj ? 'id') THEN CONTINUE; END IF;

    -- SECURITY: force tenant_id to the caller's tenant (ignore client value).
    IF NOT (row_obj ? 'tenant_id') THEN
      RAISE EXCEPTION 'row missing tenant_id';
    END IF;
    IF (row_obj ->> 'tenant_id')::UUID <> v_tenant_id THEN
      RAISE EXCEPTION 'cross-tenant sync rejected';
    END IF;

    insert_vals := '';
    FOREACH col_val IN ARRAY col_names LOOP
      IF row_obj ? col_val THEN
        col_val := quote_literal(row_obj ->> col_val);
      ELSE
        col_val := 'NULL';
      END IF;
      insert_vals := insert_vals || col_val;
    END LOOP;

    sql_query := format(
      'INSERT INTO %I (id, %s) VALUES (%L, %s)
       ON CONFLICT (id) DO UPDATE SET %s',
      p_table_name,
      insert_cols,
      row_obj ->> 'id',
      insert_vals,
      update_clause
    );

    EXECUTE sql_query;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    affected := affected + row_count;
  END LOOP;

  RETURN affected;
END;
$$;
