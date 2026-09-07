# T22 Evidence — Versioned theme publication

Ticket: T22 (dependencies: T18, T21). Tenant-page delegation, font/
layout presets, and upload re-encoding pipelines are follow-ups.
Status: IMPLEMENTED (validation + versioning + revert below)

## Delivered

- Migration `20260907000005_tenant_theme_revisions.sql`:
  versioned/published/archived history, per-tenant version uniqueness,
  RLS deny-default. `tenants.custom_branding` stays the published
  pointer (T21 consumer untouched — no flash, no leak).
- `lib/theme-policy.ts`: allowlisted keys, strict shapes, contrast
  floor 3.0 (block) with 4.5 warnings, platform ceilings (palette
  narrowing, logo bans, text bounds, density enum). 6/6 suite.
- Branding POST: unknown body keys fail closed (were silently dropped);
  every publication validated, archived as a new version, audited;
  `revert_revision_id` republishes a prior revision (404 on unknown).
  6/6 route suite (mock-chain gap + silent-drop found via failing tests).
- pgTAP `p2_14` (direct invisibility/unwritability, status allowlist,
  version uniqueness), in blocking db-tests.

## Verification

- policy 6/6, route 6/6, typecheck 0, lint 0.
- Live pgTAP BLOCKED locally (no Docker); CI db-tests is the gate.

## Deferred

Tenant-page delegation, font/layout presets, upload re-encoding,
preview scoping, per-tenant lock flag, cache-invalidation proof.
