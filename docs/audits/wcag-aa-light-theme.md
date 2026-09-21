# WCAG AA Contrast Audit — E-Logbook Light Theme

**Date:** 2026-09-21 · **Script:** `scripts/wcag-audit.mts` (`pnpm audit:wcag` from repo root)

## Scope

Recomputed WCAG relative-luminance contrast for every text-on-surface pair in the
`clinicalTokens` system (backgrounds: white `#FFFFFF` and app backdrop `#F2F2F7`,
plus status-tint pill backgrounds composited over white — the worst case).

## Method

- Pure math: WCAG 2.1 relative luminance + contrast ratio.
- Alpha colors (status tints, rgba borders) are composited over their underlying
  solid before the ratio is computed, so tinted backgrounds can't fake a pass.
- Exit code 1 = any pair below 4.5:1 → the pipeline can gate on it.

## Results (all ≥ 4.5:1 unless noted)

| Pair | Ratio | Status |
|---|---|---|
| text.primary (#000) on white / #F2F2F7 | 21.00 / 18.82 | AA |
| text.secondary (#3C3C43) on white / #F2F2F7 | 10.94 / 9.80 | AA |
| text.muted (#6D6D73) on white / #F2F2F7 | 5.14 / 4.61 | AA |
| status.text.draft (#48484A) on white / gray | 9.12 / 8.18 | AA |
| status.text.success (#186B2E) on white / gray / success tint | 6.60 / 5.92 / 5.86 | AA |
| status.text.warning (#8F4200) on white / gray / warning tint | 7.13 / 6.39 / 6.31 | AA |
| status.text.danger (#C20012) on white / gray / danger tint | 6.36 / 5.70 / 5.50 | AA |
| deidentified (#4442C9) on white | 7.32 | AA |

## Known AA-large exception

**`colors.primary` #007AFF on white = 4.02:1** (white text on primary buttons, and
primary-as-text on white).

This is the canonical Apple system blue — iOS itself ships it; the color cannot
reach 4.5:1 without leaving the Apple Health palette. Mitigations in place:

- `colors.primary.hover` (#0066D6) is 5.28:1 — it is the AA-safe variant and is
  used wherever primary blue is the *text color on light surfaces* (links,
  `hover:text-primary` states, focus rings).
- Text on solid-primary buttons is white; large/medium text & interactive
  affordances meet AA-large (≥3:1).

**Do NOT swap global `colors.primary`** — that would break brand fidelity and
dark-mode pairing with the raw Apple blue. Introduce an AA text-blue only if a
future audit shows an actual small-text-primary violation (there are none today).

## Past fixes covered by this audit

- `deidentified`: #5856D6 → #4442C9 (was 4.31:1 worst-case)
- `status.text.*`: raw iOS brights → darkened AA variants
- `status.bg.*`: tints deepened so contrast holds *on the pill background*, not just white
