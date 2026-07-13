-- Migration 00068: Add stripe_customer_id to subscriptions for invoice queries

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

DO $$ BEGIN
  ALTER TABLE subscriptions
    ADD CONSTRAINT chk_stripe_customer_format
    CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^[a-f0-9]{24}$' OR stripe_customer_id ~ '^cus_[a-zA-Z0-9]+$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;