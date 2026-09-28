-- ============================================================================
-- 20260927000000_audit_write_authority.sql
--
-- Closes the insert-policy/trigger mismatch on audit_logs and the
-- default-deny gap on outbound vendor policy.
--
-- 1. WHY THE MISMATCH EXISTS
--    20260824110000_audit_logs_trigger_depth_install.sql left exactly one
--    audit_logs INSERT policy: `WITH CHECK (pg_trigger_depth() >= 1) TO
--    authenticated`. That correctly blocks client-forged audit rows, but it
--    also blocks every *required* audit write issued from a request-scoped
--    client (web export routes, the client PHI-reveal component, the mobile
--    flush queue), because a PostgREST insert runs at trigger depth 0. Those
--    writes fail with 42501 and the call sites ignore the result, so required
--    audit events were silently lost. SECURITY DEFINER writers
--    (public.audit_metadata_only(), public.relabel_case_mode(), the clinical
--    command RPCs) are unaffected, which is why the mismatch was invisible to
--    the database test suite.
--
-- 2. THE FIX
--    public.write_audit_event() is the single trusted path. It is SECURITY
--    DEFINER (so the insert is evaluated as the migration owner rather than
--    as `authenticated`), and it enforces, in the database:
--      * authentication — auth.uid() must resolve to an active profile
--      * AAL — the JWT must carry aal1 or aal2
--      * tenant authorization — p_tenant_id must equal the caller's own
--        active profile tenant, which must itself be active
--      * a valid UUID resource_id, or an explicit metadata-only resource type
--        (tenant / audit_trail / session / system / mobile_buffer) which is
--        attributed to the caller's tenant row
--      * metadata-only changes: PHI-bearing keys are refused, values are
--        restricted to scalars and primitive arrays, and the payload is capped
--    Every rejection raises a stable machine code so no caller ever has to
--    surface a Postgres error to a user.
--
--    The direct INSERT policy is deliberately left in place: forging audit rows
--    from a client JWT must stay impossible.
--
-- 3. FORWARD-ONLY PHI REDACTION
--    audit_case_entry() (00013) wrote the whole row minus two identifiers into
--    audit_logs.changes, which meant free-text field_values were persisted in
--    the audit trail. This migration removes those historical values in place.
--    It is forward-only and non-destructive: no audit row is deleted, and
--    action / resource_type / resource_id / user_id / created_at are never
--    touched, so the regulatory history of *who did what, when* is preserved.
--    Only the PHI-bearing payload keys are replaced with '[redacted]'.
--    The append-only guard (00051 trg_reject_audit_update) is lifted for the
--    duration of that single statement and re-asserted below; a missing guard
--    afterwards aborts the migration.
--
-- 4. VENDOR POLICY (default-deny)
--    tenant_webhooks gains payload_policy, constrained to the single approved
--    policy 'metadata_only'. A webhook row can therefore never be configured
--    to receive PHI, and the dispatcher treats any other/absent policy as
--    "fail closed / omit body".
--
-- requires a migration plan (forward-only): adds one function and one
-- constrained column; its only data change redacts PHI from audit_logs.changes.
-- See the header notes above.
--
-- Down/rollback: DROP FUNCTION public.write_audit_event(text,text,text,jsonb,uuid)
-- and DROP COLUMN public.tenant_webhooks.payload_policy. The redaction in (3)
-- is intentionally not reversible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trusted audit write path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_changes JSONB DEFAULT '{}'::JSONB,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile_tenant UUID;
  v_tenant_status TEXT;
  v_aal TEXT;
  v_resource_uuid UUID;
  v_id UUID;
  v_key TEXT;
  v_denied BOOLEAN := false;
  v_has_object BOOLEAN;
  v_has_array BOOLEAN;
  v_scalar_count INT := 0;
  v_max_length INT := 0;
  v_array_length INT := 0;
BEGIN
  -- Authentication: no JWT subject, no audit write.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'audit_write_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- AAL: the assurance level must be a real one. An unverified/absent claim is
  -- not silently treated as aal1.
  v_aal := COALESCE(auth.jwt() ->> 'aal', '');
  IF v_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION 'audit_write_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Active profile and active tenant, resolved server-side.
  SELECT p.tenant_id, t.status
    INTO v_profile_tenant, v_tenant_status
  FROM public.profiles p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.user_id = auth.uid()
    AND p.status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_write_forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'audit_write_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Tenant authorization: never trust a client-supplied tenant.
  IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM v_profile_tenant THEN
    RAISE EXCEPTION 'audit_write_forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- Token shape for action and resource type.
  IF p_action IS NULL OR p_action !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'audit_action_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_resource_type IS NULL OR p_resource_type !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'audit_resource_type_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- Resource identity: a valid UUID, or an explicit metadata-only type.
  IF p_resource_id IS NULL OR btrim(p_resource_id) = '' THEN
    IF p_resource_type NOT IN ('tenant', 'audit_trail', 'session', 'system', 'mobile_buffer') THEN
      RAISE EXCEPTION 'audit_resource_id_required' USING ERRCODE = 'P0001';
    END IF;
    v_resource_uuid := v_profile_tenant;
  ELSE
    IF p_resource_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'audit_resource_id_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_resource_uuid := p_resource_id::UUID;
  END IF;

  -- Changes: metadata only.
  IF p_changes IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'audit_changes_not_object' USING ERRCODE = 'P0001';
  END IF;

  IF p_changes::TEXT > 4096 THEN
    RAISE EXCEPTION 'audit_changes_too_large' USING ERRCODE = 'P0001';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF v_key !~ '^[a-z][a-z0-9_]{0,47}$' THEN
      RAISE EXCEPTION 'audit_changes_key_invalid' USING ERRCODE = 'P0001';
    END IF;
    IF v_key IN (
      'field_values', 'patient_mrn', 'patient_dob', 'patient_name', 'mrn', 'dob',
      'full_name', 'resident_name', 'reviewer_name', 'evaluator_name',
      'comment', 'comments', 'note', 'notes', 'free_text', 'row', 'new', 'old'
    ) THEN
      RAISE EXCEPTION 'audit_changes_phi_denied' USING ERRCODE = 'P0001';
    END IF;

    v_has_object := COALESCE(p_changes -> v_key) @? '$ ? (@type() == "object")';
    v_has_array := COALESCE(p_changes -> v_key) @? '$ ? (@type() == "array")';
    IF v_has_object THEN
      RAISE EXCEPTION 'audit_changes_nested' USING ERRCODE = 'P0001';
    END IF;
    IF v_has_array THEN
      v_array_length := jsonb_array_length(p_changes -> v_key);
      IF v_array_length > 32 THEN
        RAISE EXCEPTION 'audit_changes_value_invalid' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      v_scalar_count := v_scalar_count + 1;
      v_max_length := GREATEST(
        v_max_length,
        COALESCE(length(p_changes ->> v_key), 0)
      );
    END IF;
  END LOOP;

  IF v_max_length > 512 OR v_scalar_count > 64 THEN
    RAISE EXCEPTION 'audit_changes_value_invalid' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (v_profile_tenant, auth.uid(), p_action, p_resource_type, v_resource_uuid, p_changes)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, JSONB, UUID) IS
  'Trusted metadata-only audit write. Authenticated, AAL checked, tenant pinned to the caller''s own active profile/tenant, valid-UUID (or explicit metadata-only) resource id. Rejects PHI-bearing change payloads with a stable machine code.';

REVOKE ALL ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_audit_event(TEXT, TEXT, TEXT, JSONB, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Forward-only redaction of historical PHI in audit_logs.changes
--
-- The append-only guard must be lifted for exactly one statement. It is
-- re-asserted, and its absence aborts the migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_redacted BIGINT := 0;
BEGIN
  ALTER TABLE public.audit_logs DISABLE TRIGGER trg_reject_audit_update;

  UPDATE public.audit_logs a
     SET changes = a.redacted_changes
    FROM (
      SELECT id,
        (COALESCE(changes, '{}'::JSONB)
          - 'field_values' - 'comment' - 'comments' - 'note' - 'notes'
          - 'free_text' - 'patient_mrn' - 'patient_dob' - 'patient_name'
          - 'mrn' - 'dob' - 'full_name' - 'resident_name' - 'reviewer_name')
        || CASE WHEN changes ? 'field_values'
                THEN jsonb_build_object('field_values', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN changes ? 'comment'
                THEN jsonb_build_object('comment', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN changes ? 'comments'
                THEN jsonb_build_object('comments', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN changes ? 'note'
                THEN jsonb_build_object('note', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN changes ? 'notes'
                THEN jsonb_build_object('notes', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN changes ? 'free_text'
                THEN jsonb_build_object('free_text', '[redacted]') ELSE '{}'::JSONB END
        || CASE WHEN jsonb_typeof(changes -> 'new') = 'object'
                THEN jsonb_build_object(
                  'new', (changes -> 'new')
                    - 'field_values' - 'comment' - 'comments' - 'note' - 'notes'
                    - 'patient_mrn' - 'patient_dob' - 'patient_name' - 'mrn' - 'dob'
                    - 'full_name' - 'resident_name' - 'reviewer_name'
                    || CASE WHEN (changes -> 'new') ? 'field_values'
                           THEN jsonb_build_object('field_values', '[redacted]') ELSE '{}'::JSONB END)
                ELSE '{}'::JSONB END
        || CASE WHEN jsonb_typeof(changes -> 'deleted') = 'object'
                THEN jsonb_build_object(
                  'deleted', (changes -> 'deleted')
                    - 'field_values' - 'comment' - 'comments' - 'note' - 'notes'
                    - 'patient_mrn' - 'patient_dob' - 'patient_name' - 'mrn' - 'dob'
                    - 'full_name' - 'resident_name' - 'reviewer_name'
                    || CASE WHEN (changes -> 'deleted') ? 'field_values'
                           THEN jsonb_build_object('field_values', '[redacted]') ELSE '{}'::JSONB END)
                ELSE '{}'::JSONB END
        AS redacted_changes
      FROM public.audit_logs
      WHERE COALESCE(changes, '{}'::JSONB) ?| ARRAY[
              'field_values','comment','comments','note','notes','free_text',
              'patient_mrn','patient_dob','patient_name','mrn','dob','full_name',
              'resident_name','reviewer_name']
         OR (jsonb_typeof(changes -> 'new') = 'object' AND (changes -> 'new') ? 'field_values')
         OR (jsonb_typeof(changes -> 'deleted') = 'object' AND (changes -> 'deleted') ? 'field_values')
    ) redacted
   WHERE a.id = redacted.id;

  GET DIAGNOSTICS v_redacted = ROW_COUNT;

  ALTER TABLE public.audit_logs ENABLE TRIGGER trg_reject_audit_update;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.audit_logs'::regclass
      AND tgname = 'trg_reject_audit_update'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'append-only audit guard trg_reject_audit_update is missing after redaction';
  END IF;

  RAISE NOTICE 'audit_logs PHI redaction touched % row(s)', v_redacted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Outbound vendor policy (default-deny)
--
-- 'metadata_only' is the only approved payload policy. A webhook cannot be
-- configured to receive PHI, so the dispatcher fails closed on anything else.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_webhooks
  ADD COLUMN IF NOT EXISTS payload_policy TEXT NOT NULL DEFAULT 'metadata_only';

DO $$
BEGIN
  IF to_regclass('public.tenant_webhooks') IS NOT NULL THEN
    ALTER TABLE public.tenant_webhooks DROP CONSTRAINT IF EXISTS tenant_webhooks_payload_policy;
    ALTER TABLE public.tenant_webhooks
      ADD CONSTRAINT tenant_webhooks_payload_policy
      CHECK (payload_policy = 'metadata_only');
  END IF;
END;
$$;

COMMENT ON COLUMN public.tenant_webhooks.payload_policy IS
  'Approved outbound payload policy. Only ''metadata_only'' is permitted: vendor webhooks receive opaque event metadata, never PHI. Any other value is rejected by the dispatcher (fail closed).';
