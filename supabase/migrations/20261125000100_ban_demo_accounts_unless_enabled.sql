-- ============================================================================
-- 20261125000100_ban_demo_accounts_unless_enabled.sql
--
-- SEC-004: `00006_demo_accounts.sql` seeds five accounts with the password
-- published in README.md (`password123!`), including `platform@demo.com`,
-- whose `app_metadata.user_role = 'admin'` satisfies the `get_user_role() =
-- 'admin'` branch of 19 RLS policies — i.e. cross-tenant read/write.
--
-- `00095_delete_demo_accounts_in_prod.sql` was supposed to remove them when
-- `app.enable_demo_migrations` is not 'true', but the linked project still
-- had all five active on 2026-11-25. Deleting them now would also delete the
-- demo tenant's 400+ cases, so this migration disables sign-in instead:
-- reversible, no data removed.
--
-- destructive: no — this UPDATE only sets `banned_until`; no row is deleted.
-- To re-enable the demo accounts intentionally (local demo installs), set
-- `app.enable_demo_migrations = 'true'` and clear `banned_until` for those
-- rows, and change their passwords away from the published one.
-- ============================================================================

DO $$
DECLARE
  v_setting TEXT := current_setting('app.enable_demo_migrations', true);
BEGIN
  IF coalesce(v_setting, 'false') = 'true' THEN
    RAISE NOTICE 'demo mode enabled — demo accounts left untouched';
  ELSE
    UPDATE auth.users
       SET banned_until = '9999-12-31T00:00:00Z',
           updated_at = now()
     WHERE email LIKE '%@demo.com'
       AND (banned_until IS NULL OR banned_until < now());
    RAISE NOTICE 'demo accounts disabled (% rows updated)', (SELECT count(*) FROM auth.users WHERE email LIKE '%@demo.com' AND banned_until > now());
  END IF;
END $$;
