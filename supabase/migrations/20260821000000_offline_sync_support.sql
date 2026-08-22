-- Migration: Add offline sync support
-- Adds updated_at triggers where missing, soft-delete columns, and sync RPCs.
-- File: supabase/migrations/20260821000000_offline_sync_support.sql

-- ============================================================================
-- 1. Add missing updated_at triggers for incremental sync
-- ============================================================================

-- duty_periods: has updated_at column but no trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_duty_periods_updated_at') THEN
    CREATE TRIGGER set_duty_periods_updated_at
      BEFORE UPDATE ON duty_periods
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- shifts: add updated_at column + trigger (server shifts didn't have it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'updated_at') THEN
    ALTER TABLE shifts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    UPDATE shifts SET updated_at = created_at WHERE updated_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_shifts_updated_at') THEN
    CREATE TRIGGER set_shifts_updated_at
      BEFORE UPDATE ON shifts
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- faculty_evaluations: add updated_at column + trigger
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faculty_evaluations' AND column_name = 'updated_at') THEN
    ALTER TABLE faculty_evaluations ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    UPDATE faculty_evaluations SET updated_at = created_at WHERE updated_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_faculty_evals_updated_at') THEN
    CREATE TRIGGER set_faculty_evals_updated_at
      BEFORE UPDATE ON faculty_evaluations
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 2. Add soft-delete (deleted_at) to tables that only had hard deletes
-- ============================================================================

DO $$
BEGIN
  -- rotations
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rotations' AND column_name = 'deleted_at') THEN
    ALTER TABLE rotations ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  -- milestones
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'milestones' AND column_name = 'deleted_at') THEN
    ALTER TABLE milestones ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  -- evaluation_forms
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'evaluation_forms' AND column_name = 'deleted_at') THEN
    ALTER TABLE evaluation_forms ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  -- comments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'comments' AND column_name = 'deleted_at') THEN
    ALTER TABLE comments ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
  -- shifts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shifts' AND column_name = 'deleted_at') THEN
    ALTER TABLE shifts ADD COLUMN deleted_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================================
-- 3. Sync RPC — get changes since timestamp (per-table, tenant-scoped)
--    SECURITY DEFINER so it runs with elevated privileges and returns exactly
--    the rows the caller's tenant is allowed to see.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_pull_changes(
  p_table_name text,
  p_tenant_id uuid,
  p_since timestamptz DEFAULT '1970-01-01T00:00:00Z',
  p_limit int DEFAULT 500
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_tables text[] := ARRAY[
    'case_entries', 'case_templates', 'program_goals', 'rotations',
    'milestones', 'evaluation_forms', 'comments', 'shifts'
  ];
  sql_query text;
BEGIN
  -- Validate table name (prevents SQL injection)
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  -- Build dynamic query — returns all columns as jsonb
  sql_query := format(
    'SELECT to_jsonb(t.*) FROM %I t
     WHERE t.tenant_id = $1
       AND t.updated_at > $2
       AND (t.deleted_at IS NULL OR t.deleted_at > $2)
     ORDER BY t.updated_at ASC
     LIMIT $3',
    p_table_name
  );

  RETURN QUERY EXECUTE sql_query
    USING p_tenant_id, p_since, p_limit;
END;
$$;

-- ============================================================================
-- 4. Sync RPC — push batch (upsert with conflict handling)
--    Accepts a jsonb array of row objects, upserts by id.
--    Returns count of rows affected.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_push_batch(
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
BEGIN
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  -- Get column names from the table (excluding id which is always present)
  SELECT array_agg(column_name) INTO col_names
  FROM information_schema.columns
  WHERE table_name = p_table_name
    AND table_schema = 'public'
    AND column_name <> 'id';

  insert_cols := 'id, ' || array_to_string(col_names, ', ');
  insert_vals := '';

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

    insert_vals := '';
    FOREACH col_val IN ARRAY col_names LOOP
      IF insert_vals <> '' THEN insert_vals := insert_vals || ', '; END IF;
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

-- ============================================================================
-- 5. Add performance indexes for incremental sync queries
-- ============================================================================

DO $$
BEGIN
  -- Composite index for sync pull: tenant + updated_at
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_case_entries_sync') THEN
    CREATE INDEX idx_case_entries_sync ON case_entries (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_case_templates_sync') THEN
    CREATE INDEX idx_case_templates_sync ON case_templates (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_program_goals_sync') THEN
    CREATE INDEX idx_program_goals_sync ON program_goals (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rotations_sync') THEN
    CREATE INDEX idx_rotations_sync ON rotations (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_milestones_sync') THEN
    CREATE INDEX idx_milestones_sync ON milestones (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_eval_forms_sync') THEN
    CREATE INDEX idx_eval_forms_sync ON evaluation_forms (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_comments_sync') THEN
    CREATE INDEX idx_comments_sync ON comments (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_shifts_sync') THEN
    CREATE INDEX idx_shifts_sync ON shifts (tenant_id, updated_at DESC)
      WHERE deleted_at IS NULL;
  END IF;
END $$;

-- ============================================================================
-- 6. Grant execute on sync RPCs to authenticated role
-- ============================================================================
GRANT EXECUTE ON FUNCTION sync_pull_changes(text, uuid, timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_push_batch(text, jsonb) TO authenticated;
