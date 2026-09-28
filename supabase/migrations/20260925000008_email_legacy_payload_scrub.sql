BEGIN;

UPDATE public.email_templates
SET subject = 'You are invited',
    html = '<p>Use the secure link below to accept your invitation.</p><p><a href="{{onboarding_url}}">Accept invitation</a></p>',
    text = 'Accept your invitation: {{onboarding_url}}',
    updated_at = NOW()
WHERE key = 'invite.welcome';

UPDATE public.email_templates
SET subject = 'New contact submission',
    html = '<p>A new contact submission is available in the protected platform console.</p><p><a href="{{contact_url}}">Review submission</a></p>',
    text = 'Review the contact submission: {{contact_url}}',
    updated_at = NOW()
WHERE key = 'contact.admin-alert';

UPDATE public.email_templates
SET subject = 'New case needs review',
    html = '<p>A case is waiting for review.</p><p><a href="{{review_url}}">Review case</a></p>',
    text = 'Review case: {{review_url}}',
    updated_at = NOW()
WHERE key = 'case.pending-review';

UPDATE public.email_templates
SET subject = 'Your case was approved',
    html = '<p>Your case decision is available.</p><p><a href="{{case_url}}">View case</a></p>',
    text = 'View case: {{case_url}}',
    updated_at = NOW()
WHERE key = 'case.approved';

UPDATE public.email_templates
SET subject = 'Your case needs changes',
    html = '<p>Your case decision is available.</p><p><a href="{{case_url}}">View case</a></p>',
    text = 'View case: {{case_url}}',
    updated_at = NOW()
WHERE key = 'case.rejected';

UPDATE public.email_templates
SET subject = 'Your weekly digest',
    html = '<p>Your digest contains {{activity_count}} account updates.</p><p><a href="{{dashboard_url}}">Open dashboard</a></p>',
    text = '{{activity_count}} account updates: {{dashboard_url}}',
    updated_at = NOW()
WHERE key = 'digest.weekly';

UPDATE public.email_templates
SET subject = 'E-Logbook update',
    html = '<p>{{preheader}}</p><p><a href="{{cta_url}}">Read more</a></p>',
    text = '{{preheader}} {{cta_url}}',
    updated_at = NOW()
WHERE key = 'newsletter.generic';

UPDATE public.email_templates
SET subject = 'Invitation help',
    html = '<p>Use the secure link below to accept your invitation.</p><p><a href="{{onboarding_url}}">Accept invitation</a></p>',
    text = 'Accept your invitation: {{onboarding_url}}',
    updated_at = NOW()
WHERE key = 'auth.invite-fallback-note';

UPDATE public.email_queue
SET payload = '{}'::jsonb,
    status = CASE WHEN status IN ('pending', 'retry', 'processing') THEN 'failed' ELSE status END,
    last_error = 'legacy_email_payload_removed',
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL
WHERE payload ?| ARRAY[
  'message', 'body', 'body_html', 'body_text', 'summary', 'content',
  'html', 'text', 'field_values', 'patient', 'diagnosis', 'clinical'
];

COMMIT;
