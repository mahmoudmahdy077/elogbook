-- P1.1: Enable RLS on tables that were missing it, and FORCE RLS on tables without it

-- Tables without any RLS
ALTER TABLE public.benchmark_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procedure_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_backup_log ENABLE ROW LEVEL SECURITY;

-- Tables without FORCE RLS
ALTER TABLE public.duty_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.template_favorites FORCE ROW LEVEL SECURITY;

-- Default deny policies for previously unprotected tables
-- benchmark_data is aggregate data, no tenant isolation needed
CREATE POLICY benchmark_data_select_all ON public.benchmark_data
  FOR SELECT TO authenticated
  USING (true);

-- procedure_codes is a reference/lookup table
CREATE POLICY procedure_codes_select_all ON public.procedure_codes
  FOR SELECT TO authenticated
  USING (true);

-- scheduled_backup_log is operational, no tenant isolation
CREATE POLICY scheduled_backup_log_select_all ON public.scheduled_backup_log
  FOR SELECT TO authenticated
  USING (true);
