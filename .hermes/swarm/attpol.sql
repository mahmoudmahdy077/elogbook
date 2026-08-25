SELECT policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename='case_attachments' ORDER BY cmd;
