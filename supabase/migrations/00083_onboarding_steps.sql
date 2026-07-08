-- ============================================================================
-- 00083_onboarding_steps.sql
--
-- Phase 1 — Onboarding wizard state and in-app notifications.
--
-- Creates:
--   1. ALTER profiles — add onboarding_steps JSONB column
--   2. notifications table — realtime-compatible user notifications
--   3. Enable realtime publication for notifications
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add onboarding wizard state to profiles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_steps JSONB DEFAULT '[]';
-- onboarding_steps: ["profile", "specialty", "tour", "first_case", "goal_set"]

COMMENT ON COLUMN public.profiles.onboarding_steps IS
  'List of completed onboarding steps: profile, specialty, tour, first_case, goal_set';

-- ---------------------------------------------------------------------------
-- 2. Notifications table
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.notifications IS
  'In-app notifications with realtime support';

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_tenant
  ON public.notifications(tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_own ON public.notifications
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notifications_insert_tenant ON public.notifications
  FOR INSERT
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. Enable realtime for notifications
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ---------------------------------------------------------------------------
-- 6. Audit trigger
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.notifications IS
  'In-app notifications with realtime support';
COMMENT ON TABLE public.notifications IS
  'In-app notifications with realtime support — audit-triggered';
DROP TRIGGER IF EXISTS trg_audit_notifications ON public.notifications;
CREATE TRIGGER trg_audit_notifications
  AFTER INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');
