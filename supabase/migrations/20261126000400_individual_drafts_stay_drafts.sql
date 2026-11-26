-- ============================================================================
-- 20261126000400_individual_drafts_stay_drafts.sql
--
-- auto_approve_individual() forced NEW.status := 'approved' for every row in an
-- individual tenant, on INSERT and UPDATE. That silently turned "Save Draft"
-- into an approved case: the user saw "Draft saved", the list showed the entry
-- as approved, and the draft was never editable.
--
-- Individual tenants have no supervisor, so a *submitted* case should still
-- auto-approve. Only a draft must stay a draft.
--
-- destructive: no — trigger function replaced.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_approve_individual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = NEW.tenant_id
      AND tenant_type = 'individual'
  ) THEN
    NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$function$;
