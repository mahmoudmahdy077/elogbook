# Data Classification

## Classes

| Class | Definition | Examples | Tables/Fields |
|-------|------------|----------|---------------|
| **Direct Identifier** | Data that directly identifies a person | MRN, SSN, full name, email | `profiles.full_name`, `auth.users.email`, `case_entries.patient_mrn` |
| **Quasi-Identifier** | Data that could identify a person in combination | DOB, ZIP, specialty, procedure date | `case_entries.patient_dob`, `profiles.specialty` |
| **Clinical Record** | Protected health information in case data | Procedure notes, field_values | `case_entries.field_values`, `case_entries.patient_hash` |
| **Credentials** | Authentication and API secrets | Passwords, API keys, tokens | `ai_config.api_key_enc`, `payment_gateway_config.*_enc`, `tenant_webhooks.secret_enc` |
| **Audit Data** | System access and change logs | Audit log entries | `audit_logs.*` |
| **Telemetry** | Anonymous usage and error data | Page views, error events | Sentry/PostHog data (external) |
| **Derived/AI** | Computed summaries, AI output | Aggregates, AI suggestions | `ai_response_cache.*`, `benchmark_data.*` |

## Handling Rules

| Class | Storage | Transmission | Retention | Export |
|-------|---------|--------------|-----------|--------|
| Direct Identifier | Encrypted at rest, RLS-scoped | TLS required | As required by law | Restricted to authorized personnel |
| Quasi-Identifier | RLS-scoped | TLS required | Per tenant policy | De-identified unless authorized |
| Clinical Record | Encrypted PHI, RLS-scoped | TLS required, no browser logs | Per tenant policy | Audited, role-gated |
| Credentials | Encrypted (`_enc` columns) | Never in browser bundles | Rotated periodically | Never exported |
| Audit Data | Append-only, RLS-scoped | TLS required | Retention policy enforced | Director+ only |
| Telemetry | External (Sentry/PostHog) | Opt-in, privacy-reviewed | Per provider policy | Not applicable |
| Derived/AI | RLS-scoped | TLS required | Per tenant policy | With disclaimers |

## Export Restrictions

- WebADS export: disabled by default (P1.2.4)
- CSV exports: max 1,000 rows (time-limited), role-gated
- Audit exports: max 10,000 rows, director+ only
- Direct identifier exports: require specific legal authorization
