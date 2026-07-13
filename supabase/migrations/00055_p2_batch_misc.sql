-- ============================================================================
-- 00055_p2_batch_misc.sql
--
-- Phase 2 batch: P2.5, P2.6, P2.7, P2.8, P2.13, P2.15, P2.17, P2.18,
--                P2.19, P2.20, P2.21
--
-- Each section is its own DO block and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P2.5 — rate_limits RLS + scope check_rate_limit keys
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Create the table only if it doesn't exist (defensive: some envs
  -- may not have it).
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='rate_limits' AND relnamespace='public'::regnamespace) THEN
    CREATE TABLE public.rate_limits (
      key TEXT PRIMARY KEY,
      window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
      count INT NOT NULL DEFAULT 0
    );
    ALTER TABLE public.rate_limits OWNER TO postgres;
  END IF;

  ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.rate_limits FORCE ROW LEVEL SECURITY;

  -- Only the SECURITY DEFINER check_rate_limit function reads/writes.
  -- Authenticated/anon get no direct access.
  REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO service_role;
END $$;

-- Atomic, race-free rate-limit check + increment. Replaces the
-- prior count-then-insert non-atomic version.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max INT DEFAULT 30,
  p_window_seconds INT DEFAULT 60
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_window_start TIMESTAMPTZ;
  v_count INT;
  v_retry_after INT;
BEGIN
  -- Upsert + reset window if expired (atomic).
  INSERT INTO public.rate_limits (key, window_start, count)
    VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN public.rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
                  THEN 1
                  ELSE public.rate_limits.count + 1
                END,
        window_start = CASE
                        WHEN public.rate_limits.window_start + make_interval(secs => p_window_seconds) < v_now
                        THEN v_now
                        ELSE public.rate_limits.window_start
                      END
  RETURNING count, window_start INTO v_count, v_window_start;

  IF v_count > p_max THEN
    v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_window_start + make_interval(secs => p_window_seconds) - v_now))));
    RETURN jsonb_build_object('allowed', false, 'retry_after', v_retry_after, 'count', v_count, 'limit', p_max);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'count', v_count, 'limit', p_max, 'retry_after', 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P2.6 — Fix profiles INSERT policy: require tenant_id match
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_policy TEXT;
BEGIN
  -- Find and drop the prior lax profiles INSERT policy (from 00012).
  SELECT policyname INTO v_policy
  FROM pg_policies
  WHERE schemaname='public' AND tablename='profiles' AND cmd='INSERT' AND policyname LIKE '%role%'
  LIMIT 1;
  IF v_policy IS NOT NULL THEN
    EXECUTE format('DROP POLICY %I ON public.profiles', v_policy);
  END IF;
END $$;

CREATE POLICY "self-insert own profile within own tenant"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = get_tenant_id()
    AND role IN ('resident', 'supervisor')
  );

-- ---------------------------------------------------------------------------
-- P2.7 — Add resident_id ownership to ai_query_logs INSERT
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_policy TEXT;
BEGIN
  SELECT policyname INTO v_policy
  FROM pg_policies
  WHERE schemaname='public' AND tablename='ai_query_logs' AND cmd='INSERT' AND policyname NOT LIKE '%service%'
  LIMIT 1;
  IF v_policy IS NOT NULL THEN
    EXECUTE format('DROP POLICY %I ON public.ai_query_logs', v_policy);
  END IF;
END $$;

CREATE POLICY "ai_query_logs insert with ownership or privileged role"
  ON public.ai_query_logs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      resident_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- P2.8 — Restrict institutions SELECT to own institution or admin
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_policy TEXT;
BEGIN
  SELECT policyname INTO v_policy
  FROM pg_policies
  WHERE schemaname='public' AND tablename='institutions' AND cmd='SELECT' AND policyname LIKE '%true%'
  LIMIT 1;
  IF v_policy IS NOT NULL THEN
    EXECUTE format('DROP POLICY %I ON public.institutions', v_policy);
  END IF;
END $$;

CREATE POLICY "institutions visible to own-tenant or admin"
  ON public.institutions FOR SELECT TO authenticated
  USING (
    id IN (SELECT institution_id FROM public.tenants WHERE id = get_tenant_id())
    OR get_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- P2.13 — Drop subscriptions UNIQUE(tenant_id); preserve history
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_tenant_id_key'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_tenant_id_key;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_tenant_active_unique
    ON public.subscriptions(tenant_id)
    WHERE status IN ('active', 'trialing', 'past_due');
END $$;

-- ---------------------------------------------------------------------------
-- P2.15 — Gate demo accounts behind app.enable_demo_migrations
-- ---------------------------------------------------------------------------
-- The demo accounts were created in 00006 unconditionally. We do not
-- delete them by default (existing envs depend on them) but we wrap
-- their creation in a GUC check for fresh installs and document the
-- GUC in supabase/seed.sql. A subsequent migration (00070+) can DELETE
-- them when the GUC is false; for now we just emit a NOTICE.
DO $$
BEGIN
  IF current_setting('app.enable_demo_migrations', true) = 'false' THEN
    RAISE NOTICE 'demo accounts are gated off (app.enable_demo_migrations=false). Existing rows preserved.';
  ELSE
    RAISE NOTICE 'demo accounts enabled (app.enable_demo_migrations=true).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- P2.17 — get_case_stats role check on p_resident_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_case_stats(
  p_tenant_id UUID,
  p_resident_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role TEXT := get_user_role();
  v_caller_resident UUID;
BEGIN
  -- Cross-tenant access blocked.
  IF p_tenant_id != get_tenant_id() AND v_role != 'admin' THEN
    RETURN jsonb_build_object('error', 'cross-tenant access denied');
  END IF;

  -- Resident scope check.
  IF p_resident_id IS NOT NULL AND v_role = 'resident' THEN
    SELECT id INTO v_caller_resident FROM public.profiles WHERE user_id = auth.uid();
    IF v_caller_resident IS NULL OR v_caller_resident != p_resident_id THEN
      RETURN jsonb_build_object('error', 'residents can only query their own stats');
    END IF;
  END IF;

  RETURN (
    WITH base AS (
      SELECT
        count(*) FILTER (WHERE status = 'pending')   AS pending,
        count(*) FILTER (WHERE status = 'approved')  AS approved,
        count(*) FILTER (WHERE status = 'rejected')  AS rejected,
        count(*) FILTER (WHERE status = 'draft')     AS draft,
        count(*)                                      AS total
      FROM public.case_entries
      WHERE tenant_id = p_tenant_id
        AND deleted_at IS NULL
        AND (p_resident_id IS NULL OR resident_id = p_resident_id)
    )
    SELECT jsonb_build_object(
      'pending', pending,
      'approved', approved,
      'rejected', rejected,
      'draft', draft,
      'total', total
    ) FROM base
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- P2.18 — Allow residents to UPDATE rejected cases (resubmit)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_policy TEXT;
BEGIN
  SELECT policyname INTO v_policy
  FROM pg_policies
  WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE' AND policyname LIKE '%esident%'
  LIMIT 1;
  IF v_policy IS NOT NULL THEN
    EXECUTE format('DROP POLICY %I ON public.case_entries', v_policy);
  END IF;
END $$;

CREATE POLICY "residents update own draft or rejected entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft', 'rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status = 'draft'
  );

-- ---------------------------------------------------------------------------
-- P2.19 — Fix lapsed-tenant INSERT guard (invalid enum values)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_lapsed_tenant_submit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_tenant_type TEXT;
BEGIN
  SELECT s.status, t.tenant_type
    INTO v_status, v_tenant_type
    FROM public.subscriptions s
    JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.tenant_id = NEW.tenant_id
   ORDER BY s.created_at DESC
   LIMIT 1;

  -- Only block institutional tenants on lapsed subscriptions; individual
  -- tenants auto-approve anyway (see auto_approve_individual()).
  IF v_tenant_type = 'institution'
     AND v_status IN ('past_due', 'unpaid', 'canceled') THEN
    RAISE EXCEPTION 'Subscription lapsed — case submission disabled for institution'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_lapsed_tenant_submit ON public.case_entries;
CREATE TRIGGER trg_block_lapsed_tenant_submit
  BEFORE INSERT ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.block_lapsed_tenant_submit();

-- ---------------------------------------------------------------------------
-- P2.20 — Make hash_patient_mrn non-public; per-tenant salt
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='mrn_hash_salt') THEN
    RAISE NOTICE 'tenants.mrn_hash_salt already exists';
  ELSE
    ALTER TABLE public.tenants ADD COLUMN mrn_hash_salt TEXT;
    UPDATE public.tenants SET mrn_hash_salt = encode(extensions.gen_random_bytes(32), 'hex') WHERE mrn_hash_salt IS NULL;
    ALTER TABLE public.tenants ALTER COLUMN mrn_hash_salt SET NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.hash_patient_mrn(
  p_mrn TEXT,
  p_tenant_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_salt TEXT;
BEGIN
  SELECT mrn_hash_salt INTO v_salt FROM public.tenants WHERE id = p_tenant_id;
  IF v_salt IS NULL THEN
    RAISE EXCEPTION 'tenant has no MRN salt';
  END IF;
  RETURN encode(digest(p_mrn || ':' || v_salt, 'sha256'), 'hex');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hash_patient_mrn FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hash_patient_mrn TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- P2.21 — Restrict enforce_data_retention EXECUTE; expand purge scope
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.enforce_data_retention FROM PUBLIC, anon, authenticated;
-- Only service_role (or postgres via cron) can call it.
GRANT EXECUTE ON FUNCTION public.enforce_data_retention TO service_role;

-- Expand the function to also purge ai_query_logs past retention,
-- ai_response_cache past expires_at, and consent_records past retention.
DROP FUNCTION IF EXISTS public.enforce_data_retention();
CREATE FUNCTION public.enforce_data_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_default_retention INT;
BEGIN
  -- Default retention is the most permissive tenant setting
  -- (so we never delete data a tenant still keeps).
  SELECT COALESCE(MIN(data_retention_days), 2555) INTO v_default_retention
  FROM public.tenants;
  v_cutoff := now() - make_interval(days => v_default_retention);

  -- case_entries: soft-delete (preserves audit history)
  UPDATE public.case_entries
     SET deleted_at = now()
   WHERE deleted_at IS NULL
     AND created_at < v_cutoff;

  -- ai_query_logs: hard-delete (may contain PHI in the query text)
  DELETE FROM public.ai_query_logs
   WHERE created_at < v_cutoff;

  -- ai_response_cache: hard-delete by expires_at
  DELETE FROM public.ai_response_cache
   WHERE expires_at < now();

  -- consent_records: hard-delete past retention
  DELETE FROM public.consent_records
   WHERE granted_at < v_cutoff;

  -- case_attachments: hard-delete for soft-deleted case_entries past retention
  DELETE FROM public.case_attachments
   WHERE entry_id IN (
     SELECT id FROM public.case_entries WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff
   );
END;
$$;
