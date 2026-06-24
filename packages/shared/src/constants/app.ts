export const APP_NAME = 'E-Logbook';
export const APP_VERSION = '1.0.0';

/**
 * The UUID used for global/shared templates that are available across all tenants.
 * This is intentionally the nil UUID — it's a sentinel value for querying templates
 * that should be visible to all users regardless of tenant affiliation.
 * This is NOT a real tenant — it's a design pattern for multi-tenant template sharing.
 * @see supabase/migrations/00005_seed_data.sql
 */
export const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000';
