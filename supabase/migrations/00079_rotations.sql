-- ============================================================================
-- 00079_rotations.sql
--
-- Phase 1 — Rotation scheduling and shift assignments.
-- Closes competitor gap #1 vs New Innovations.
--
-- Creates:
--   1. rotations table — scheduled rotation blocks for residents
--   2. shifts table — individual shift assignments within rotations
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rotations table
-- ---------------------------------------------------------------------------
CREATE TABLE public.rotations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  specialty     TEXT,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  site          TEXT,
  supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.rotations IS
  'Scheduled rotation blocks for residents within a program';

-- ---------------------------------------------------------------------------
-- 2. Shifts table
-- ---------------------------------------------------------------------------
CREATE TABLE public.shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_id   UUID NOT NULL REFERENCES public.rotations(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_date    DATE NOT NULL,
  start_time    TIME,
  end_time      TIME,
  shift_type    TEXT NOT NULL DEFAULT 'regular'
                  CHECK (shift_type IN ('call', 'clinic', 'vacation', 'weekend', 'regular', 'night', 'long')),
  location      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.shifts IS
  'Individual shift assignments within a rotation';

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rotations_tenant_resident
  ON public.rotations(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_rotations_tenant_status
  ON public.rotations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rotations_date_range
  ON public.rotations(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_date
  ON public.shifts(tenant_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_rotation
  ON public.shifts(rotation_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotations FORCE ROW LEVEL SECURITY;

CREATE POLICY rotations_tenant_isolation ON public.rotations
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY rotations_select_own ON public.rotations
  FOR SELECT
  USING (resident_id = (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY rotations_insert_director ON public.rotations
  FOR INSERT
  WITH CHECK (get_user_role() IN ('director', 'institution_admin', 'admin'));

CREATE POLICY rotations_update_director ON public.rotations
  FOR UPDATE
  USING (get_user_role() IN ('director', 'institution_admin', 'admin'));

CREATE POLICY rotations_delete_director ON public.rotations
  FOR DELETE
  USING (get_user_role() IN ('director', 'institution_admin', 'admin'));

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts FORCE ROW LEVEL SECURITY;

CREATE POLICY shifts_tenant_isolation ON public.shifts
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_rotations_updated_at ON public.rotations;
CREATE TRIGGER set_rotations_updated_at
  BEFORE UPDATE ON public.rotations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_rotations ON public.rotations;
CREATE TRIGGER trg_audit_rotations
  AFTER INSERT OR UPDATE OR DELETE ON public.rotations
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');

DROP TRIGGER IF EXISTS trg_audit_shifts ON public.shifts;
CREATE TRIGGER trg_audit_shifts
  AFTER INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');
