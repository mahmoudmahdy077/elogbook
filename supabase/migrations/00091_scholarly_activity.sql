-- Migration 00091: Scholarly Activity Tracker (Phase 5 - Competitor Parity)
CREATE TABLE IF NOT EXISTS public.scholarly_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('publication','presentation','poster','research','irb','grant','book_chapter')),
  title TEXT NOT NULL,
  journal TEXT,
  authors TEXT,
  date DATE,
  doi TEXT,
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','published','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scholarly_tenant_resident ON public.scholarly_activities(tenant_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_scholarly_tenant_type ON public.scholarly_activities(tenant_id, activity_type);

ALTER TABLE public.scholarly_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholarly_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY scholarly_tenant_isolation ON public.scholarly_activities
  FOR ALL USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY scholarly_select_own ON public.scholarly_activities
  FOR SELECT USING (resident_id = (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY scholarly_insert_own ON public.scholarly_activities
  FOR INSERT WITH CHECK (
    resident_id = (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND get_user_role() IN ('supervisor','director','institution_admin','admin','resident')
  );

CREATE POLICY scholarly_update_director ON public.scholarly_activities
  FOR UPDATE USING (get_user_role() IN ('director','institution_admin','admin'));

CREATE POLICY scholarly_delete_director ON public.scholarly_activities
  FOR DELETE USING (get_user_role() IN ('director','institution_admin','admin'));

DROP TRIGGER IF EXISTS set_scholarly_updated_at ON public.scholarly_activities;
CREATE TRIGGER set_scholarly_updated_at BEFORE UPDATE ON public.scholarly_activities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
