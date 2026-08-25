-- TEMPORARY diagnostic (service_role only): dump live policy set + trigger fn
CREATE OR REPLACE FUNCTION public.debug_swarm_introspect()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE out JSONB;
BEGIN
  SELECT jsonb_build_object(
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', policyname,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check))
      FROM pg_policies WHERE schemaname='public' AND tablename='case_entries'), '[]'::jsonb),
    'write_once_fn', (SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='write_once_submitted_check' LIMIT 1),
    'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'fn',p.proname))
      FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relname='case_entries' AND NOT t.tgisinternal),'[]'::jsonb)
  ) INTO out;
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public.debug_swarm_introspect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_swarm_introspect() TO service_role;
