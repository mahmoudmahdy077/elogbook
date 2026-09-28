# Retention and deletion policy

**Status:** Draft operating baseline — pending legal and privacy approval
**Review date:** 2026-09-24
**Owners:** Privacy and Compliance; Operations and Incident Response

## Policy boundary

This document defines a proposed retention schedule and the evidence needed to operate it. It is not legal advice, a HIPAA certification, a GDPR determination, or a promise that every jurisdiction has the same schedule. Counsel and the accountable privacy owner must approve the final schedule before production deletion behavior changes. The open decision is tracked as `EXC-PRIVACY-REVIEW` in [the exception register](exception-register.yaml).

The default operational rule is to retain the minimum evidence needed to investigate a security or privacy event, preserve legal holds, and avoid deleting a record that is under an active preservation request. Deletion does not override a legal hold, an active incident, a regulator request, or a contractual retention requirement.

## Proposed schedules

| Record class | Proposed minimum | Deletion or review trigger | Owner | Evidence |
|---|---:|---|---|---|
| Security and privacy control evidence | 6 years from control review or supersession | Quarterly review and approved supersession | Security and Privacy Operations | [control matrix](../compliance/hipaa-control-matrix.yaml), [compliance validator](../../scripts/verify-compliance-evidence.mjs) |
| Audit and security-event records | 6 years from event creation, subject to counsel | Legal hold, incident closure, and approved schedule | Security Operations | [metadata audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql), [audit regression tests](../../supabase/tests/p1_19_audit_secret_idempotency.sql) |
| Access reviews, role changes, and training completion | Duration of employment or engagement plus approved policy period | Termination, role change, or approved review cycle | Identity Engineering and People Operations | [access review](access-review.md), [exception register](exception-register.yaml) |
| Vendor and BAA review records | Term of service plus approved policy period | Vendor offboarding or next review | Privacy and Compliance | [vendor register](../compliance/vendor-register.yaml) |
| Encrypted backup artifacts and manifests | Operator-approved schedule, with a provisional 30-day local minimum | Remote retention/object-lock approval and successful restore verification | Operations and Incident Response | [backup strategy](../backup-strategy.md), [backup flow tests](../../tests/security/backup-flow.test.mjs) |
| Release manifests, SBOMs, and gate results | Release retention policy approved by Release Engineering | Artifact retention expiry or superseding release | Release Engineering | [release evidence verifier](../../scripts/verify-release-evidence.mjs), [operating cadence](operating-cadence.md) |
| Security-gate failure reports and redaction output | Until incident closure and approved evidence period | Closure approval and retention review | Security Operations | [secret containment gate](../../scripts/verify-secret-containment.mjs), [compliance evidence test](../../tests/security/compliance-evidence.test.mjs) |

The six-year documentation period is a proposed baseline for review, not a substitute for a jurisdiction-specific legal schedule. A shorter operational period may be used only after the accountable privacy owner records the basis.

## Data handling during retention

- Store audit and security evidence in access-controlled systems with tenant and role boundaries.
- Retain metadata, identifiers, action names, changed-field names, and decision context; do not add full clinical rows, raw prompts, request bodies, or credentials to an evidence record.
- Protect retained backup artifacts with the approved encryption and key-management mechanism. The [backup strategy](../backup-strategy.md) documents the hook contract; provider and KMS decisions remain pending in `EXC-BACKUP-REVIEW`.
- Keep mobile local clinical data disabled unless the native storage qualification exception is closed. Field-level AEAD coverage does not establish whole-database protection; see [the mobile decision](mobile-native-security.md).
- Preserve the original evidence digest and chain of custody when a record is exported for an investigation.

## Deletion procedure

1. Confirm the record class, jurisdiction, retention basis, legal-hold status, and accountable owner.
2. Obtain Privacy and Compliance approval for the deletion batch and record the approval reference.
3. Run the relevant integrity and authorization checks in a non-production or disposable environment.
4. Delete only the approved records and derived indexes, caches, and temporary copies.
5. Verify that ordinary logs and telemetry do not retain a prohibited copy.
6. Record the deletion job ID, scope, operator, timestamp, result, and evidence digest without recording clinical values or secrets.
7. If deletion fails, keep the record under hold or escalation; do not silently mark the schedule complete.

## Review triggers

Review this policy when a new data category is introduced, a vendor changes, a jurisdiction or contract changes, a legal hold is issued, a backup provider changes, a retention exception approaches expiry, or a security incident changes the evidence scope. The monthly and quarterly responsibilities are defined in [the operating cadence](operating-cadence.md), and expired exceptions are rejected by [the compliance evidence validator](../../scripts/verify-compliance-evidence.mjs).
