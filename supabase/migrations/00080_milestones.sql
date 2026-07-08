-- ============================================================================
-- 00080_milestones.sql
--
-- Phase 1 — ACGME Milestones & EPA Mappings.
-- Closes competitor gap vs New Innovations and MedHub.
--
-- Creates:
--   1. milestones table — 22 sub-competencies × 5 levels per resident
--   2. epa_mappings table — EPA code to milestone competency mapping
--   3. Seed data — 12 foundational ACGME EPA entries as default framework
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Milestones table
-- ---------------------------------------------------------------------------
CREATE TABLE public.milestones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  competency_area   TEXT NOT NULL,
  sub_competency    TEXT NOT NULL,
  level             INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  assessor_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assessment_date   DATE NOT NULL,
  evidence_entry_id UUID REFERENCES public.case_entries(id) ON DELETE SET NULL,
  comments          TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, resident_id, sub_competency, assessment_date)
);

COMMENT ON TABLE public.milestones IS
  'ACGME milestone assessments tracking 22 sub-competencies × 5 levels per resident';

COMMENT ON COLUMN public.milestones.level IS
  'ACGME milestone level (1=novice through 5=expert)';

-- ---------------------------------------------------------------------------
-- 2. EPA Mappings table
-- ---------------------------------------------------------------------------
CREATE TABLE public.epa_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  epa_code            TEXT NOT NULL,
  epa_description     TEXT NOT NULL,
  milestone_codes     TEXT[] NOT NULL,
  required_procedures TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.epa_mappings IS
  'Entrustable Professional Activity (EPA) to milestone competency mappings';

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_milestones_tenant_resident
  ON public.milestones(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_milestones_competency
  ON public.milestones(tenant_id, competency_area);
CREATE INDEX IF NOT EXISTS idx_epa_tenant
  ON public.epa_mappings(tenant_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones FORCE ROW LEVEL SECURITY;

CREATE POLICY milestones_tenant ON public.milestones
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

ALTER TABLE public.epa_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epa_mappings FORCE ROW LEVEL SECURITY;

CREATE POLICY epa_tenant ON public.epa_mappings
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. Seed ACGME EPA data (12 foundational EPAs across 6 core competencies)
-- ---------------------------------------------------------------------------
INSERT INTO public.epa_mappings (tenant_id, epa_code, epa_description, milestone_codes)
SELECT
  '00000000-0000-0000-0000-000000000000',  -- global tenant for default framework
  code, epa_description, ARRAY[competency]
FROM (VALUES
  ('PC1',  'Patient Care 1: Compassionate & appropriate care',                                    'Patient Care'),
  ('PC2',  'Patient Care 2: Diagnostic & therapeutic procedures',                                 'Patient Care'),
  ('MK1',  'Medical Knowledge 1: Clinical knowledge',                                              'Medical Knowledge'),
  ('MK2',  'Medical Knowledge 2: Investigative & analytic thinking',                               'Medical Knowledge'),
  ('PB1',  'Practice-Based Learning 1: Self-monitoring & improvement',                             'Practice-Based Learning'),
  ('PB2',  'Practice-Based Learning 2: Feedback & teaching',                                      'Practice-Based Learning'),
  ('CS1',  'Communication 1: Patient & family communication',                                     'Interpersonal & Communication Skills'),
  ('CS2',  'Communication 2: Interprofessional communication',                                    'Interpersonal & Communication Skills'),
  ('PR1',  'Professionalism 1: Ethical principles',                                               'Professionalism'),
  ('PR2',  'Professionalism 2: Accountability',                                                   'Professionalism'),
  ('SBP1', 'Systems-Based Practice 1: Healthcare systems',                                        'Systems-Based Practice'),
  ('SBP2', 'Systems-Based Practice 2: Quality & safety',                                           'Systems-Based Practice')
) AS t(code, epa_description, competency)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_milestones_updated_at ON public.milestones;
CREATE TRIGGER set_milestones_updated_at
  BEFORE UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_milestones ON public.milestones;
CREATE TRIGGER trg_audit_milestones
  AFTER INSERT OR UPDATE OR DELETE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');

DROP TRIGGER IF EXISTS trg_audit_epa_mappings ON public.epa_mappings;
CREATE TRIGGER trg_audit_epa_mappings
  AFTER INSERT OR UPDATE OR DELETE ON public.epa_mappings
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');
