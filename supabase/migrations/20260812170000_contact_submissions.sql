-- 20260812170000_contact_submissions.sql
-- S11: the contact API was a fake-success stub. Store submissions in a
-- service_role-only table; platform staff read them via the dashboard/SQL.

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_submissions FORCE ROW LEVEL SECURITY;

-- No policies: default-deny for anon/authenticated; service_role bypasses RLS.
