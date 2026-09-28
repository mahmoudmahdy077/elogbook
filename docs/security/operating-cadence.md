# Security operating cadence

**Status:** Draft operating procedure — not certified
**Review date:** 2026-09-24
**Accountable owner:** Security and Privacy Operations

## Purpose

This cadence turns repository controls into repeatable reviews without treating a passing test as legal approval. The cadence has named owners, evidence locations, escalation paths, and expiry dates for residual risk.

## Monthly

| Activity | Owner | Required evidence | Escalation |
|---|---|---|---|
| Run compliance evidence validation | Security Operations | `node scripts/verify-compliance-evidence.mjs` output and validator test | Any finding blocks the evidence record; owner is assigned from the matrix |
| Review open exceptions | Exception owners | Status, compensating control, expiry, and next action | Exception within 30 days of expiry goes to the accountable owner |
| Sample authorization and audit alerts | Security Operations | Redacted event IDs, actor/tenant IDs, and disposition | Repeated cross-tenant denial or unexpected export opens an incident |
| Review secret, dependency, and container findings | Platform and Release Engineering | Redacted gate output, finding count, and disposition | High/critical finding blocks promotion |
| Verify backup and alert delivery | Operations | Schedule result, remote checksum status, alert delivery test | Missed backup, checksum mismatch, or missing alert opens an incident |

The validator intentionally reports only paths, line numbers, rule names, redacted messages, and stable hashes where needed. It must not print credentials or PHI.

## Quarterly

| Activity | Owner | Required evidence | Stop condition |
|---|---|---|---|
| Workforce and service access review | Identity Engineering and Security and Privacy Operations | Access export digest, role/status changes, revocations, approvals | Stale privileged access, suspended user access, or missing reviewer |
| Vendor and BAA review | Privacy and Compliance | Updated vendor register, agreement reference, subprocessors, region, retention | Any ePHI-capable vendor remains `pending` without an explicit block |
| Dependency and supply-chain review | Release Engineering | Frozen-install result, SBOM, pinned-input gate, vulnerability disposition | Mutable production input or unapproved high finding |
| Penetration or independent security test | Security Operations | Scope, tester, date, findings, retest, and evidence location | Open critical/high finding or unverified scope |
| Restore drill | Operations and Incident Response | Disposable target, manifest/checksum proof, integrity checks, measured RPO/RTO | Unverified artifact, failed post-restore checks, or unapproved target |
| Control and threat-model review | Security and Privacy Operations | Updated [threat model](threat-model.md), matrix, exceptions, and action log | New asset or threat without owner, test reference, or evidence path |
| Training completion review | People Operations | Workforce assignment and completion report | Authorized person lacks required training |

## Before production promotion

Release Engineering must require the protected release graph and run the security gates before approval. The current graph is checked by [the single release path gate](../../scripts/verify-single-release-path.mjs), the supply-chain gate by [the pinned-input checker](../../scripts/verify-pinned-supply-chain.mjs), and release artifacts by [the release evidence verifier](../../scripts/verify-release-evidence.mjs). Deterministic inventory mode proves only that lockfile, manifest, Dockerfile, SBOM, and evidence hashes were collected reproducibly; deterministic inventory is not promotion evidence.

Promotion requires every release artifact and provenance record to be signed and verified through the configured release verifier, plus a commit-bound attestation checked by `RELEASE_ATTESTATION_VERIFIER`. Production environment controls must be independently checked by `PRODUCTION_ENVIRONMENT_VERIFIER`; repository source and generated inventory do not establish those controls. Current generated evidence is unsigned with no attestations and production controls remain pending, so promotion is blocked until the external decision in `EXC-RELEASE-ATTESTATION` is resolved.

The promotion review records the commit, lockfile digests, required job results, signing/attestation verification, production environment control verification, staging approval, mobile artifact provenance, and any accepted exception. A failing gate is not bypassed by an environment variable.

## Alert ownership

- **Authentication and authorization:** Identity Engineering; escalate repeated denials, privilege changes, or cross-tenant attempts to Security Operations.
- **Secrets and service credentials:** Security and Release Operations; rotate or revoke through provider procedures and record only redacted evidence.
- **Attachments and quarantine:** Application and Platform Engineering; reject uploads before storage when no approved scanner connector is configured, and keep all stored objects unavailable for download until a future reviewed release transition.
- **Backups and restore:** Operations and Incident Response; treat a local-only run as non-durable until KMS identity, remote checksums, and remote object-lock verification pass.
- **Vendor and privacy events:** Privacy and Compliance; stop ePHI transfer when the vendor status is `pending`.
- **Mobile qualification:** Mobile Engineering; keep production plaintext local storage disabled until the exception is closed.

## Exception handling

Every exception in [the exception register](exception-register.yaml) has an owner, compensating control, review date, and expiry. At 30 days before expiry, the owner must renew with evidence, reduce the exposure, or close the affected control. At expiry, [the validator](../../scripts/verify-compliance-evidence.mjs) fails the evidence set until the register is updated.

## Evidence retention and review

Use the schedules in [the retention policy](retention-policy.md). Preserve gate output and decision records in the approved evidence system, not in a public issue or an unredacted local report. The repository copies are indexes and source references; the accountable owner records the authoritative review artifact and digest.

## Current external blockers

The repository cannot close provider credential rotation, vendor/BAA approval, backup provider/KMS selection, scanner selection, mobile native qualification, external release attestation, training completion, or monitored security-contact activation. These blockers are enumerated with owners and expiry dates in [the exception register](exception-register.yaml). This document does not convert a blocker into a compliance claim.
