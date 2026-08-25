SELECT count(*) FILTER (WHERE tgenabled<>'O')::text AS disabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='case_entries' AND NOT t.tgisinternal;
