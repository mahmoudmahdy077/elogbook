# HIPAA-aware security documentation

**Status:** Draft — not certified
**Review date:** 2026-09-24
**Accountable owners:** Privacy and Compliance and Security Engineering

This document describes technical safeguards and evidence collection. It does not certify HIPAA compliance, establish a legal conclusion, or substitute for a signed BAA, risk analysis, workforce evidence, or independent assessment.

## Data flow and minimum necessary use

Clinical workflows are designed around tenant-scoped records. The schema and application may contain `patient_mrn`, `patient_dob`, and `field_values`; access to those values is limited by server context, database policy, route authorization, and the minimum-necessary workflow. The control inventory and evidence links are maintained in [the HIPAA control matrix](hipaa-control-matrix.yaml).

Do not treat a field-name inventory as proof that all ePHI is discovered, protected, or monitored. New data categories, exports, AI inputs, attachments, and vendor transfers require a control review and a named owner.

## Cryptographic boundaries

Selected secret and application-field paths use reviewed cryptographic functions, with the implementation and failure behavior recorded in [the secret and idempotency migration](../../supabase/migrations/20260923000005_secret_idempotency_quota_guards.sql) and its tests. This statement is limited to the named mechanism and does not claim blanket whole-database protection.

TDE for the deployed database, provider-managed key custody, backup encryption, and mobile database protection are deployment- and vendor-dependent decisions. They are not established by this repository alone. The open decisions and compensating controls are recorded in [the exception register](../security/exception-register.yaml). The [backup strategy](../backup-strategy.md) describes the required hook and checksum evidence without selecting a provider.

Transport security is required at deployment. The application-side outbound boundary and response limits are implemented in [the shared URL policy](../../packages/shared/src/security/outbound-url.ts) and [the request guard](../../apps/web/lib/http/request-guard.ts); environment certificate and provider evidence must still be captured during qualification.

## Access controls

- Authenticated identity, account status, tenant status, role, and AAL are resolved server-side in [the security context](../../apps/web/lib/supabase/security-context.ts).
- Database access uses RLS, `FORCE RLS`, tenant predicates, and operation-specific policies. The [principal-status tests](../../supabase/tests/p1_18_principal_status_rls.sql) and [policy convergence tests](../../supabase/tests/p1_21_policy_convergence.sql) are required regression evidence.
- Privileged web and mobile operations fail closed when status, tenant, role, or assurance is missing. The [threat model](../security/threat-model.md) records the periodic workforce and service-account reconciliation.
- Service-role paths are reviewed server surfaces; no service-role value is copied into evidence or passed to a client.

## Audit controls and limitations

The [metadata-only audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql) records an allowlist of identifiers, action names, and changed-field names for covered tables. The [audit regression suite](../../supabase/tests/p1_19_audit_secret_idempotency.sql) checks that clinical values, patient identifiers, and arbitrary nested payloads are not copied into audit changes.

This is not blanket PHI auditing. Read coverage, provider logs, Edge Function logs, exports, backups, and external monitoring must be inventoried separately. [The threat model](../security/threat-model.md) records the residual coverage question and the evidence required to close it.

## Contingency planning

[the backup strategy](../backup-strategy.md) requires discrete connection settings, owner-only passfiles, an approved encryption hook, private permissions, remote checksums, and a disposable restore target. A local fixture pass is not durable backup evidence. Storage, KMS, retention, BAA posture, and measured RPO/RTO remain open in `EXC-BACKUP-REVIEW`.

## Incident and breach response

1. Detect through approved security monitoring and the [operating cadence](../security/operating-cadence.md).
2. Contain by stopping unsafe promotion, revoking sessions, and rotating affected credentials through provider procedures.
3. Preserve redacted evidence, event IDs, timestamps, and artifact digests in the approved evidence store.
4. Investigate scope using access-review, audit, and gate records without copying clinical values into ordinary tooling.
5. Notify legal, privacy, security, and operational owners through the approved incident process. The applicable notification deadlines and obligations must be determined by counsel; this document does not provide a legal deadline determination.
6. Complete remediation, a post-incident review, and an exception decision before resuming the affected workflow.

The suspected service-role exposure is tracked in [the incident record](../security/incidents/2026-09-23-service-role-exposure.md). Provider-side rotation and old-credential rejection are required before production deployment or real ePHI processing.

## Vendor and BAA process

The [vendor register](vendor-register.yaml) is the source for service owner, data categories, BAA status, review date, and evidence. Unknown legal or vendor status is `pending`, never `complete`. No ePHI-capable vendor is treated as approved merely because its integration exists in source. Privacy and Compliance must record the applicable agreement or legal determination, subprocessors, region, retention, incident terms, and review approval.

## Review and evidence

Run [the compliance evidence validator](../../scripts/verify-compliance-evidence.mjs) and [the compliance evidence test](../../tests/security/compliance-evidence.test.mjs) as part of security CI. The validator fails on missing required fields, ownerless controls, missing evidence paths, unsupported affirmative claims without links, and expired exceptions. It emits redacted findings only.
