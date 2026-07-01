-- Migration 00070: Faculty evaluations for resident assessment

CREATE TABLE faculty_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  clinical_skills INTEGER CHECK (clinical_skills BETWEEN 1 AND 5),
  professionalism INTEGER CHECK (professionalism BETWEEN 1 AND 5),
  procedures INTEGER CHECK (procedures BETWEEN 1 AND 5),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faculty_evaluations_resident ON faculty_evaluations(resident_id);
CREATE INDEX idx_faculty_evaluations_tenant ON faculty_evaluations(tenant_id);

ALTER TABLE faculty_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY faculty_evals_tenant_isolation ON faculty_evaluations
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = evaluator_id));

CREATE OR REPLACE VIEW resident_evaluation_averages AS
SELECT resident_id,
  AVG(clinical_skills) AS avg_clinical,
  AVG(professionalism) AS avg_professionalism,
  AVG(procedures) AS avg_procedures,
  COUNT(*) AS evaluation_count
FROM faculty_evaluations
GROUP BY resident_id;

-- Down migration:
-- DROP VIEW IF EXISTS resident_evaluation_averages;
-- DROP TABLE IF EXISTS faculty_evaluations;