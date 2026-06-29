-- ============================================================================
-- 00060_consent_types_extension.sql
--
-- Phase 6 / P6.6
--
-- Extends the `consent_records.consent_type` enum to include the values
-- required by the P6.6 consent management UI:
--   - 'research'    : aggregate research access (tenant research programs)
--   - 'analytics'   : PostHog / product analytics
--   - 'data_sharing': inter-tenant / inter-institution sharing
--
-- The original four values from migration 00013 are preserved.
-- ============================================================================

ALTER TABLE public.consent_records
  DROP CONSTRAINT IF EXISTS consent_records_consent_type_check;

ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_consent_type_check
  CHECK (consent_type IN (
    'data_processing',
    'ai_insights',
    'data_export',
    'marketing',
    'research',
    'analytics',
    'data_sharing'
  ));
