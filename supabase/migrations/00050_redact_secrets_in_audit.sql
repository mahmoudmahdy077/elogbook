-- ============================================================================
-- 00050_redact_secrets_in_audit.sql
--
-- Phase 0 / P0.7
--
-- Stop writing encrypted (and any deprecated plaintext) secret columns
-- into audit_logs.changes. Today the audit trigger serializes the entire
-- NEW/OLD row, which means a copy of every gateway key and AI key is
-- persisted in audit_logs on every UPDATE — defeating the point of
-- encryption-at-rest and creating a second copy of the secret under a
-- less-protected table.
--
-- Fix: a dedicated audit_config_change() trigger that uses
--   jsonb_strip_nulls(row_to_json(NEW)::jsonb
--     - 'encrypted_api_key'
--     - 'encrypted_secret_key'
--     - 'encrypted_webhook_secret'
--     - 'api_key_enc'        -- deprecated plaintext aliases
--     - 'secret_key_enc'     -- (no-op if absent)
--     - 'webhook_secret_enc'
--   )
-- The `-` operator is a no-op when the key is absent, so this is safe
-- across the current and any legacy column set.
--
-- Attached to:
--   ai_config
--   payment_gateway_config
--
-- No test file: there are no seed rows in the public dev environment
-- we can reliably mutate in a regression transaction; the value here
-- is in the column list itself, which is statically reviewable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Function: audit_config_change()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_config_change()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id        UUID;
  v_user_agent     TEXT;
  v_session_id     TEXT;
  v_ip             TEXT;
  v_payload        JSONB;
  v_changes        JSONB;
  v_old_redacted   JSONB;
  v_new_redacted   JSONB;
  v_action         TEXT;
BEGIN
  v_user_id    := auth.uid();
  v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  v_session_id := COALESCE(
    current_setting('request.headers', true)::JSONB ->> 'x-session-id',
    auth.jwt() ->> 'session_id'
  );
  v_ip         := current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for';

  -- Defense-in-depth: strip every column that has ever held a secret on
  -- these two tables, including the deprecated plaintext aliases. The
  -- jsonb `-` operator is a no-op when the key is absent.
  v_old_redacted := jsonb_strip_nulls(
    row_to_json(OLD)::JSONB
      - 'encrypted_api_key'
      - 'encrypted_secret_key'
      - 'encrypted_webhook_secret'
      - 'api_key_enc'
      - 'secret_key_enc'
      - 'webhook_secret_enc'
  );
  v_new_redacted := jsonb_strip_nulls(
    row_to_json(NEW)::JSONB
      - 'encrypted_api_key'
      - 'encrypted_secret_key'
      - 'encrypted_webhook_secret'
      - 'api_key_enc'
      - 'secret_key_enc'
      - 'webhook_secret_enc'
  );

  IF TG_OP = 'INSERT' THEN
    v_action  := 'INSERT';
    v_changes := jsonb_build_object(
      'new',           v_new_redacted,
      'user_agent',    v_user_agent,
      'session_id',    v_session_id
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_action  := 'UPDATE';
    v_changes := jsonb_build_object(
      'old',           v_old_redacted,
      'new',           v_new_redacted,
      'changed_fields',
        (
          SELECT jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val))
          FROM (
            SELECT key,
                   v_old_redacted -> key AS old_val,
                   v_new_redacted -> key AS new_val
            FROM jsonb_object_keys(v_old_redacted || v_new_redacted) AS t(key)
          ) sub
          WHERE old_val IS DISTINCT FROM new_val
            AND key NOT IN ('created_at', 'updated_at')
        ),
      'user_agent',    v_user_agent,
      'session_id',    v_session_id
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action  := 'DELETE';
    v_changes := jsonb_build_object(
      'old',           v_old_redacted,
      'user_agent',    v_user_agent,
      'session_id',    v_session_id
    );
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    v_user_id,
    v_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    v_changes,
    v_ip
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ---------------------------------------------------------------------------
-- 2. Triggers on ai_config and payment_gateway_config
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_ai_config          ON ai_config;
DROP TRIGGER IF EXISTS trg_audit_payment_gateway    ON payment_gateway_config;

CREATE TRIGGER trg_audit_ai_config
  AFTER INSERT OR UPDATE OR DELETE ON ai_config
  FOR EACH ROW EXECUTE FUNCTION audit_config_change();

CREATE TRIGGER trg_audit_payment_gateway
  AFTER INSERT OR UPDATE OR DELETE ON payment_gateway_config
  FOR EACH ROW EXECUTE FUNCTION audit_config_change();
