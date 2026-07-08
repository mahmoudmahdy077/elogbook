-- Migration 00086: MFA enforcement trigger + webhook retry queue
-- Phase 2 — Security Hardening

-- ============================================================================
-- 2.2 — MFA Enforcement for High-Privilege Roles
-- ============================================================================
-- Prevents director, institution_admin, admin role assignment without MFA enrolled

CREATE OR REPLACE FUNCTION public.enforce_mfa_for_high_privilege()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('director', 'institution_admin', 'admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors
      WHERE user_id = NEW.user_id AND status = 'verified'
    ) THEN
      RAISE EXCEPTION 'MFA enrollment required for role %', NEW.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_mfa ON public.profiles;
CREATE TRIGGER trg_enforce_mfa
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mfa_for_high_privilege();

-- ============================================================================
-- 2.3 — Webhook Retry Queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.tenant_webhook_deliveries(id) ON DELETE CASCADE,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_retry_next
  ON public.webhook_retry_queue(next_attempt_at)
  WHERE attempt_count < max_attempts;

ALTER TABLE public.webhook_retry_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_retry_queue FORCE ROW LEVEL SECURITY;
-- Only triggers and service_role can write; no direct access
CREATE POLICY webhook_retry_service_role ON public.webhook_retry_queue
  FOR ALL USING (auth.role() = 'service_role');
