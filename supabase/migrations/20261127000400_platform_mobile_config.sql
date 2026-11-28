-- 20261127000400_platform_mobile_config.sql
--
-- Global mobile controls for platform operators.
--
-- Tenant admins can already set maintenance, version gates and announcements
-- per tenant. A platform operator had no way to take the whole mobile estate
-- down for an incident or require a security update across every tenant. This
-- singleton row is merged into each tenant's config by the app:
--   effective maintenance = platform OR tenant
--   effective min version = the higher of the two
--   platform announcement is used when the tenant has none
--
-- Reads are open to authenticated users (non-secret presentation data);
-- writes have no RLS policy and go through the platform API with the service
-- role after requirePlatformAdmin.
--
-- destructive: no — new table plus seed row.

CREATE TABLE IF NOT EXISTS public.platform_mobile_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  min_app_version TEXT,
  force_update BOOLEAN NOT NULL DEFAULT false,
  update_url TEXT,
  announcement JSONB,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_mobile_config_message_len
    CHECK (maintenance_message IS NULL OR char_length(maintenance_message) <= 500),
  CONSTRAINT platform_mobile_config_min_version_format
    CHECK (min_app_version IS NULL OR min_app_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  CONSTRAINT platform_mobile_config_update_url_https
    CHECK (update_url IS NULL OR update_url ~ '^https://'),
  CONSTRAINT platform_mobile_config_announcement_object
    CHECK (announcement IS NULL OR jsonb_typeof(announcement) = 'object')
);

ALTER TABLE public.platform_mobile_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_mobile_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_mobile_config_read ON public.platform_mobile_config;
CREATE POLICY platform_mobile_config_read ON public.platform_mobile_config
  FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.platform_mobile_config (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_platform_mobile_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_platform_mobile_config ON public.platform_mobile_config;
CREATE TRIGGER trg_touch_platform_mobile_config
  BEFORE UPDATE ON public.platform_mobile_config
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_platform_mobile_config();

GRANT SELECT ON public.platform_mobile_config TO authenticated;
GRANT ALL ON public.platform_mobile_config TO service_role;
