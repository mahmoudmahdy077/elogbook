-- Supabase provisions `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
-- authenticated, service_role` by default. ALL includes TRUNCATE, REFERENCES
-- and TRIGGER, which no application role has any legitimate use for:
--
--   TRUNCATE    empties a table and needs no WHERE clause, so it is a
--               one-request data-destruction primitive on a clinical table.
--   REFERENCES   allows a foreign key to be created against the table, which
--               leaks row counts and can be used to probe existence.
--   TRIGGER      allows installing arbitrary PL/pgSQL, which executes with the
--               privileges of the invoking role's statement and is a direct
--               path to privilege escalation.
--
-- RLS governs SELECT, INSERT, UPDATE and DELETE, so revoking the other three
-- removes no access the application legitimately uses. p1_16 asserts that
-- neither anon nor authenticated has any effective privilege in this set.

DO $$
DECLARE
  r RECORD;
  n BIGINT := 0;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
    FROM pg_class AS c
    JOIN pg_namespace AS ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM PUBLIC, anon, authenticated',
      r.rel
    );
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'revoked TRUNCATE, REFERENCES and TRIGGER on % public table(s)', n;

  IF n = 0 THEN
    RAISE EXCEPTION 'no public tables found, so the privilege revocation was a no-op';
  END IF;
END;
$$;

-- Keep new tables from inheriting the same grants through default privileges.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;
