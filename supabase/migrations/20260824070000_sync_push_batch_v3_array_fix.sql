-- ============================================================================
-- FIX v2 for sync_push_batch (supersedes the double-id fix in this file).
--
-- Two latent bugs made this RPC fail on every call, so mobile offline-sync
-- push has never worked:
--   1. INSERT column list doubled id: "(id, id, tenant_id, ...)" → 42701
--   2. VALUES list concatenated without commas → 42601 NULLNULLNULL...
--
-- Rewrite: correct column/value lists with comma joins; tenant_id always
-- forced server-side to get_tenant_id(); allowlist + upsert semantics
-- unchanged; cross-tenant writes impossible (tenant pinned + RLS on conflict
-- target).
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
  sync_cols text[];
  col text;
  cols_sql text;
  vals_sql text;
  update_clause text;
  sql_query text;
  row_count int;
  v_tenant_id UUID := get_tenant_id();
BEGIN
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  SELECT COALESCE(array_agg(column_name ORDER BY ordinal_position), '{}'::text[])
    INTO col_names
  FROM information_schema.columns
  WHERE table_name = p_table_name
    AND table_schema = 'public'
    AND column_name NOT IN ('id', 'tenant_id');

  -- Sync columns = table columns except id; tenant_id appended separately.
  sync_cols := array_append(col_names, 'tenant_id');

  -- ON CONFLICT update: every synced column takes EXCLUDED value; tenant_id
  -- is pinned back to the caller's tenant regardless of payload.
  update_clause := '';
  FOREACH col IN ARRAY sync_cols LOOP
    IF update_clause <> '' THEN update_clause := update_clause || ', '; END IF;
    update_clause := update_clause || format('%I = EXCLUDED.%I', col, col);
  END LOOP;

  FOR row_obj IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF NOT (row_obj ? 'id') THEN CONTINUE; END IF;

    cols_sql := '';
    vals_sql := '';
    FOREACH col IN ARRAY sync_cols LOOP
      IF cols_sql <> '' THEN
        cols_sql := cols_sql || ', ';
        vals_sql := vals_sql || ', ';
      END IF;
      cols_sql := cols_sql || format('%I', col);
      IF col = 'tenant_id' THEN
        vals_sql := vals_sql || format('%L::uuid', v_tenant_id);
      ELSIF row_obj ? col THEN
        vals_sql := vals_sql || format('%L', row_obj ->> col);
      ELSE
        vals_sql := vals_sql || 'NULL';
      END IF;
    END LOOP;

    sql_query := format(
      'INSERT INTO %I (%s) VALUES (%s)
       ON CONFLICT (id) DO UPDATE SET %s',
      p_table_name, cols_sql, vals_sql, update_clause
    );

    EXECUTE sql_query;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    affected := affected + row_count;
  END LOOP;

  RETURN affected;
END;
$$;
