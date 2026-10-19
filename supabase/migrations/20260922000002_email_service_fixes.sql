-- 20260922000002_email_service_fixes.sql
-- Follow-up fixes for enterprise email service: open/click tracking + missing seed template.

ALTER TABLE public.email_logs ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.email_logs ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

INSERT INTO public.email_templates (key, subject, html, text) VALUES
('auth.invite-fallback-note', 'Invite help for {{tenant_name}}', '<p>Hi {{to_name}},</p><p>Here is help with your invite to {{tenant_name}}. <a href="{{onboarding_url}}">Accept invite</a></p>', 'Hi {{to_name}}, invite help for {{tenant_name}}: {{onboarding_url}}')
ON CONFLICT (key) DO NOTHING;
