-- ============================================================================
-- 20260926000004_invitation_signup_boundary.sql
--
-- Tenant invitations become tenant-bound, expiring, single-use and digest-only,
-- and public self-service signup stops provisioning tenants.
--
-- Root cause this migration closes
-- ------------------------------
-- 20260818160000 created tenant_invites with no expiry and no token: the row
-- carried only id, tenant_id, email, invited_by, role, status, created_at and
-- accepted_at.
--
-- Consequences:
--   * An invitation never expired. `created_at` existed but nothing read it, so
--     a link forwarded in 2024 was still redeemable in 2026.
--   * Redemption was matched on the email address alone. The "secret" was
--     Supabase's own email link, so the application had no way to tell a
--     legitimate invitation holder from somebody holding a forwarded copy of a
--     Supabase confirmation mail.
--   * handle_new_user (20260925000002) provisioned a tenant for anybody who
--     signed up without an invitation: either the shared `global-community`
--     tenant, or a brand new `individual` tenant. /signup called
--     supabase.auth.signUp directly, so "create an account" was in practice
--     "create a tenant" for an anonymous visitor.
--
-- Fix
-- ---
-- 1. tenant_invites gains expires_at (NOT NULL) and token_hash. Only the
--    sha256 digest of the token is stored, so a database read cannot mint an
--    invitation, and the digest column is unreadable to authenticated tenants.
-- 2. A partial unique index on (tenant_id, lower(email)) WHERE status =
--    'pending' makes a live invitation single-use per address per tenant: a
--    second redemption has nothing left to consume.
-- 3. handle_new_user consumes only a pending, unexpired invitation in an
--    active tenant, row-locked. With no invitation it provisions nothing: no
--    profile, no tenant, no role, no app metadata. The account has no tenant
--    context at all, which is the definition of fail-closed at the
--    authorization boundary.
--
-- Both remaining identity-creating paths already create a pending invitation
-- first, so neither is affected:
--   * apps/web/app/api/setup/create-admin/route.ts inserts the bootstrap
--     tenant_invites row, then calls auth.admin.createUser.
--   * apps/web/app/api/[tenant]/admin/invite/route.ts inserts the row, then
--     queues the accept link; the identity is created later by
--     POST /api/invitations/accept, which is gated on the token.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Expiry and digest columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Existing pending rows get a bounded window rather than an infinite one.
UPDATE public.tenant_invites
SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '7 days'
WHERE expires_at IS NULL;

ALTER TABLE public.tenant_invites
  ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

ALTER TABLE public.tenant_invites
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.tenant_invites
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- The digest is the bearer credential's verifier, not a tenant-readable
-- column. Tenants keep SELECT on the rest of the row for their own
-- invitations list.
REVOKE SELECT (token_hash) ON public.tenant_invites FROM anon, authenticated;

COMMENT ON COLUMN public.tenant_invites.token_hash IS
  'sha256 hex digest of the invitation token. The raw token is only ever present in the emailed accept link and in the redemption request.';
COMMENT ON COLUMN public.tenant_invites.expires_at IS
  'Hard redemption deadline. An invitation past this instant cannot be redeemed even if its status is still pending.';

-- ---------------------------------------------------------------------------
-- 2. Single use and digest uniqueness.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_invites_token_hash
  ON public.tenant_invites (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_invites_pending_email
  ON public.tenant_invites (tenant_id, LOWER(email))
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. Expiry is immutable and cannot be pushed forward by a tenant session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_tenant_invite_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_platform_admin BOOLEAN;
  v_trusted_database_context BOOLEAN;
BEGIN
  v_trusted_database_context :=
    session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
    AND COALESCE(current_setting('role', true), '') NOT IN ('authenticated', 'anon', 'service_role')
    AND auth.role() IS DISTINCT FROM 'service_role';
  IF v_trusted_database_context THEN
    RETURN NEW;
  END IF;

  -- Consuming an invitation is the redemption, and it is the only write that
  -- may move expires_at (to now()) or record the acceptance.
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'accepted'
     AND OLD.status = 'pending'
     AND NEW.accepted_at IS NOT NULL THEN
    v_platform_admin := COALESCE(public.is_platform_admin(), FALSE);
    IF v_platform_admin THEN
      RETURN NEW;
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
       OR NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
      RAISE EXCEPTION 'invitation redemption may not alter invitation authority'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_platform_admin := COALESCE(public.is_platform_admin(), FALSE);
  IF v_platform_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash THEN
    RAISE EXCEPTION 'invitation expiry and token digest are immutable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.expires_at <= NEW.created_at THEN
    RAISE EXCEPTION 'invitation expiry must be after its creation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tenant_invite_expiry ON public.tenant_invites;
CREATE TRIGGER trg_protect_tenant_invite_expiry
  BEFORE INSERT OR UPDATE ON public.tenant_invites
  FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_invite_expiry();

REVOKE ALL ON FUNCTION public.protect_tenant_invite_expiry() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. handle_new_user: an invitation is the only route into a tenant.
--
-- The trigger still returns NEW for an un-invited signup, because the auth
-- schema owns the user row and aborting the INSERT here would surface as an
-- opaque signup failure. It provisions nothing instead: no profile row, no
-- tenant_id, no role, no raw_app_meta_data. Every tenant-scoped policy,
-- get_tenant_id() and get_authoritative_principal_with_aal() resolve from the
-- profile, so an unprovisioned account holds no authority at all.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
  v_profile_id UUID;
  v_requested_role TEXT;
  v_full_name TEXT;
  v_invite RECORD;
  v_status TEXT;
BEGIN
  -- Invitation required. Pending, unexpired, in an active tenant, row-locked so
  -- two concurrent redemptions cannot both consume the same invitation.
  SELECT invite.*
  INTO v_invite
  FROM public.tenant_invites AS invite
  INNER JOIN public.tenants AS invite_tenant ON invite_tenant.id = invite.tenant_id
  WHERE LOWER(invite.email) = LOWER(NEW.email)
    AND invite.status = 'pending'
    AND invite.expires_at > NOW()
    AND invite_tenant.status = 'active'
  ORDER BY invite.created_at DESC
  LIMIT 1
  FOR UPDATE OF invite;

  IF NOT FOUND THEN
    -- No invitation: no tenant, no profile, no role, no app metadata. The
    -- account exists in auth.users and can do nothing with it.
    RETURN NEW;
  END IF;

  v_tenant_id := v_invite.tenant_id;
  v_requested_role := COALESCE(v_invite.role, 'resident');
  v_full_name := COALESCE(NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''), NEW.email, 'Account');

  -- Single use: status moves out of 'pending' under the row lock taken above.
  -- The partial unique index on (tenant_id, LOWER(email)) WHERE status =
  -- 'pending' is the second line of defence.
  UPDATE public.tenant_invites
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_invite.id
    AND status = 'pending';

  -- Never derived from user metadata: user metadata is caller-controlled.
  IF v_requested_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    v_requested_role := 'resident';
  END IF;

  v_status := CASE
    WHEN v_requested_role IN ('supervisor', 'director', 'institution_admin', 'admin') THEN 'pending'
    ELSE 'active'
  END;

  INSERT INTO public.profiles (
    tenant_id, user_id, role, status, pending_role, full_name, onboarding_completed
  )
  VALUES (
    v_tenant_id,
    NEW.id,
    'resident',
    v_status,
    CASE WHEN v_status = 'pending' THEN v_requested_role ELSE NULL END,
    v_full_name,
    false
  )
  RETURNING id INTO v_profile_id;

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::JSONB) || jsonb_build_object(
    'tenant_id', v_tenant_id,
    'user_role', 'resident',
    'profile_id', v_profile_id
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 5. invite.welcome renders only allowlisted variables.
--
-- validateEmailQueuePayload (packages/shared/src/email/safety.ts) rejects any
-- key outside ALLOWED_PAYLOAD_KEYS, and render() throws on a variable the
-- payload does not carry. {{tenant_name}} was in neither set, so the queue
-- processor failed this template with invalid_queue_payload and the
-- invitation email was never delivered. {{role}} and {{onboarding_url}} are
-- both allowlisted; the recipient's name travels in email_queue.to_name.
-- ---------------------------------------------------------------------------
UPDATE public.email_templates
SET subject = 'You have an invitation to eLogbook',
    html = '<p>You have been invited as {{role}}.</p><p><a href="{{onboarding_url}}">Accept your invitation</a></p><p>This link can be used once and expires after 72 hours.</p>',
    text = 'You have been invited as {{role}}. Accept your invitation: {{onboarding_url}} (single use, expires in 72 hours)',
    updated_at = NOW()
WHERE key = 'invite.welcome';
