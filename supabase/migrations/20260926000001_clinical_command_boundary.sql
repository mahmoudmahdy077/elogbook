-- ============================================================================
-- 20260926000001_clinical_command_boundary.sql
--
-- Clinical approval/command boundary remediation
-- (docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md,
--  sections 4, 5.2, 6.1, 6.2, 6.3).
--
-- Root cause this migration closes
-- ------------------------------
-- AAL2 was enforced only on the approve_case/reject_case *function* entry
-- points (20260923000011). The actual write path for a clinical status change
-- is the state machine plus the row policies, and neither carried an AAL2 or
-- command requirement:
--
--   * 20260907000007 re-asserted "supervisor+ update pending tenant entries",
--     letting any supervisor/director/institution_admin session -- including a
--     plain AAL1 one -- PATCH case_entries straight to approved/rejected and
--     bypass the command entirely.
--   * the same file re-asserted "supervisor+ soft delete tenant entries" and
--     "residents soft delete own entries", so an approved clinical record
--     could be tombstoned directly.
--   * 00028 re-asserted "Supervisor+ update approval requests" and "Residents
--     create approval requests", so the approval ledger itself was writable
--     outside the command.
--   * the resident edit policy had WITH CHECK status IN ('draft','pending'),
--     so a resident could take rejected -> pending with no approval request.
--
-- Result: AAL2 was advisory, not authoritative.
--
-- What this migration does
-- ------------------------
-- 1. clinical_command_log      -- per-tenant/actor/command/request idempotency.
-- 2. submit_case_command       -- the only path into `pending`. Idempotent,
--                                 owner-scoped, and fails closed when the tenant
--                                 has no eligible reviewer.
-- 3. decide_case_command       -- the only path out of `pending`. Requires a
--                                 live AAL2 privileged principal, validates the
--                                 approval request, and writes status, audit
--                                 and outbox rows in the same transaction.
-- 4. enforce_case_status_transition / write_once_submitted_check
--                              -- AAL2 guard on privileged transitions and a
--                                 direct-write guard on approved-record
--                                 tombstones.
-- 5. enforce_case_insert_status -- AAL2 for pre-approved/rejected inserts.
-- 6. Policies                   -- direct privileged writes removed; resident
--                                 draft/rejected content edits kept; direct
--                                 status transitions and approved-record
--                                 tombstones removed.
--
-- Two boundaries are preserved deliberately:
--   * SECURITY DEFINER command RPCs (submit_case_operation, soft_delete_case,
--     retention jobs) still run as their owner, so `current_user` is not
--     `authenticated`. The direct-write tombstone guard keys on exactly that
--     distinction and leaves every command path intact.
--   * A principal with no authenticated identity (auth.uid() IS NULL --
--     migration replay, table owner, maintenance jobs) is governed by its own
--     checks, not by a request JWT, so the AAL2 guard does not apply to it.
--
-- Correction, converged forward in 20260930000001 and noted here so this file is
-- not read as the final definition: the direct-write tombstone guard below
-- cannot work as written. write_once_submitted_check is SECURITY DEFINER, so
-- inside it `current_user` is the function owner and never 'authenticated';
-- the approved-tombstone check could not fire on any path, including the two
-- SECURITY DEFINER RPCs this comment says it leaves intact. 20260930000001
-- replaces the body with a reachable one keyed on auth.uid() and removes the
-- privileged pre-approved INSERT branch that could create an approved record
-- with no approval ledger. The rules below are unchanged; the enforcement is
-- what was wrong.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Idempotency ledger for clinical commands.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clinical_command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  row_id UUID,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clinical_command_log_identity UNIQUE (tenant_id, actor_profile_id, command, request_id)
);

CREATE INDEX IF NOT EXISTS idx_clinical_command_log_created
  ON public.clinical_command_log (created_at);

ALTER TABLE public.clinical_command_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_command_log FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.clinical_command_log IS
  'Per-tenant/actor/command/request idempotency ledger for clinical commands. No policies: only the SECURITY DEFINER command RPCs and service_role reach it.';

-- ---------------------------------------------------------------------------
-- 2. Shared privileged-transition guard.
--
-- Authoritative AAL2 at the state machine, not just at the RPC wrapper. Any
-- authenticated principal that reaches case_entries outside a command still
-- has to present a live aal2 claim and a privileged role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clinical_transition_authorized(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- No authenticated identity: migration replay, the table owner and
  -- maintenance jobs are governed by their own checks, not a request JWT.
  IF auth.uid() IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    p_tenant_id,
    TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clinical_transition_authorized(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinical_transition_authorized(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Status state machine: AAL2 on the privileged half of the transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_case_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE OLD.status
      WHEN 'draft' THEN
        IF NEW.status NOT IN ('draft', 'pending') THEN
          RAISE EXCEPTION 'Invalid status transition: draft -> %. Allowed: draft, pending', NEW.status;
        END IF;
      WHEN 'pending' THEN
        IF NEW.status NOT IN ('approved', 'rejected') THEN
          RAISE EXCEPTION 'Invalid status transition: pending -> %. Allowed: approved, rejected', NEW.status;
        END IF;
        IF NOT public.clinical_transition_authorized(NEW.tenant_id) THEN
          RAISE EXCEPTION 'Clinical approval requires a privileged principal at AAL2 through the clinical command'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
      WHEN 'approved' THEN
        RAISE EXCEPTION 'Invalid status transition: approved is immutable. No transitions allowed.';
      WHEN 'rejected' THEN
        IF NEW.status != 'draft' THEN
          RAISE EXCEPTION 'Invalid status transition: rejected -> %. Allowed: draft', NEW.status;
        END IF;
      ELSE
        RAISE EXCEPTION 'Unknown status: %', OLD.status;
    END CASE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

COMMENT ON FUNCTION public.enforce_case_status_transition() IS
  'Case status state machine. pending -> approved/rejected additionally requires a live AAL2 privileged principal.';

-- ---------------------------------------------------------------------------
-- 4. Write-once guard: no direct tombstone of an approved clinical record.
--
-- current_user = 'authenticated' is precisely "this statement executed as the
-- caller's own role", i.e. a direct REST/RPC write. SECURITY DEFINER command
-- RPCs and the table owner are outside that condition and stay unaffected.
--
-- Superseded: this body is unreachable. write_once_submitted_check is SECURITY
-- DEFINER, so `current_user` inside it is the function owner and the comparison
-- is never true, which is how a resident reached an approved record through
-- submit_case_operation('delete') and a privileged principal through
-- soft_delete_case. 20260930000001 re-issues the body keyed on auth.uid(), which
-- SECURITY DEFINER does not change. Read that file for the final definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.get_user_role();

  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.field_values IS DISTINCT FROM OLD.field_values
       OR NEW.accreditation_mappings IS DISTINCT FROM OLD.accreditation_mappings
       OR NEW.patient_mrn IS DISTINCT FROM OLD.patient_mrn
       OR NEW.patient_dob IS DISTINCT FROM OLD.patient_dob
       OR NEW.patient_age_years IS DISTINCT FROM OLD.patient_age_years
       OR NEW.patient_hash IS DISTINCT FROM OLD.patient_hash
       OR NEW.case_date IS DISTINCT FROM OLD.case_date
       OR NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.is_deidentified IS DISTINCT FROM OLD.is_deidentified THEN
      RAISE EXCEPTION 'Soft-delete must not alter case content'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF OLD.status = 'approved'
       AND current_user = 'authenticated'
       AND NOT public.clinical_transition_authorized(OLD.tenant_id) THEN
      RAISE EXCEPTION 'Approved clinical records cannot be soft-deleted by a direct write'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
  END IF;

  IF v_role = 'resident' THEN
    IF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
      RETURN NEW;
    END IF;

    IF OLD.status != 'draft' THEN
      RAISE EXCEPTION 'Cannot modify case entry once submitted (status: %). Only rejected cases can be edited for resubmission.', OLD.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ---------------------------------------------------------------------------
-- 5. Insert-side guard: AAL2 for pre-approved/rejected case inserts.
--
-- Superseded in part: the privileged branch below let a supervisor at AAL2
-- INSERT a case already `approved`, with no approval request and therefore no
-- approval ledger. 20260930000001 removes that branch: an authenticated
-- principal may only create a draft, so reaching `approved` means
-- decide_case_command resolved an approval request. Individual tenants keep
-- their documented server-side auto-approval.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_case_insert_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = NEW.tenant_id
      AND tenant_type = 'individual'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('approved', 'rejected', 'acknowledged') THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.clinical_transition_authorized(NEW.tenant_id) THEN
      RAISE EXCEPTION 'SEC-002: pre-approved or rejected case inserts require a privileged principal at AAL2'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('pending', 'draft') THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_case_insert_status() IS
  'SEC-002: residents cannot self-approve via INSERT; privileged pre-approved inserts require a live AAL2 principal.';

-- ---------------------------------------------------------------------------
-- 6. Policies.
--
-- Removed:
--   "Supervisor can approve/reject entries in tenant"
--     -- the ORIGINAL direct-approval policy from 00002. No later migration
--        ever dropped it, so it survived every "convergence" pass and stayed
--        the live bypass: any supervisor/director/institution_admin session,
--        at any AAL, could PATCH a pending case straight to approved.
--   "supervisor+ update pending tenant entries"  -- direct privileged transition
--   "supervisor+ soft delete tenant entries"     -- direct privileged tombstone
--   "Supervisor+ update approval requests"       -- approval ledger outside command
--   "Residents create approval requests"         -- self-authored approval rows
--
-- Residents keep a content-edit path for their own draft/rejected rows, but
-- WITH CHECK pins the row to draft/rejected so a direct write can no longer
-- reach `pending`. Reaching `pending` is now submit_case_command's job, which
-- always creates the approval requests in the same transaction.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Supervisor can approve/reject entries in tenant" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ update pending tenant entries" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ soft delete tenant entries" ON public.case_entries;
DROP POLICY IF EXISTS "residents update own draft or rejected entries" ON public.case_entries;
DROP POLICY IF EXISTS "residents soft delete own entries" ON public.case_entries;

CREATE POLICY "residents edit own draft or rejected entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft','rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft','rejected')
    AND deleted_at IS NULL
  );

CREATE POLICY "residents soft delete own draft entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status = 'draft'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NOT NULL
  );

DROP POLICY IF EXISTS "Supervisor+ update approval requests" ON public.approval_requests;
DROP POLICY IF EXISTS "Residents create approval requests" ON public.approval_requests;

-- Re-assert the tenant-scoped read so the approval ledger stays inspectable
-- while remaining read-only for every authenticated principal.
DROP POLICY IF EXISTS "Tenant members read approval requests" ON public.approval_requests;
CREATE POLICY "Tenant members read approval requests"
  ON public.approval_requests FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 7. submit_case_command -- the only path into `pending`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_case_command(
  p_case_id UUID,
  p_request_id TEXT,
  p_expected_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_case public.case_entries%ROWTYPE;
  v_reviewers UUID[] := ARRAY[]::UUID[];
  v_reviewer UUID;
  v_fingerprint TEXT;
  v_stored_fingerprint TEXT;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  IF p_case_id IS NULL
     OR p_request_id IS NULL
     OR char_length(p_request_id) < 1
     OR char_length(p_request_id) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request', 'code', 'invalid_request');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL
     OR v_principal.profile_status IS DISTINCT FROM 'active'
     OR v_principal.tenant_status IS DISTINCT FROM 'active'
     OR v_principal.aal IS NULL
     OR v_principal.role NOT IN ('resident','supervisor','director','institution_admin','admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  -- Deterministic comparison value for "same key, same input". Deliberately
  -- not a cryptographic digest: pgcrypto's schema is not guaranteed by
  -- search_path hardening, and this is an equality check, not a security
  -- control. The UNIQUE (tenant, actor, command, request_id) constraint is
  -- what actually provides the idempotency guarantee.
  v_fingerprint := p_case_id::text || '|' || COALESCE(p_expected_status, '');

  INSERT INTO public.clinical_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    v_principal.tenant_id, v_principal.profile_id, 'submit_case', p_request_id,
    v_fingerprint, '{"success":false,"error":"in_progress"}'::jsonb
  )
  ON CONFLICT (tenant_id, actor_profile_id, command, request_id) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  IF NOT COALESCE(v_claimed, FALSE) THEN
    SELECT request_fingerprint, result
    INTO v_stored_fingerprint, v_stored
    FROM public.clinical_command_log
    WHERE tenant_id = v_principal.tenant_id
      AND actor_profile_id = v_principal.profile_id
      AND command = 'submit_case'
      AND request_id = p_request_id;

    IF v_stored IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'transient: in_progress', 'code', 'state_conflict');
    END IF;
    IF v_stored ->> 'error' = 'in_progress' THEN
      RETURN v_stored;
    END IF;
    IF v_stored_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('success', false, 'error', 'request key reused with different input', 'code', 'idempotency_conflict');
    END IF;
    RETURN v_stored;
  END IF;

  <<work>> BEGIN
    SELECT *
    INTO v_case
    FROM public.case_entries
    WHERE id = p_case_id
      AND tenant_id = v_principal.tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_found', 'code', 'not_found');
      EXIT work;
    END IF;

    IF v_case.resident_id IS DISTINCT FROM v_principal.profile_id THEN
      v_result := jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
      EXIT work;
    END IF;

    IF v_case.status NOT IN ('draft', 'rejected') THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'state_conflict',
        'code', 'state_conflict',
        'current_status', v_case.status
      );
      EXIT work;
    END IF;

    IF p_expected_status IS NOT NULL
       AND v_case.status IS DISTINCT FROM p_expected_status THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'state_conflict',
        'code', 'state_conflict',
        'current_status', v_case.status
      );
      EXIT work;
    END IF;

    -- Fail closed: required recipients are derived from the tenant's active
    -- supervisor/director assignments. With no eligible reviewer the case
    -- stays a draft and the caller gets an actionable error.
    SELECT COALESCE(array_agg(reviewer.id ORDER BY reviewer.id), ARRAY[]::UUID[])
    INTO v_reviewers
    FROM public.profiles AS reviewer
    WHERE reviewer.tenant_id = v_principal.tenant_id
      AND reviewer.role IN ('supervisor', 'director')
      AND reviewer.status = 'active'
      AND reviewer.deleted_at IS NULL
      AND reviewer.id IS DISTINCT FROM v_case.resident_id;

    IF COALESCE(array_length(v_reviewers, 1), 0) = 0 THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'no_eligible_reviewer',
        'code', 'no_eligible_reviewer',
        'current_status', v_case.status
      );
      EXIT work;
    END IF;

    FOREACH v_reviewer IN ARRAY v_reviewers LOOP
      INSERT INTO public.approval_requests (entry_id, supervisor_id, tenant_id, status)
      VALUES (v_case.id, v_reviewer, v_principal.tenant_id, 'pending')
      ON CONFLICT (entry_id, supervisor_id) DO NOTHING;
    END LOOP;

    IF v_case.status = 'rejected' THEN
      UPDATE public.case_entries
      SET status = 'draft', updated_at = NOW()
      WHERE id = v_case.id
        AND tenant_id = v_principal.tenant_id
        AND status = 'rejected';
    END IF;

    UPDATE public.case_entries
    SET status = 'pending', updated_at = NOW()
    WHERE id = v_case.id
      AND tenant_id = v_principal.tenant_id
      AND status = 'draft';

    v_result := jsonb_build_object(
      'success', true,
      'case_id', v_case.id,
      'status', 'pending',
      'reviewers', to_jsonb(v_reviewers)
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'submit_failed', 'code', 'internal_error');
  END; -- <<work>>

  UPDATE public.clinical_command_log
  SET row_id = p_case_id, result = v_result
  WHERE tenant_id = v_principal.tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'submit_case'
    AND request_id = p_request_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_submit', 'case_entries', p_case_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'status', v_result ->> 'status',
      'denied', NOT COALESCE((v_result ->> 'success')::boolean, FALSE)
    )
  );

  INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_submit', 'case_entries', p_case_id,
    jsonb_build_object('request_id', p_request_id, 'status', v_result ->> 'status')
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.submit_case_command(UUID, TEXT, TEXT) IS
  'Idempotent, owner-scoped, fail-closed command that moves a case into pending and creates its approval requests in the same transaction.';

-- ---------------------------------------------------------------------------
-- 8. decide_case_command -- the only path out of `pending`.
--
-- The approval lookup is tenant-pinned on approval_requests itself, not only on
-- the case row above it. approval_requests is a second table with its own tenant
-- column, and this function is SECURITY DEFINER, so nothing downstream re-checks
-- it: an entry_id-only lookup trusts that every request row pointing at the
-- entry also belongs to the entry's tenant. 20260926000004 supersedes this
-- definition and carries the same predicate, so the two agree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_case_command(
  p_case_id UUID,
  p_request_id TEXT,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_case public.case_entries%ROWTYPE;
  v_approval public.approval_requests%ROWTYPE;
  v_next_status TEXT;
  v_fingerprint TEXT;
  v_stored_fingerprint TEXT;
  v_stored JSONB;
  v_claimed BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  IF p_case_id IS NULL
     OR p_request_id IS NULL
     OR char_length(p_request_id) < 1
     OR char_length(p_request_id) > 128
     OR p_decision IS NULL
     OR p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request', 'code', 'invalid_request');
  END IF;

  -- Live AAL2 for a privileged clinical transition. Raises closed, so a
  -- direct call cannot fall through to a softer path.
  IF NOT public.require_privileged_principal(
    ARRAY['supervisor', 'director', 'institution_admin', 'admin']::TEXT[],
    NULL,
    TRUE
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND OR v_principal.profile_id IS NULL OR v_principal.tenant_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_next_status := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;
  v_fingerprint := p_case_id::text || '|' || p_decision;

  INSERT INTO public.clinical_command_log (
    tenant_id, actor_profile_id, command, request_id, request_fingerprint, result
  ) VALUES (
    v_principal.tenant_id, v_principal.profile_id, 'decide_case', p_request_id,
    v_fingerprint, '{"success":false,"error":"in_progress"}'::jsonb
  )
  ON CONFLICT (tenant_id, actor_profile_id, command, request_id) DO NOTHING
  RETURNING TRUE INTO v_claimed;

  IF NOT COALESCE(v_claimed, FALSE) THEN
    SELECT request_fingerprint, result
    INTO v_stored_fingerprint, v_stored
    FROM public.clinical_command_log
    WHERE tenant_id = v_principal.tenant_id
      AND actor_profile_id = v_principal.profile_id
      AND command = 'decide_case'
      AND request_id = p_request_id;

    IF v_stored IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'transient: in_progress', 'code', 'state_conflict');
    END IF;
    IF v_stored ->> 'error' = 'in_progress' THEN
      RETURN v_stored;
    END IF;
    IF v_stored_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RETURN jsonb_build_object('success', false, 'error', 'request key reused with different input', 'code', 'idempotency_conflict');
    END IF;
    RETURN v_stored;
  END IF;

  <<work>> BEGIN
    SELECT *
    INTO v_case
    FROM public.case_entries
    WHERE id = p_case_id
      AND tenant_id = v_principal.tenant_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'not_found', 'code', 'not_found');
      EXIT work;
    END IF;

    IF v_case.status <> 'pending' THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'state_conflict',
        'code', 'state_conflict',
        'current_status', v_case.status
      );
      EXIT work;
    END IF;

    SELECT *
    INTO v_approval
    FROM public.approval_requests
    WHERE entry_id = p_case_id
      AND tenant_id = v_principal.tenant_id
    ORDER BY (supervisor_id = v_principal.profile_id) DESC, requested_at
    LIMIT 1;

    IF NOT FOUND THEN
      v_result := jsonb_build_object('success', false, 'error', 'no_approval_request', 'code', 'forbidden');
      EXIT work;
    END IF;

    IF v_approval.supervisor_id IS NOT NULL
       AND v_approval.supervisor_id IS DISTINCT FROM v_principal.profile_id
       AND v_principal.role NOT IN ('director', 'institution_admin', 'admin') THEN
      v_result := jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
      EXIT work;
    END IF;

    UPDATE public.case_entries
    SET status = v_next_status, updated_at = NOW()
    WHERE id = v_case.id;

    UPDATE public.approval_requests
    SET status = v_next_status,
        comment = COALESCE(p_reason, comment),
        resolved_at = NOW()
    WHERE id = v_approval.id;

    v_result := jsonb_build_object(
      'success', true,
      'case_id', v_case.id,
      'approval_id', v_approval.id,
      'status', v_next_status
    );
  EXCEPTION WHEN OTHERS THEN
    v_result := jsonb_build_object('success', false, 'error', 'decide_failed', 'code', 'internal_error');
  END; -- <<work>>

  UPDATE public.clinical_command_log
  SET row_id = p_case_id, result = v_result
  WHERE tenant_id = v_principal.tenant_id
    AND actor_profile_id = v_principal.profile_id
    AND command = 'decide_case'
    AND request_id = p_request_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_decide', 'case_entries', p_case_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'status', v_result ->> 'status',
      'has_reason', p_reason IS NOT NULL,
      'denied', NOT COALESCE((v_result ->> 'success')::boolean, FALSE)
    )
  );

  INSERT INTO public.audit_outbox (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    v_principal.tenant_id, auth.uid(), 'case_decide', 'case_entries', p_case_id,
    jsonb_build_object('request_id', p_request_id, 'status', v_result ->> 'status')
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) IS
  'AAL2-gated command that approves or rejects a pending clinical case and resolves its approval request in the same transaction.';

-- ---------------------------------------------------------------------------
-- 9. Grants: authenticated only. No PUBLIC, anon or service_role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_case_command(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_case_command(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_case_command(UUID, TEXT, TEXT, TEXT) TO authenticated;
