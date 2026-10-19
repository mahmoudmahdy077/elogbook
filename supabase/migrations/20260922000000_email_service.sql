-- 20260922000000_email_service.sql
-- Enterprise email queue/logs/templates/suppressions. Service-role only via RLS.

CREATE TABLE IF NOT EXISTS public.email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  to_email text NOT NULL CHECK (to_email LIKE '%@%.%'),
  to_name text,
  tenant_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','retry','failed','suppressed')),
  attempts int NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  resend_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_drain ON public.email_queue (status, next_retry_at, priority DESC, created_at) WHERE status IN ('pending','retry');

CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid REFERENCES public.email_queue(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  template_key text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('resend','smtp','suppressed')),
  provider_id text,
  status text NOT NULL CHECK (status IN ('sent','failed','suppressed','bounced','complained')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON public.email_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS public.email_templates (
  key text PRIMARY KEY,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  html text NOT NULL CHECK (char_length(html) BETWEEN 1 AND 100000),
  text text,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('bounce','complaint','unsubscribe')),
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
-- No public policies: service-role only.

INSERT INTO public.email_templates (key, subject, html, text) VALUES
('invite.welcome', 'You are invited to {{tenant_name}}', '<p>Hi {{to_name}},</p><p>You were invited as {{role}}. <a href="{{onboarding_url}}">Accept invite</a></p>', 'Hi {{to_name}}, accept: {{onboarding_url}}'),
('contact.admin-alert', 'New contact: {{name}}', '<p>{{name}} ({{email}}) wrote:</p><blockquote>{{message}}</blockquote>', '{{name}} {{email}}: {{message}}'),
('case.pending-review', 'New case needs review', '<p>{{resident_name}} submitted a case. <a href="{{review_url}}">Review</a></p>', 'Review: {{review_url}}'),
('case.approved', 'Your case was approved', '<p>Approved by {{reviewer_name}}. <a href="{{case_url}}">View</a></p>', 'Approved: {{case_url}}'),
('case.rejected', 'Your case needs changes', '<p>{{reviewer_name}} requested changes. <a href="{{case_url}}">View</a></p>', 'Changes: {{case_url}}'),
('digest.weekly', 'Your weekly digest', '<p>Hi {{to_name}}, {{summary}}</p>', '{{summary}}'),
('newsletter.generic', '{{subject}}', '{{body_html}}', '{{body_text}}')
ON CONFLICT (key) DO NOTHING;
