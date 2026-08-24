-- ============================================================================
-- sync_push_batch v4: partial-row safe upsert (update-first).
--
-- v3 (live) builds INSERT with ALL table columns, filling absent JSON keys
-- with NULL, and ON CONFLICT DO UPDATE SET col = EXCLUDED.col for all of
-- them. Mobile sends PARTIAL rows (e.g. {id, tenant_id, deleted_at} for a
-- tombstone), so an update would NULL out status/resident_id/etc. It also
-- trips status-transition triggers with NEW.status = NULL.
--
-- v4 semantics:
--   1. UPDATE only the keys present in the row JSON (tenant_id pinned to the
--      caller's tenant). If it matched a row -> done.
--   2. Otherwise INSERT only the provided keys (table NOT NULLs enforced
--      normally; ON CONFLICT DO NOTHING guards the rare race).
--
-- Table-agnostic: works for every allowlisted sync table. Quota trigger only
-- fires on real inserts of genuinely new rows — unchanged behavior.
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
  key text;
  set_clause text;
  cols_sql text;
  vals_sql text;
  sql_query text;
  row_count int;
  v_tenant_id UUID := get_tenant_id();
BEGIN
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  FOR row_obj IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    IF NOT (row_obj ? 'id') THEN CONTINUE; END IF;

    -- SECURITY: force tenant_id to the caller's own tenant.
    IF NOT (row_obj ? 'tenant_id') THEN
      RAISE EXCEPTION 'row missing tenant_id';
    END IF;
    IF (row_obj ->> 'tenant_id')::UUID <> v_tenant_id THEN
      RAISE EXCEPTION 'cross-tenant sync rejected';
    END IF;

    -- 1) UPDATE path with exactly the provided keys.
    set_clause := '';
    FOR key IN SELECT jsonb_object_keys(row_obj) ORDER BY 1
    LOOP
      CONTINUE WHEN key IN ('id');
      IF set_clause <> '' THEN set_clause := set_clause || ', '; END IF;
      IF key = 'tenant_id' THEN
        set_clause := set_clause || format('tenant_id = %L::uuid', v_tenant_id);
      ELSE
        set_clause := set_clause || format('%I = %L', key, row_obj ->> key);
      END IF;
    END LOOP;

    IF set_clause <> '' THEN
      sql_query := format(
        'UPDATE %I SET %s WHERE id = %L',
        p_table_name, set_clause, row_obj ->> 'id'
      );
      EXECUTE sql_query;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      IF row_count > 0 THEN
        affected := affected + row_count;
        CONTINUE;
      END IF;
    END IF;

    -- 2) INSERT path for brand-new rows: only provided keys.
    cols_sql := '';
    vals_sql := '';
    FOR key IN SELECT jsonb_object_keys(row_obj) ORDER BY 1
    LOOP
      IF cols_sql <> '' THEN
        cols_sql := cols_sql || ', ';
        vals_sql := vals_sql || ', ';
      END IF;
      cols_sql := cols_sql || format('%I', key);
      IF key = 'tenant_id' THEN
        vals_sql := vals_sql || format('%L::uuid', v_tenant_id);
      ELSE
        vals_sql := vals_sql || format('%L', row_obj ->> key);
      END IF;
    END LOOP;

    sql_query := format(
      'INSERT INTO %I (%s) VALUES (%s) ON CONFLICT DO NOTHING',
      p_table_name, cols_sql, vals_sql
    );
    EXECUTE sql_query;
    GET DIAGNOSTICS row_count = ROW_COUNT;
    affected := affected + row_count;
  END LOOP;

  RETURN affected;
END;
$$;
