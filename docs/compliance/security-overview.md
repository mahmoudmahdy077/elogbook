# Security overview

**Status:** Draft — not certified
**Review date:** 2026-09-24
**Accountable owners:** Security Engineering and Privacy and Compliance

## Architecture diagram

```text
[Client] --TLS--> [Web/API boundary] --> [Supabase Auth] --> [Postgres + RLS]
                         |                       |                    |
                    [Request guard]        [Server context]    [Metadata audit]
                         |                       |                    |
               [Scanner gate]           [Outbound policy]     [Evidence gates]
```

The web and mobile clients do not provide authorization evidence. The server derives identity, tenant, role, account status, and assurance from the authenticated session and database. PostgreSQL row-level security and operation-specific policies are implemented and tested in the [principal-status migration](../../supabase/migrations/20260923000002_authoritative_principal_status.sql) and [policy regression suite](../../supabase/tests/p1_21_policy_convergence.sql).

## Data and cryptographic boundaries

The repository contains reviewed application-level cryptographic paths for selected secret and field values, including the [secret and idempotency migration](../../supabase/migrations/20260923000005_secret_idempotency_quota_guards.sql). This is a field- and mechanism-specific statement, not a blanket whole-database claim. TDE status for the deployed database is provider-dependent and is not established by repository source alone; see the open decision in [the exception register](../security/exception-register.yaml).

Transport security is enforced by the application and deployment boundary. Outbound requests are constrained by [the shared URL policy](../../packages/shared/src/security/outbound-url.ts) and [the request guard](../../apps/web/lib/http/request-guard.ts). Provider, DNS, certificate, and egress evidence must be recorded for the actual environment.

## Threat and control summary

| Threat | Mitigation | Evidence |
|---|---|---|
| Unauthorized or cross-tenant PHI access | Server-derived context, RLS, `FORCE RLS`, status checks, and negative tests | [policy tests](../../supabase/tests/p1_18_principal_status_rls.sql), [security context](../../apps/web/lib/supabase/security-context.ts) |
| Data-at-rest exposure | Mechanism-specific field/secret protection; production backup KMS and object-lock verification are required before durable status | [control matrix](hipaa-control-matrix.yaml), [backup strategy](../backup-strategy.md) |
| Data-in-transit interception | TLS deployment requirement and bounded outbound request policy | [request guard](../../apps/web/lib/http/request-guard.ts), [Caddy configuration](../../config/Caddyfile) |
| Injection and authorization bypass | Server validation, route guards, database predicates, and role-specific tests | [request guard](../../apps/web/lib/http/request-guard.ts), [policy convergence](../../supabase/tests/p1_21_policy_convergence.sql) |
| Tenant cross-contamination | Tenant predicates in both read and write paths; service-role use is reviewed | [tenant role migration](../../supabase/migrations/20260923000003_tenant_role_policy_convergence.sql) |
| Key or credential exposure | Server-only secrets, redaction, containment, and operator rotation | [secret containment](../../scripts/verify-secret-containment.mjs), [incident record](../security/incidents/2026-09-23-service-role-exposure.md) |
| Unsafe attachment release | Reject uploads before storage while the approved scanner registry is empty; durable pending state, bounded scanning, privileged-transition gating, and owner/role authorization for a future reviewed connector | [scanner configuration](../../apps/web/lib/attachments/scanner-config.ts), [attachment migration](../../supabase/migrations/20260925000006_attachment_scanner_release_gate.sql), [attachment tests](../../tests/security/attachment-broker-boundary.test.mjs) |
| Unsafe email delivery or webhook processing | Metadata-only operational templates, scoped preferences, mandatory pre-send audit, signed allowlisted webhooks, replay handling, and sanitized provider errors | [email safety](../../packages/shared/src/email/safety.ts), [email migrations](../../supabase/migrations/20260925000007_email_operational_safety.sql), [email containment tests](../../tests/security/email-containment.test.mjs) |
| PHI leakage in audit or observability | Metadata-only audit allowlists and recursive redaction | [metadata audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql), [redaction tests](../../apps/web/lib/__tests__/logger.observability.test.ts) |

Audit coverage is control-specific. Database triggers and reviewed application routes record selected security and mutation events; they do not establish blanket read auditing for every PHI query. The [metadata audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql) intentionally records identifiers, action names, and changed-field names rather than complete clinical rows.

## Secrets management

- Server-only values are injected through the deployment environment or an approved secret manager; no secret value belongs in source, evidence, or ordinary logs.
- Service-role use is limited to reviewed server paths and is covered by the [incident response record](../security/incidents/2026-09-23-service-role-exposure.md).
- The suspected credential remains a release blocker until provider-side rotation and old-credential rejection are recorded in the [exception register](../security/exception-register.yaml).
- Rotation evidence is metadata-only; the [secret containment gate](../../scripts/verify-secret-containment.mjs) emits redacted findings only.

## Incident response runbook

1. **Triage:** Classify severity using the [security policy](../../SECURITY.md), identify affected systems, and preserve a redacted timeline.
2. **Contain:** Stop unsafe promotion paths, revoke sessions, rotate provider credentials, and preserve the [incident record](../security/incidents/2026-09-23-service-role-exposure.md).
3. **Investigate:** Correlate redacted security events, access-review records, and gate output. Do not replay or export clinical values into ordinary tooling.
4. **Remediate:** Apply a reviewed code, configuration, database, or provider change; do not weaken RLS, authentication, upload, or request controls to make a test pass.
5. **Recover:** Use the [restore runbook](../upgrade/runbooks/restore.md) only for a verified artifact and an explicitly disposable target.
6. **Review:** Complete the post-incident review, update the [threat model](../security/threat-model.md), and renew or close each affected exception.

## Vendor and legal boundary

The [vendor register](vendor-register.yaml) records the owner and evidence for each service. Unknown BAA, legal, retention, region, and subprocessor decisions remain `pending`; the repository does not infer approval from a provider name or from passing tests. Contact routes and incident escalation addresses must be replaced by monitored production contacts before public launch.

## AI feature policy

AI requests are de-identified by application policy and are bounded by [the AI guard](../../supabase/functions/_shared/ai-guard.ts). Provider terms, retention, training use, region, and BAA status remain pending in [the vendor register](vendor-register.yaml). Model output is validated before persistence, rendering, tool invocation, or external communication; the boundary is tested by [the AI boundary tests](../../packages/shared/src/schemas/__tests__/ai-boundaries.test.ts).
