# GDPR-aware security documentation

**Status:** Draft — not certified
**Review date:** 2026-09-24
**Accountable owner:** Privacy and Compliance

This document records technical entry points and open privacy decisions. It is not a GDPR certification, legal opinion, or representation that a controller, processor, residency region, or retention schedule has been approved.

## Data access and portability

The tenant-scoped audit export route is an administrative security-evidence export, not a general-purpose copy of every record associated with a person. It returns bounded, tenant-filtered audit metadata and records the export action. See [the export route](../../apps/web/app/api/%5Btenant%5D/audit/export/route.ts), [the metadata audit migration](../../supabase/migrations/20260923000004_metadata_only_audit.sql), and [the control matrix](hipaa-control-matrix.yaml).

A person-level access or portability workflow must identify the data subject, lawful basis, tenant boundary, fields, recipients, and delivery method. The repository does not yet prove that the audit export satisfies a complete Article 15 or Article 20 request. The Privacy and Compliance owner must approve the workflow and record the decision.

## Erasure and retention

The [retention policy](../security/retention-policy.md) is a proposed operating baseline. It does not promise immediate erasure, override a legal hold, or establish a universal period. Deletion requires an approved record class, legal-hold check, jurisdictional basis, execution evidence, and verification that derived copies are removed.

The exception `EXC-PRIVACY-REVIEW` records the unresolved legal schedule, jurisdictions, holds, and approval authority. Production deletion behavior must not be enabled based only on this draft.

## Processor and vendor review

The [vendor register](vendor-register.yaml) records service owners, data categories, BAA/DPA status, review dates, and evidence. Unknown vendor or legal status remains `pending`. A provider integration does not establish processor eligibility, a DPA, a transfer mechanism, or a right to subprocess.

## Data residency and transfers

The actual Supabase project region, support access, backups, subprocessor locations, and cross-region replication are deployment facts that must be verified in the approved environment record. This document does not assume a region or guarantee that data remains in one geography. The [retention policy](../security/retention-policy.md), [threat model](../security/threat-model.md), and [vendor register](vendor-register.yaml) define the review questions.

## Rights requests and evidence

Privacy Operations should record the request identifier, identity verification, scope, search sources, decision, recipients, delivery digest, and deletion or restriction outcome in the approved evidence system. Do not put clinical values, credentials, or raw model content into a ticket or repository document. Security Operations reviews the associated access-review and audit evidence quarterly under [the operating cadence](../security/operating-cadence.md).

## Current limitations

The repository can provide technical routes, tests, and redaction controls. It cannot provide a complete rights-request record, a legal basis, a signed DPA, a residency attestation, or a regulator-ready response without operator and counsel evidence. Those gaps are tracked in [the exception register](../security/exception-register.yaml).
