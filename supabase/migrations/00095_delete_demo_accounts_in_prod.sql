-- supabase/migrations/00095_delete_demo_accounts_in_prod.sql
-- SEC-001: The gate in 00055 was inert (NULL = 'false' is NULL, so the
-- ELSE branch ran). This migration actually deletes the demo accounts,
-- their profiles, and the demo tenant when the GUC is unset or 'false'.
-- Idempotent.

DO $$
DECLARE
  v_demo_user_ids UUID[];
  v_demo_tenant_id UUID;
  v_setting TEXT;
BEGIN
  v_setting := current_setting('app.enable_demo_migrations', true);
  IF v_setting IS NULL OR v_setting = 'false' THEN
    RAISE NOTICE 'SEC-001: demo migrations are off — deleting demo accounts';

    SELECT array_agg(id) INTO v_demo_user_ids
    FROM auth.users
    WHERE email LIKE '%@demo.com';

    SELECT id INTO v_demo_tenant_id
    FROM tenants
    WHERE slug = 'demo';

    IF v_demo_tenant_id IS NOT NULL THEN
      DELETE FROM one_time_purchases WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM stripe_events WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM profiles WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM case_entries WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM approval_requests WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM tenants WHERE id = v_demo_tenant_id;
    END IF;

    IF v_demo_user_ids IS NOT NULL THEN
      DELETE FROM audit_logs WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM profiles WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.identities WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.users WHERE id = ANY(v_demo_user_ids);
    END IF;

    RAISE NOTICE 'SEC-001: deleted % demo users', coalesce(array_length(v_demo_user_ids, 1), 0);
  ELSE
    RAISE NOTICE 'SEC-001: demo migrations enabled — keeping demo accounts';
  END IF;
END $$;
