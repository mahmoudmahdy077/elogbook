# Storage quotas + antivirus (P6.9)

## Per-tenant quota

Migration `00061_storage_quotas.sql` adds:

- `subscription_plans.storage_quota_mb` (default 1GB) with sensible
  seeds for the four canonical plans (256MB / 1GB / 5GB / 25GB / 100GB).
- A `tenant_storage_usage_mb` view that joins `tenants`, `storage.objects`,
  `subscriptions`, and `subscription_plans` to expose `used_mb` and
  `quota_mb` per tenant.

The case-attachments bucket enforces the per-file 20MB limit via
`[storage] file_size_limit` in `config.toml`. The per-tenant total
is enforced in the bucket INSERT policy: uploads above the plan's
`storage_quota_mb` are rejected with `402 Payment Required`.

## Antivirus — DEFERRED

ClamAV / S3-AV scanning is **not** part of Phase 6. It would require
a sidecar service to be deployed alongside the Supabase stack
(either a long-running ClamAV daemon or a third-party service like
Cloudmersive / VirusTotal).

When added, the hook is:

1. A Postgres trigger on `storage.objects` (INSERT) that, for the
   `case-attachments` bucket, copies the object to a quarantine
   bucket and calls the AV service.
2. The AV service responds with `clean` / `infected` / `error`.
3. On `clean`, the original object is released; on `infected`, both
   objects are deleted and an `audit_logs` row is written with
   `action = 'av_quarantine'`.
4. On `error`, the object is held in quarantine for manual review.

The wiring point in the schema is `case_attachments` (created in
migration 00008), which already stores a `signature_sha256` for
integrity but no AV result column. Add `av_status TEXT` and
`av_scanned_at TIMESTAMPTZ` when this is implemented.

## Out of scope

This deferral is tracked in the Phase 6 gate verification. The plan
file lists it as a "documented gap" rather than a blocker.
