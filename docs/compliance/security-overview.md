# Security Overview

**Status: Draft — not certified**

## Architecture Diagram

```
[Client] --TLS--> [Supabase Auth] --> [Postgres + RLS]
                        |                    |
                   [JWT claims]        [pgp_sym_encrypt]
                        |                    |
                   [Audit Log] <--- [app.encryption_key]
```

The system consists of a web client communicating over TLS with Supabase Auth, which issues JWT claims. Access to Postgres is guarded by Row Level Security policies, and PHI fields are encrypted with `pgp_sym_encrypt` using `app.encryption_key`.

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Unauthorized PHI access | RLS policies + role hierarchy |
| Data at rest compromise | pgp_sym_encrypt + TDE |
| Data in transit interception | TLS 1.2+ |
| Injection attacks | Parameterized queries via Supabase client |
| Tenant cross-contamination | RLS per-tenant isolation, no shared schemas |
| Key exposure | Secrets manager + key rotation |

## Secrets Management

- `app.encryption_key` is stored in Supabase Secrets Manager.
- No secrets are committed to version control.
- Secrets are injected via environment variables at deploy time.
- Key rotation is performed on a schedule or immediately upon suspected compromise.

## Incident Response Runbook

1. **Triage** — Identify severity (low/medium/high/critical) based on data exposure risk.
2. **Contain** — For critical incidents, rotate secrets and revoke active sessions.
3. **Investigate** — Replay audit logs to determine root cause and affected records.
4. **Remediate** — Apply patches, update RLS policies, or rotate keys as needed.
5. **Post-mortem** — Document findings and update runbook within 72 hours.

## Contact

> **Pre-launch requirement:** replace the placeholder addresses below with the
> production security mailbox and incident hotline before the public launch
> (Task 8.1 of docs/LAUNCH_UPGRADE_PLAN.md). The mailboxes must be staffed and
> monitored. Until replaced, this document must not be shared as certified.

- **Security team:** security@example.com
- **Engineering lead:** eng-lead@example.com
- **Incident hotline:** +1-555-000-9999 (24/7 for critical incidents)

## AI Feature Policy

- AI insights (`ai-insights`) are de-identified-only by policy: the edge
  function returns 403 for any request where `is_deidentified !== true`.
- AI responses are screened by safety regexes (diagnosis/prescription/
  prognosis patterns) with per-chunk abort on streaming, and every response
  carries a mandatory educational disclaimer.
- Per-resident AI usage is quota-gated atomically in the database
  (`consume_ai_quota` / `release_ai_quota`); provider keys are encrypted at
  rest and only decryptable through service-role paths.
