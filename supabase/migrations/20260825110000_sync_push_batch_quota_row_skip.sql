-- ============================================================================
-- 20260825110000_sync_push_batch_quota_row_skip.sql
--
-- Swarm Wave-1 performance finding F6: sync_push_batch is atomic per batch.
-- When a free-plan tenant nears the 20-case cap, an offline catch-up push
-- containing more new-case inserts than remaining headroom raised
-- 'Free plan limit reached' and failed the ENTIRE batch - mobile users near
-- the cap could not sync anything until manual cleanup.
--
-- Fix: tolerate ONLY that specific quota error on a per-row basis. The
-- overflowing row is skipped, remaining rows still sync, and callers detect
-- the shortfall by comparing the returned affected count against the batch
-- size (mobile offline queue already retries unsynced rows).
-- All other errors (CHECK violations, NOT NULL, malformed payloads) keep
-- failing loudly as before - no silent data-loss masking.
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
      BEGIN
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
      EXCEPTION
        WHEN OTHERS THEN
          -- Quota trigger fires here for upsert-style re-inserts of rows that
          -- vanished mid-sync; skip just this row on plan-cap errors.
          IF SQLERRM LIKE 'Free plan limit reached%' THEN
            CONTINUE;
          END IF;
          RAISE;
      END;
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

    BEGIN
      sql_query := format(
        'INSERT INTO %I (%s) VALUES (%s) ON CONFLICT DO NOTHING',
        p_table_name, cols_sql, vals_sql
      );
      EXECUTE sql_query;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      affected := affected + row_count;
    EXCEPTION
      WHEN OTHERS THEN
        -- Free-plan cap: skip the overflowing row so one insert cannot wedge
        -- the whole offline batch. Caller sees affected < batch size.
        IF SQLERRM LIKE 'Free plan limit reached%' THEN
          CONTINUE;
        END IF;
        RAISE;
    END;
  END LOOP;

  RETURN affected;
END;
$$;
