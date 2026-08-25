SELECT policyname FROM pg_policies
WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
ORDER BY policyname;
