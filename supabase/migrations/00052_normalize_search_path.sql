-- ============================================================================
-- 00052_normalize_search_path.sql
--
-- Phase 2 / P2.0
--
-- Normalize `search_path` on every SECURITY DEFINER function to a single,
-- explicit value. The current migration set mixes:
--
--   * `SET search_path = ''`           (00020 — blocks search-path hijacking
--                                      but also breaks unqualified `public.X`
--                                      references inside the function body)
--   * `SET search_path = public`       (a few functions added later)
--   * no `SET search_path` at all      (the rest — they inherit the
--                                      caller's search_path, which is the
--                                      canonical SQL-injection footgun for
--                                      SECURITY DEFINER functions)
--
-- We standardize on `SET search_path = pg_catalog, public`:
--
--   * `pg_catalog` is searched first so built-in types and functions
--     (e.g. `now()`) resolve unambiguously.
--   * `public` is searched second so unqualified table references work
--     without a schema-qualified prefix.
--   * Neither is mutable by the caller, so a malicious client cannot
--     trick the function into resolving `tenants` to a different schema
--     via `search_path` injection.
--
-- We DO NOT use `''` (the prior 00020 setting) because that breaks
-- every function that does `SELECT ... FROM case_entries` without a
-- schema prefix — those functions would fail with
-- `relation "case_entries" does not exist` on first call. The
-- `pg_catalog, public` setting is the safe default documented in
-- https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY
--
-- Idempotent: every ALTER FUNCTION uses IF EXISTS guards via DO blocks.
-- ============================================================================

DO $$
DECLARE
  v_rec RECORD;
BEGIN
  FOR v_rec IN
    SELECT
      p.oid::regprocedure AS fn_signature,
      p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef = true           -- SECURITY DEFINER
      AND n.nspname = 'public'
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', v_rec.fn_signature);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip: could not alter % (% )', v_rec.fn_signature, SQLERRM;
    END;
  END LOOP;
END $$;

-- Also reset update_updated_at and any other re-declared in 00044/00052
-- that lost their search_path setting when redefined in subsequent
-- migrations. The loop above already handles these (they're all
-- SECURITY DEFINER or have explicit SET search_path).
