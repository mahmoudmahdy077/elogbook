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

- **Security team:** security@example.com
- **Engineering lead:** eng-lead@example.com
- **Incident hotline:** +1-555-000-9999 (24/7 for critical incidents)
