# Database backup strategy

Status: controlled backup flow. Production backup is not considered complete until KMS identity verification, encrypted artifacts, the secret-free manifest, every remote SHA-256 value, and object-lock enforcement have been verified in the approved remote store.

## Objectives

- Provisional RPO: 24 hours for the logical dump.
- Provisional RTO: 4 hours from incident declaration to a verified isolated service candidate.
- The operator must ratify or revise these targets after a measured restore drill.
- A successful `pg_dump`, a local directory, a `/tmp` directory, or an upload without remote checksum verification is not durable evidence.

## Operator decisions and blockers

- **Key management / KMS:** `OPERATOR DECISION REQUIRED` — approved provider or custody process, key version, access roles, rotation, recovery, `BACKUP_KMS_VERIFY_HOOK`, and evidence location. The hook receives the provider and key reference and must return `verified` before `pg_dump` starts.
- **Object storage:** `OPERATOR DECISION REQUIRED` — approved provider, region/residency, private namespace, `BACKUP_OBJECT_LOCK_MODE`, `BACKUP_OBJECT_LOCK_RETENTION_DAYS`, `BACKUP_OBJECT_LOCK_VERIFY_HOOK`, upload hook, remote checksum hook, and owner. Local placeholder keys are never production-approved.
- **BAA/vendor review:** `OPERATOR DECISION REQUIRED` — legal/security status, subprocessors, breach terms, and review date. Pending status blocks ePHI transfer.
- **Alerting:** `OPERATOR DECISION REQUIRED` — owner and escalation for backup, encryption, upload, checksum, decryption, and restore-hook failures.

This repository does not select a cloud provider or KMS and does not claim legal certification.

## Backup flow

`backup-db.sh` is the scheduled production entry point. It accepts discrete `PGHOST`, `PGPORT`, `PGUSER`, and `PGDATABASE` values plus an owner-only `PGPASSFILE`. Database URLs and password-bearing process arguments are rejected by the flow.

The script:

1. Sets `umask 077` and creates owner-only staging, backup, log, manifest, and checksum paths.
2. Validates the approved KMS provider, key reference, and executable `BACKUP_KMS_VERIFY_HOOK`, then requires `verified` before database content is dumped.
3. Runs `pg_dump` through a pipefail-protected compression pipeline and verifies the compressed result.
4. Encrypts the dump and any selected configuration source through an explicitly configured, approved encryption hook.
5. Writes a secret-free manifest and SHA-256 checksum file.
6. Verifies the local checksum set.
7. Uploads the encrypted dump, encrypted configuration, manifest, and checksum file through the approved storage hook.
8. Requires the remote checksum hook to return the matching SHA-256 for every object.
9. Requires `BACKUP_OBJECT_LOCK_VERIFY_HOOK` to confirm the configured lock mode and retention for every object.
10. Emits durable-success status only after all four remote checksum and object-lock verifications pass.

Production fails closed before dumping when the encryption provider/hook, KMS provider/reference/verification hook, or required connection settings are absent. It also fails closed before durable status when the storage provider, object-lock mode/retention/verification hook, upload hook, remote checksum hook, object prefix, or any verifier is absent or rejects the configured value. Hook errors and output are not copied into logs. A local test mode exists only for automated/local validation; it emits `LOCAL_TEST_ONLY`, does not upload, and must not be used as production evidence.

### Hook contract

Provider integrations are deliberately provider-neutral:

- Encryption hook: input path, output path; writes a non-empty encrypted artifact.
- KMS verify hook: KMS provider and key reference; prints `verified` only after the operator-approved key is confirmed usable for backup encryption.
- Upload hook: local path, remote object key, expected SHA-256; uploads to the approved private namespace.
- Remote verify hook: remote object key, expected SHA-256; prints exactly one 64-character hexadecimal digest.
- Object-lock verify hook: remote object key, approved mode, and retention days; prints `verified` only after remote retention is confirmed.
- Decryption hook: encrypted input path, plaintext output path; used only in an isolated restore.
- Post-restore hook: explicit disposable database name; runs RLS, tenant-isolation, audit, integrity, and readiness checks.

The operator must provision and review these hooks. The scheduled production workflow requires `BACKUP_KMS_PROVIDER`, `BACKUP_KMS_KEY_REFERENCE`, `BACKUP_KMS_VERIFY_HOOK`, `BACKUP_OBJECT_LOCK_MODE`, `BACKUP_OBJECT_LOCK_RETENTION_DAYS`, and `BACKUP_OBJECT_LOCK_VERIFY_HOOK` before it installs PostgreSQL tools or starts a dump. They are not silently replaced by a provider-specific command or an unapproved KMS.

## Retention and monitoring

`RETENTION_DAYS` applies only after durable remote verification and only to the local encrypted artifact set. Remote object-lock retention is configured separately through `BACKUP_OBJECT_LOCK_MODE` and `BACKUP_OBJECT_LOCK_RETENTION_DAYS` and independently checked for every object before durable status. The minimum retained set and storage quota are enforced by the application manager; an over-quota condition alerts rather than deleting below the floor.

Alert on:

- missing or invalid provider configuration;
- database dump or compression failure;
- encryption/decryption failure;
- KMS identity or key-availability verification failure;
- upload failure;
- local or remote checksum mismatch;
- object-lock mode or retention verification failure;
- restore-hook failure; and
- missed schedule or RPO breach.

Do not log connection strings, passwords, passfile contents, plaintext dumps, decrypted clinical values, or hook credentials.

## Restore drill

Use `docs/operations/backup-drill.md` for the quarterly procedure and `docs/upgrade/runbooks/restore.md` for the operator runbook. A drill must use a newly created disposable project/database, verify the manifest and remote checksums, run the post-restore hook, and record measured RPO/RTO and evidence links. It must not restore configuration files automatically or promote a disposable target to production without a separate approved change.

## Verification

```bash
bash -n scripts/backup-db.sh
bash -n scripts/restore-db.sh
node --test tests/security/backup-flow.test.mjs
```

Run the repository security checks and a real isolated drill only after the operator decisions above are complete. A local fixture pass is not a substitute for a provider acceptance test or a restore drill.
