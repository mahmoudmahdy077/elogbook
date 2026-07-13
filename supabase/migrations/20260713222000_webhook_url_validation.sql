-- P1.3: Webhook URL validation and safety constraints

-- Add CHECK constraint ensuring webhook URLs are HTTPS-only
ALTER TABLE public.tenant_webhooks
  DROP CONSTRAINT IF EXISTS chk_webhook_https_url,
  ADD CONSTRAINT chk_webhook_https_url
  CHECK (url IS NULL OR url ~ '^https://[^\s/$.?#].[^\s]*$');

-- Add constraint to prevent credential-bearing URLs (user:password@host)
ALTER TABLE public.tenant_webhooks
  DROP CONSTRAINT IF EXISTS chk_webhook_no_credentials,
  ADD CONSTRAINT chk_webhook_no_credentials
  CHECK (url IS NULL OR url !~ '^https?://[^@]+@');
