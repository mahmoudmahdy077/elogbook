# T21 Evidence — Shell branding + token-drift gate (bounded substep)

Ticket: T21 (dependencies: T04, T20). Full primitive-family rework and
nav/form/table overhauls are follow-ups; this slice closes the
save-without-effect gap (F11) and locks the palette.
Status: IMPLEMENTED

## Delivered

- `lib/tenant-branding.ts`: strict parse (hex-only colors, https-only
  logos, bounded text) + `brandingCssVars` (validated primary only).
  5/5 suite (one expectation corrected: oversized text truncates,
  implemented behavior held).
- Auth context carries `custom_branding`; tenant layout applies vars on
  initial server render (no flash/fetch). Existing auth mock updated.
- `scripts/verify-tokens.mjs`: css↔tokens drift gate — caught a live
  drift on first run (`text-muted` #6B6B70 vs #6D6D73), mirror aligned
  to source, gate green. Wired into `gates.yml` alongside the T02
  harness check.

## Verification

- branding 5/5 (+auth suite 13/13 combined), typecheck 0, lint 0,
  tokens gate 0, exports gate 0.

## Deferred

Primitive-family updates, nav/form/table states, theme init
reconciliation (Outfit loader vs token stack), RTL verification,
contrast measurement (T23/G5).
