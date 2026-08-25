-- Drop swarm instrumentation from the tombstone investigation
DROP TRIGGER IF EXISTS trg_dbg_row ON public.case_entries;
DROP TRIGGER IF EXISTS trg_dbg_stmt ON public.case_entries;
DROP FUNCTION IF EXISTS public.dbg_cap_deleted();
DROP TABLE IF EXISTS public._swarm_debug_results;

-- Final consistency guard: ensure the four intended UPDATE policies exist
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
     AND policyname IN (
       'residents update own draft or rejected entries',
       'supervisor+ update pending tenant entries',
       'residents soft delete own entries',
       'supervisor+ soft delete tenant entries');
  IF n <> 4 THEN
    RAISE WARNING 'case_entries UPDATE policy set unexpected: % found', n;
  END IF;
END $$;
