-- M3: durable queue idempotency key (local-first).
-- Deterministic convergence migration: adds client_operation_id for
-- client-generated op IDs. Server upserts on this key so duplicate retries
-- (crash between response and local delete, duplicate delivery) do not
-- create duplicate rows. Nullable for legacy rows; unique where not null.

ALTER TABLE case_entries
  ADD COLUMN IF NOT EXISTS client_operation_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ux_case_entries_client_op'
  ) THEN
    CREATE UNIQUE INDEX ux_case_entries_client_op
      ON case_entries (client_operation_id)
      WHERE client_operation_id IS NOT NULL;
  END IF;
END
$$;
