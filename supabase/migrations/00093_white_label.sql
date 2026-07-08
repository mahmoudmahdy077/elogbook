-- Migration 00093: White-Label / Custom Branding (Phase 6 - Enterprise)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_branding JSONB DEFAULT '{}';
