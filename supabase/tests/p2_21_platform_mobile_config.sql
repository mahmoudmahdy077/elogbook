-- p2_21 — platform_mobile_config is readable by authenticated users and
-- writable only through the service-role platform API.
BEGIN;
SELECT plan(3);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000002a1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000002b1","user_role":"resident"}}';

SELECT is(
  (SELECT count(*) FROM public.platform_mobile_config),
  1::bigint,
  'authenticated users can read the global mobile config'
);

-- Default privileges grant the statement; RLS (no write policy) filters every
-- row, so the value/count must stay unchanged rather than raising.
UPDATE public.platform_mobile_config SET maintenance_mode = true WHERE id = TRUE;
SELECT is(
  (SELECT maintenance_mode FROM public.platform_mobile_config WHERE id = TRUE),
  false,
  'authenticated users cannot change the global config'
);

DELETE FROM public.platform_mobile_config WHERE id = TRUE;
SELECT is(
  (SELECT count(*) FROM public.platform_mobile_config),
  1::bigint,
  'authenticated users cannot delete the global config'
);

ROLLBACK;
