# T17 Evidence — Platform operator authority + /platform boundary

Ticket: T17 (dependencies: T04–T05)
Status: IMPLEMENTED (grant/revoke API + support-grant consumption in T18;
live pgTAP via blocking CI db-tests)

## Delivered

- Migration `20260907000002_platform_authority.sql`: `platform_admins`
  registry (no auto-promotion, no backfill) and `platform_tenant_access`
  scoped expiring grants, both RLS deny-by-default (no policies;
  service-role server-side only). Reserved slugs enforced with a
  fail-loud pre-check (`/platform` can never become a tenant).
- `requirePlatformAdmin` (6/6 suite): registry-only authority, active
  profile + active row, AAL2 with enrolled factor (fail closed),
  `DISABLE_MFA=true` dev parity. Tenant role labels confer nothing.
- `/platform` layout (generic denial, own shell outside tenant layouts)
  + read-only tenant overview (metadata only — no clinical access).
- Middleware exempts `/platform` from tenant-slug redirects (auth still
  required); stale `admin_tenants` comment corrected to the real table.
- pgTAP `p2_11` (6 assertions: registry/grant invisibility, reserved
  slug, grant expiry/scope/status CHECKs), wired into CI db-tests.
- Owner-run `scripts/grant-platform-admin.sql` (first operator
  out-of-band; later grants need a current operator id).

## Verification

- Helper 6/6 (red first: unmocked service client hit network), web
  typecheck 0, lint 0, Gate H 0 (run with push).
- Live pgTAP BLOCKED locally (no Docker); CI db-tests is the gate.

## Deferred to T18

Grant/revoke API with last-active-operator protection, support-grant
consumption (scoped reads), suspension/archive, tenant settings scoping.
