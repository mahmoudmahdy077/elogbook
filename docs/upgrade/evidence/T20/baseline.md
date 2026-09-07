# T20 Evidence — UI baseline + design contract

Ticket: T20 (dependency: T00)
Status: CONTRACT + INVENTORY DONE; screenshots BLOCKED this session

## Delivered

- `docs/upgrade/evidence/T20/DESIGN.md`: authoritative token source
  (`clinicalTokens`), type/color/density rules, WCAG 2.2 AA targets
  (explicitly not conformance claims), component conventions, theme
  precedence binding T22. Identity preserved; no visual changes.
- Token inventory (source-observed 2026-09-07):
  - Authoritative: `packages/shared/src/constants/design-tokens.ts`
    (+ `.cjs` mirror for require()-tooling).
  - Consumers: `apps/web/tailwind.config.ts` (maps the object 1:1),
    `apps/web/app/globals.css` `@theme` (hand mirror — drift risk
    noted, check belongs in T21), root fonts (Outfit/Inter/Geist_Mono;
    heading var resolves to the loader, not the token stack — recorded
    inconsistency for T21, no change here).
  - Root `dir="ltr"` — RTL/Arabic support NOT claimed.
- `scripts/capture-ui-baseline.mjs`: runnable capture (/, /login,
  /pricing, /signup × 1440×900 + 375×812) for hosts with Playwright
  browsers. Exit 2 with a clear message when browsers are absent.

## Screenshot attempt (honest record)

- Dev server booted (Next 16.3.1, ready); Orca tab navigated to `/`
  (title observed: "E-Logbook — Every case. Sealed." — page renders).
- `snapshot`/`screenshot` unusable: Orca runtime drops the debugger
  connection every call this session (`runtime_unavailable` despite
  `status: ready`). No screenshots captured, none fabricated.
- Authenticated screens additionally need an E2E session (fixtures
  exist); capture after browsers + session are available.

## Verification

- No code changed except docs/scripts; contract is the deliverable.
- Next: T21 token-drift check + primitives; T23/G5 measured conformance.
