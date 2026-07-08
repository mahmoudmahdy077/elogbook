-- ============================================================================
-- 00081_evaluation_forms.sql
--
-- Phase 1 — Expanded evaluation portfolio (Mini-CEX, DOPS, CBD, and more).
-- Closes gap vs NHS Logbook+ & New Innovations.
--
-- Creates:
--   1. evaluation_forms table — supports 8 form types with JSONB ratings
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Evaluation forms table
-- ---------------------------------------------------------------------------
CREATE TABLE public.evaluation_forms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  evaluator_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  form_type       TEXT NOT NULL
                    CHECK (form_type IN (
                      'mini_cex', 'dops', 'cbd', 'cex',
                      'msf', 'osce', '360_review', 'portfolio_review'
                    )),
  encounter_date  DATE,
  setting         TEXT,
  patient_context TEXT,
  ratings         JSONB NOT NULL DEFAULT '{}',
  -- ratings structure: { "domains": [{ "name": "Clinical", "score": 4, "max": 5 }, ...] }
  overall_score   NUMERIC(3,1),
  feedback        TEXT,
  action_plan     TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'acknowledged')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.evaluation_forms IS
  'Expanded evaluation portfolio — Mini-CEX, DOPS, CBD, MSF, OSCE, 360, portfolio review';

COMMENT ON COLUMN public.evaluation_forms.ratings IS
  'JSONB structure: { "domains": [{ "name": "Clinical", "score": 4, "max": 5 }, ...] }';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_eval_forms_tenant_resident
  ON public.evaluation_forms(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_eval_forms_tenant_type
  ON public.evaluation_forms(tenant_id, form_type);
CREATE INDEX IF NOT EXISTS idx_eval_forms_status
  ON public.evaluation_forms(tenant_id, status);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.evaluation_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_forms FORCE ROW LEVEL SECURITY;

CREATE POLICY eval_forms_tenant ON public.evaluation_forms
  FOR ALL
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_evalforms_updated_at ON public.evaluation_forms;
CREATE TRIGGER set_evalforms_updated_at
  BEFORE UPDATE ON public.evaluation_forms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Audit triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_evaluation_forms ON public.evaluation_forms;
CREATE TRIGGER trg_audit_evaluation_forms
  AFTER INSERT OR UPDATE OR DELETE ON public.evaluation_forms
  FOR EACH ROW EXECUTE FUNCTION public.audit_table_change('');
