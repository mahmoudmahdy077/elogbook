-- Migration 00090: CanMEDS Role Annotation (Phase 5 - Competitor Parity)
ALTER TABLE public.case_entries
  ADD COLUMN IF NOT EXISTS canmeds_roles TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_case_entries_canmeds
  ON public.case_entries USING gin (canmeds_roles);

-- Seed CanMEDS framework
INSERT INTO public.accreditation_frameworks (tenant_id, name, version, framework_type, milestones)
SELECT
  '00000000-0000-0000-0000-000000000000',
  'CanMEDS 2015',
  '2015',
  'canmeds',
  '[
    {"code":"ME","description":"Medical Expert","competency_area":"Medical Expert","target_minimum":1},
    {"code":"COM","description":"Communicator","competency_area":"Communicator","target_minimum":1},
    {"code":"COL","description":"Collaborator","competency_area":"Collaborator","target_minimum":1},
    {"code":"LDR","description":"Leader","competency_area":"Leader","target_minimum":1},
    {"code":"HA","description":"Health Advocate","competency_area":"Health Advocate","target_minimum":1},
    {"code":"SCH","description":"Scholar","competency_area":"Scholar","target_minimum":1},
    {"code":"PRO","description":"Professional","competency_area":"Professional","target_minimum":1}
  ]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.accreditation_frameworks
  WHERE framework_type = 'canmeds' AND name = 'CanMEDS 2015'
);
