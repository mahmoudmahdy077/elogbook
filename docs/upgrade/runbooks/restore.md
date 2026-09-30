# Runbook: Restore an encrypted backup

Audience: platform operator at AAL2. Restore is a deliberate, evidence-producing operation. It is not an automatic recovery button and must never target the live database during a drill.

Status: the shell flow is fail-closed, but production recovery remains blocked until the approved key-management, object-store, alerting, and BAA decisions are recorded.

## 1. Declare and fence

1. Open an incident/change record with a named owner, approver, start time, and reason for recovery.
2. Stop application writers, imports, scheduled jobs, and sync traffic before touching a target.
3. Preserve the backup log, selected object metadata, manifest, and audit evidence. Do not paste credentials or decrypted records into the incident record.
4. Choose the recovery point from the newest artifact whose manifest and remote SHA-256 values verify. Record the exact recovery point and the data-loss window.

## 2. Verify the artifact

The restore script accepts only an encrypted artifact, its secret-free manifest, an explicit SHA-256 value, an explicit disposable target, and a post-restore checks hook.

- Download into an owner-only directory.
- Confirm the object key and artifact filename agree with the manifest.
- Confirm the checksum is exactly 64 hexadecimal characters and matches the manifest.
- Reject path traversal, symlinks, missing artifacts, unknown formats, and a checksum mismatch.
- Do not decrypt or restore configuration files as part of the database drill. Configuration recovery requires its own approved change record.

```bash
bash scripts/restore-db.sh \
  --artifact <encrypted-database-object> \
  --manifest <backup-manifest> \
  --checksum <sha256> \
  --target-database <new-disposable-database> \
  --disposable-target
```

The connection environment is discrete: `PGHOST`, `PGPORT`, `PGUSER`, and an owner-only `PGPASSFILE`. The restore script rejects a full database URL and a password-bearing process argument. The decryption hook and the post-restore checks hook are required and are selected by the operator-approved provider configuration.

## 3. Isolate the target

The target must be a newly created disposable database or disposable project. Before running the restore, verify that it:

- has no production traffic or integrations;
- uses separate credentials and separate storage;
- has no shared application role or audit sink;
- can be destroyed without affecting the live service; and
- is covered by the recorded RLS/audit test plan.

If the target is not demonstrably disposable, stop. Do not proceed by removing the `--disposable-target` confirmation or by reusing a production database name.

## 4. Run the post-restore gate

The post-restore hook runs after `psql` exits successfully and must fail the operation if any check fails. Its evidence must include, without clinical values:

- core table and row-count checks;
- `relrowsecurity` and `relforcerowsecurity` checks for public tables;
- anonymous, cross-tenant, suspended-user, and suspended-tenant denial checks;
- append-only audit checks and audit-redaction checks;
- migration/schema version, extension, and attachment/storage authorization checks;
- application readiness and login smoke checks after the database gates pass.

Review failures rather than disabling RLS, broadening grants, deleting audit rows, or applying an unreviewed repair migration.

## 5. Measure and decide

Record:

- incident start, restore start, and service-candidate ready time;
- selected artifact, manifest digest, and verified remote digests;
- measured RPO and RTO against the provisional 24-hour RPO and 4-hour RTO;
- every failed check, containment action, and owner decision; and
- the disposition of the disposable target.

The operator must ratify the RPO/RTO after the drill. A drill with an unverified checksum, missing isolation, failed RLS/audit check, or missing post-restore evidence is a failed drill even if the SQL import returned zero.

## Rollback and escalation

- If the target fails validation, quarantine it and create a new disposable target. Do not retry against the live target.
- If remote verification or decryption fails, preserve the artifact and logs, rotate the relevant access only under the incident process, and open a security/operations escalation.
- If a production restore is later approved, fence writers again, repeat the verification and post-restore gates, obtain the named approval, and retain the same evidence. There is no automatic in-place promotion from this runbook.
- If encryption, object-store, or BAA ownership is unresolved, the external-provider requirement is a release blocker; do not improvise a provider or move ePHI to an unapproved destination.

## Operator decision record

Complete these fields before production use:

- Key-management/KMS owner and approved custody process: `OPERATOR DECISION REQUIRED`.
- Object-store provider, region, retention, access roles, and upload/checksum hooks: `OPERATOR DECISION REQUIRED`.
- Vendor/BAA status and review date: `OPERATOR DECISION REQUIRED`.
- Alert owner and escalation path: `OPERATOR DECISION REQUIRED`.
- Ratified RPO/RTO after the first successful drill: `OPERATOR DECISION REQUIRED`.
