-- Migration 00089: GMC/ISCP Framework Support (Phase 5 - Competitor Parity)
ALTER TABLE public.accreditation_frameworks
  DROP CONSTRAINT IF EXISTS accreditation_frameworks_framework_type_check;

ALTER TABLE public.accreditation_frameworks
  ADD CONSTRAINT accreditation_frameworks_framework_type_check
  CHECK (framework_type IN ('acgme','scfhs','gmc','canmeds','custom'));

-- Seed GMC curriculum (using global tenant placeholder)
INSERT INTO public.accreditation_frameworks (tenant_id, name, version, framework_type, milestones)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'GMC Curriculum 2024',
  '2024.1',
  'gmc',
  '[
    {"code":"ML1","description":"Manages safe and effective handover","competency_area":"Maintaining Good Medical Practice","target_minimum":5},
    {"code":"ML2","description":"Safe prescribing","competency_area":"Maintaining Good Medical Practice","target_minimum":10},
    {"code":"ML3","description":"Recognises and manages acutely unwell patients","competency_area":"Maintaining Good Medical Practice","target_minimum":10},
    {"code":"C1","description":"Communicates effectively with patients","competency_area":"Communication","target_minimum":5},
    {"code":"C2","description":"Communicates effectively with colleagues","competency_area":"Communication","target_minimum":5},
    {"code":"L1","description":"Demonstrates leadership in clinical settings","competency_area":"Leadership","target_minimum":3},
    {"code":"T1","description":"Teaches and assesses colleagues","competency_area":"Teaching","target_minimum":3},
    {"code":"S1","description":"Engages in quality improvement","competency_area":"Scholarship","target_minimum":2}
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.accreditation_frameworks
  WHERE framework_type = 'gmc' AND name = 'GMC Curriculum 2024'
);
