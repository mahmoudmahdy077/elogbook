# HIPAA Compliance

**Status: Draft — not certified**

## Data Flow

PHI fields are limited to:

- `patient_mrn`
- `patient_dob`
- `field_values`

All other patient-identifiable data is excluded from the database schema by design.

## Encryption at Rest

PostgreSQL is configured with `pgp_sym_encrypt` using the `app.encryption_key` application-level key. The key is stored in the Supabase secrets manager and injected at runtime. Database-level TDE is enabled on the Supabase Postgres instance.

## Encryption in Transit

All connections to the database and API are served over TLS 1.2+.

## Access Controls

- Row Level Security (RLS) policies restrict PHI access per tenant.
- Role hierarchy enforces least privilege (admin → editor → viewer).
- Database roles are mapped to application JWT claims.

## Audit Log Coverage

All PHI read/write operations are logged via Supabase Audit with the following fields: `user_id`, `table_name`, `operation`, `old_values`, `new_values`, `timestamp`. Logs are append-only and stored in a separate, RLS-protected schema.

## Breach Response Runbook

1. Detect: Monitor audit logs for anomalous PHI access (multiple failed RLS checks, bulk exports).
2. Contain: Rotate `app.encryption_key`, revoke compromised sessions, block source IPs.
3. Notify: Contact engineering lead within 1 hour of confirmed breach.
4. Investigate: Full audit log replay to determine scope.
5. Report: File HHS breach notification within 60 days (per 45 CFR § 164.406).

## BAA Process

**Currently N/A** — We do not sign Business Associate Agreements until a formal audit is completed and the system is certified. This document is a draft toward that goal.
