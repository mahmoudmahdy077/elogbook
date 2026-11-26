-- ============================================================================
-- 20261126000500_draft_submit_individual_tenants.sql
--
-- Submitting a draft in an individual tenant always failed with
--   "Invalid status transition: draft -> approved. Allowed: draft, pending"
--
-- The submit route updates draft -> pending. The BEFORE UPDATE trigger
-- auto_approve_individual() then rewrites pending -> approved (solo accounts
-- have no supervisor), and enforce_case_status_transition() — which runs
-- after it — compares OLD=draft with NEW=approved and rejects the row.
--
-- Allow draft -> approved only for individual tenants, which is exactly the
-- auto-approval path. Institutional transitions are unchanged.
--
-- destructive: no — trigger function replaced; one UPDATE policy tightened to
-- allow the same auto-approval for individual tenants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_case_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE OLD.status
      WHEN 'draft' THEN
        -- Solo accounts auto-approve on submit; the auto-approve trigger has
        -- already rewritten pending -> approved by the time we run.
        IF NEW.status = 'approved' AND EXISTS (
          SELECT 1 FROM public.tenants
          WHERE id = NEW.tenant_id AND tenant_type = 'individual'
        ) THEN
          RETURN NEW;
        END IF;
        IF NEW.status NOT IN ('draft', 'pending') THEN
          RAISE EXCEPTION 'Invalid status transition: draft -> %. Allowed: draft, pending', NEW.status;
        END IF;
      WHEN 'pending' THEN
        IF NEW.status NOT IN ('approved', 'rejected') THEN
          RAISE EXCEPTION 'Invalid status transition: pending -> %. Allowed: approved, rejected', NEW.status;
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
$function$;

-- The resident UPDATE policy's WITH CHECK only admitted draft/pending, so the
-- auto-approved row was rejected by RLS. Allow 'approved' for individual
-- tenants; institutional rows keep the original rule.
DROP POLICY IF EXISTS "residents update own draft or rejected entries" ON public.case_entries;
CREATE POLICY "residents update own draft or rejected entries" ON public.case_entries
  FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft', 'rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND (
      status IN ('draft', 'pending')
      OR (
        status = 'approved'
        AND (SELECT tenant_type FROM public.tenants WHERE id = case_entries.tenant_id) = 'individual'
      )
    )
  );
