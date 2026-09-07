# T18 Evidence — Tenant lifecycle (suspension slice)

Ticket: T18 (dependency: T17). Quotas, policy ceilings, versioned
settings, and support-grant consumption remain T18-full work.
Status: IMPLEMENTED (suspension lifecycle below)

## Delivered (T18a)

- Migration `20260907000003_tenant_lifecycle_status.sql`: `tenants.status`
  (active/suspended/archived, default active) + changed-at/reason.
- `requireTenantAdmin` denies non-active tenants (403 `Tenant is …`);
  pre-migration rows without the column keep working (compat skip).
  11/11 guard suite (red proven via stash on the tenant cases).
- `POST /api/platform/tenants/[id]/status`: platform-only suspend/
  reactivate/archive with audit (`tenant_status_change`) and optimistic
  concurrency (`expectedUpdatedAt` mismatch → 409). 5/5 route suite.
- `/platform` overview shows per-tenant status with label (not color-only).
- pgTAP `p2_12` (default active, allowlisted states, round-trip),
  wired into blocking CI db-tests.

## Verification

- Guard 11/11, status route 5/5, typecheck 0, lint 0.
- Live pgTAP BLOCKED locally (no Docker); CI db-tests is the gate.

## Deferred to T18b/full

- Last-admin protection for tenant role changes (next commit).
- Row-level suspension across direct REST/RPC/Storage/jobs (needs the
  status column shipped here), quotas/ceilings, settings versioning,
  support-grant consumption, tenant create/archive UI.
