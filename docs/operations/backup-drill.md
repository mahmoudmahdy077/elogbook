# Backup and restore drill

Status: implementation gate. A backup is not considered durable until KMS identity, encrypted objects, SHA-256 values, and remote object-lock enforcement have been verified in the configured remote store. Local files, `/tmp`, a local fixture, and a successful `pg_dump` are staging evidence only. A local fixture result is not production evidence.

## Recovery objectives

The following are provisional operating targets, not a compliance certification:

- RPO: 24 hours for the logical dump until the approved durable-store and recovery-point controls are measured.
- RTO: 4 hours from incident declaration to a verified, isolated service candidate.
- The operator must ratify or revise both targets after a measured drill and record the decision owner and approval date.

## Required operator decisions

These decisions are intentionally unresolved. Do not place ePHI in a backup destination until each applicable decision is approved and recorded.

- **Key management / KMS:** `OPERATOR DECISION REQUIRED` — name the approved key service or custody process, key identifier and version, rotation interval, recovery ceremony, access roles, `BACKUP_KMS_VERIFY_HOOK`, and evidence location. The hook must confirm the named key before `pg_dump`; the repository does not select a KMS.
- **Object storage:** `OPERATOR DECISION REQUIRED` — name the approved storage service, region and residency constraints, private bucket or equivalent, object-lock mode and retention, `BACKUP_OBJECT_LOCK_VERIFY_HOOK`, least-privilege upload/read roles, upload hook, remote checksum hook, and retention owner. The repository does not select a provider.
- **BAA and vendor review:** `OPERATOR DECISION REQUIRED` — legal/security must record vendor eligibility, BAA status, subprocessor list, breach-notification terms, and the date of review. A missing or pending BAA is a release blocker for ePHI.
- **Alerting and ownership:** `OPERATOR DECISION REQUIRED` — assign the backup failure, checksum mismatch, decryption failure, and restore-drill alert owners and escalation path.

## Backup contract

`scripts/backup-db.sh` accepts only discrete libpq settings: `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and an owner-only `PGPASSFILE`. It does not accept a database URL. The process runs with `umask 077`; staging, directories, logs, encrypted objects, manifests, and checksum files are owner-only.

The production path requires all of the following and fails closed when any is absent:

1. An explicitly named, approved encryption provider and executable encryption hook.
2. An approved KMS provider and key reference plus an executable `BACKUP_KMS_VERIFY_HOOK` that returns `verified` before database content is dumped.
3. An explicitly named, approved storage provider and executable upload hook.
4. An executable remote checksum hook.
5. An approved `BACKUP_OBJECT_LOCK_MODE`, a retention from 1 through 3650 days, and an executable `BACKUP_OBJECT_LOCK_VERIFY_HOOK`.
6. A private object prefix and a non-empty local retention policy.

The hook contracts are provider-neutral. An encryption hook receives an input path and an output path and writes an encrypted artifact. The KMS verification hook receives the provider and key reference and must return `verified` before the dump. An upload hook receives the local path, remote object key, and expected SHA-256. A remote verify hook receives the remote object key and expected SHA-256 and must print exactly one 64-character hexadecimal digest. The object-lock hook receives the remote key, mode, and retention days and must return `verified` for every object. Hook output and errors are not copied into logs.

The script verifies the approved KMS key before dumping. It then writes a secret-free JSON manifest and SHA-256 checksum file, verifies the local checksum set, uploads the encrypted dump, encrypted configuration, manifest, and checksum file, compares every remote digest, and verifies object-lock mode and retention for every object before emitting a durable-success status. A local test mode is available only for automated/local validation; it emits `LOCAL_TEST_ONLY`, performs no remote upload, and must never be used as production evidence.

## Drill prerequisites

- A current, owner-only copy of the approved encryption/decryption hooks and their provider configuration.
- The named KMS provider/key reference and a working `BACKUP_KMS_VERIFY_HOOK` that confirms the key before any dump.
- Access to the approved private object store through the operator-configured upload, remote checksum, and object-lock verification hooks, without putting credentials in shell history or process arguments.
- The artifact, manifest, and checksum retrieved into an owner-only temporary directory.
- A newly created disposable project/database that has no production traffic, no production integrations, and no shared storage or credentials.
- A current set of RLS, audit, and migration tests.
- A named incident/change owner and a place to store the drill report.

## Drill procedure

1. Record the incident or exercise ID, operator, start time, intended recovery point, selected artifact key, KMS provider/key reference digest, object-lock mode/retention, and evidence links. Do not record credentials, raw key references, or decrypted clinical data.
2. Create an owner-only working directory and download the manifest, checksum file, encrypted database artifact, and encrypted configuration artifact. Reject symlinks, path traversal, missing files, and an object whose key does not match the manifest.
3. Run the restore command with an explicit disposable target:

   ```bash
   bash scripts/restore-db.sh \
     --artifact <encrypted-database-object> \
     --manifest <backup-manifest> \
     --checksum <sha256-from-manifest> \
     --target-database <new-disposable-database> \
     --disposable-target
   ```

   The restore script requires `PGHOST`, `PGPORT`, `PGUSER`, and an owner-only `PGPASSFILE`. It rejects an unknown checksum, a manifest mismatch, path traversal, a missing target, a missing decryption hook, or a missing post-restore hook. It does not restore configuration files automatically.
4. Run the configured post-restore hook against the disposable database. The hook must fail closed if any check fails. It must cover:
   - core table presence and expected non-empty counts;
   - `relrowsecurity` and `relforcerowsecurity` for public tables;
   - anonymous and cross-tenant negative cases;
   - suspended principal and tenant denial;
   - append-only audit behavior and audit redaction;
   - migration/schema version and required extensions;
   - attachment/storage authorization boundaries.
5. Run the repository's applicable SQL and web security tests against the disposable environment. Do not substitute a UI smoke test for RLS or audit checks.
6. Record the actual RPO and RTO, artifact digest, target identity, check results, evidence links, failures, and owner sign-off. Do not copy decrypted data into the report.
7. Destroy or retain the disposable target according to the approved evidence-retention policy. A failed or partially restored target remains quarantined until the owner records its disposition.

## Pass criteria

A drill passes only when:

- the named KMS key and object-lock mode/retention were independently verified;
- the remote object and local manifest agree on every SHA-256;
- remote object-lock verification passed for every uploaded object;
- decryption and restore complete without hidden repair steps;
- the target was explicitly disposable and isolated;
- post-restore RLS, tenant-isolation, audit, and integrity checks pass;
- no secret or full database URL appeared in argv, logs, or evidence; and
- the measured RPO/RTO and all operator-decision placeholders are recorded.

A local artifact, a successful dump command, or a successful upload without remote checksum verification is not a pass.
