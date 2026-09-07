# DESIGN.md — Shared design contract (T20)

Owner-requested identity: Apple Health-inspired clinical workspace.
Refine, never rebrand. Status: CONTRACT (targets, not conformance claims).

## 1. Authoritative token source

`packages/shared/src/constants/design-tokens.ts` (`clinicalTokens`) is
the single source. Two mirrors consume it by convention:

| Consumer | File | Notes |
|---|---|---|
| Tailwind v3 extend | `apps/web/tailwind.config.ts` | Maps `clinicalTokens` 1:1; native apps read the same object |
| Tailwind v4 theme | `apps/web/app/globals.css` `@theme` | Hand-mirrored values; keep in sync on any token change (a drift check belongs in T21) |
| CJS mirror | `packages/shared/src/design-tokens.config.cjs` | For `require()` tooling (mobile tailwind config) |

Do not add a fourth palette. Do not restyle by editing consumers.

## 2. Type, color, density

- Fonts: Inter (body + heading stack), SF Mono/JetBrains Mono (mono).
  Root layout loads Outfit/Inter/Geist_Mono via next/font — heading
  variable currently resolves to the loader, not the token stack (known
  inconsistency, T21 to reconcile; no visual change in this ticket).
- Actions: primary `#007AFF` (hover `#0066D6`), white on-primary.
  Status colors ALWAYS pair with a text label/icon (pending amber,
  approved green, rejected red); never color-alone.
- Density: 8px card default for NEW cards; existing conventions stay.
  No nested cards, no floating section panels, no data-surface blur.
- Focus: visible ring on all interactive elements; keyboard paths for
  every workflow (acceptance in T23/G5).

## 3. Accessibility targets (WCAG 2.2 AA)

Keyboard-only operation, visible focus, `prefers-reduced-motion`
support, status not by color alone, 200% zoom without overlap, logical
property spacing for RTL (root is `dir="ltr"` today — Arabic/RTL support
is NOT claimed until verified). Conformance is measured in T23/G5, not
asserted here.

## 4. Component conventions (existing, preserved)

Tool actions: familiar icon + accessible label + tooltip. Numeric
settings: numeric controls. Binary: toggles. Consequential choice
(data mode): radio/segmented with permission state. Buttons name
commands, not architecture. Icon system: single library once chosen
(T21 inventories current usage first).

## 5. Theme precedence (binds T22)

Safe platform defaults → allowed published tenant overrides → personal
light/dark/system preference. Tenant branding applies at initial server
render; never leaks across tenants via cache or browser persistence.
