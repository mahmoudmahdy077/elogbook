# T24 Evidence — Editorial data + publication API (editor UI in T25)

Ticket: T24 (dependencies: T17–T18, T21)
Status: IMPLEMENTED (models, validation, platform API; editor/renderer in T25)

## Delivered

- Migration `20260907000006_site_pages.sql`: `site_pages` (scope CHECK,
  slug/locale shapes, published pointer) + `site_page_revisions`
  (immutable rows); partial unique indexes per scope (a plain UNIQUE
  would ignore NULL tenant_ids — caught during authoring); RLS
  deny-default.
- `lib/site-content.ts`: typed blocks, required fields, safe links
  (https/relative/mailto only), no-HTML text, 64-block / 4-deep /
  128KB caps. 6/6 suite.
- Platform API: list/create (+initial draft + audit), draft save,
  publish (re-validate, archive previous, move pointer, 409 on stale),
  revert-by-republishing (row content/author immutable; statuses move). 6/6 route suite (mock-chain + silent-drop
  gaps found via failing tests).
- pgTAP `p2_15` (invisibility, scope/slug CHECKs, canonical
  uniqueness), in blocking db-tests.

## Verification

- 12/12 new suites, typecheck 0, lint 0.
- Live pgTAP BLOCKED locally (no Docker); CI db-tests is the gate.

## Deferred to T25

Block renderer (React mapping, no raw HTML), editor/preview/revision
UI, tenant-page delegation endpoints, public slug routes + scoped
caching, metadata/SEO, shareable preview tokens.
