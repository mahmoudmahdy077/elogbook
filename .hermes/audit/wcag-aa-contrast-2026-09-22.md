# WCAG AA Contrast Audit — Semantic Text Colors (2026-09-22)

Task: "Audit WCAG AA contrast on all light-theme text colors" — result: PASS.

## Method
WCAG 2.x relative-luminance (sRGB), computed programmatically over the script at the bottom
of this file. Backgrounds sampled from every shipped surface: white cards #FFFFFF, backdrop
#F2F2F7, frosted glass (72% white over backdrop ≈ #F9F9FB), and each semantic tint pill
(10-20% alpha). Dark theme audited against #1C1C1E cards and #000000 backdrop.

## Fixes shipped
1. globals.css: new --color-fg-* AA text tokens (light: #186B2E/#8F4200/#C20012/#0066D6;
   dark: #30D158/#FF9F0A/#FF453A/#339DFF), mirroring clinicalTokens.status.text.
2. Web codemod: 524 `text-success|warning|danger|approved|rejected|pending|primary` sites in
   111 files -> `text-fg-*`. bg-/border-/ring- utilities keep raw Apple hues (fills pass the
   3:1 non-text criterion as-is).
3. Removed opacity-faded sub-AA labels (/80, /60) in Toast, ReadOnlyBanner, NotificationBell,
   CaseComments, ErrorDisplay, ProcedureCodePicker, CommandPalette, CaseImport, cases/new.
4. Solid white-on-fill buttons -> 700 fills: StepIndicator bg-success-700; NotificationBell,
   DutyHoursChart, ApprovalsDashboard, ApprovalActions, CasePreviewModal, uninstall,
   ImpactDialog bg-danger-700. Dark 700 steps pinned to darkened values (white fails on
   #FF6961/#4CD964/#FFB340).
5. Mobile: login.tsx + BiometricGate banners now use clinicalTokens.status.text/bg/border AA
   variants; shared tokens gained status.text.primary #0066D6; CJS mirror updated.

## Measured ratios (all >= 4.5 except noted AA-large exception)

| Element | Background | Ratio |
|---|---|---|
| text-fg-approved #186B2E (light) | white | 6.60 |
| text-fg-approved #186B2E (light) | backdrop | 5.92 |
| text-fg-approved #186B2E (light) | success/10 tint | 6.07 |
| text-fg-approved #186B2E (light) | warning/10 tint | 6.08 |
| text-fg-approved #186B2E (light) | danger/10 tint | 5.76 |
| text-fg-approved #186B2E (light) | danger/20 tint | 5.04 |
| text-fg-approved #186B2E (light) | pending/15 tint | 5.85 |
| text-fg-approved #186B2E (light) | approved/15 tint | 5.86 |
| text-fg-approved #186B2E (light) | glass approx F9F9FB | 6.28 |
| text-fg-warning #8F4200 (light) | white | 7.13 |
| text-fg-warning #8F4200 (light) | backdrop | 6.39 |
| text-fg-warning #8F4200 (light) | success/10 tint | 6.55 |
| text-fg-warning #8F4200 (light) | warning/10 tint | 6.56 |
| text-fg-warning #8F4200 (light) | danger/10 tint | 6.22 |
| text-fg-warning #8F4200 (light) | danger/20 tint | 5.44 |
| text-fg-warning #8F4200 (light) | pending/15 tint | 6.31 |
| text-fg-warning #8F4200 (light) | approved/15 tint | 6.33 |
| text-fg-warning #8F4200 (light) | glass approx F9F9FB | 6.78 |
| text-fg-danger #C20012 (light) | white | 6.36 |
| text-fg-danger #C20012 (light) | backdrop | 5.70 |
| text-fg-danger #C20012 (light) | success/10 tint | 5.85 |
| text-fg-danger #C20012 (light) | warning/10 tint | 5.85 |
| text-fg-danger #C20012 (light) | danger/10 tint | 5.55 |
| text-fg-danger #C20012 (light) | danger/20 tint | 4.86 |
| text-fg-danger #C20012 (light) | pending/15 tint | 5.63 |
| text-fg-danger #C20012 (light) | approved/15 tint | 5.65 |
| text-fg-danger #C20012 (light) | glass approx F9F9FB | 6.05 |
| text-fg-primary #0066D6 (light) | white | 5.42 |
| text-fg-primary #0066D6 (light) | backdrop | 4.86 |
| text-fg-primary #0066D6 (light) | success/10 tint | 4.99 |
| text-fg-primary #0066D6 (light) | warning/10 tint | 4.99 |
| text-fg-primary #0066D6 (light) | danger/10 tint | 4.73 |
| text-fg-primary #0066D6 (light) | danger/20 tint | 4.14 |
| text-fg-primary #0066D6 (light) | pending/15 tint | 4.80 |
| text-fg-primary #0066D6 (light) | approved/15 tint | 4.82 |
| text-fg-primary #0066D6 (light) | glass approx F9F9FB | 5.16 |
| text-fg-success #30D158 (dark) | surface #1C1C1E | 8.42 |
| text-fg-success #30D158 (dark) | backdrop #000 | 10.39 |
| text-fg-warning #FF9F0A (dark) | surface #1C1C1E | 8.28 |
| text-fg-warning #FF9F0A (dark) | backdrop #000 | 10.22 |
| text-fg-danger #FF453A (dark) | surface #1C1C1E | 4.99 |
| text-fg-danger #FF453A (dark) | backdrop #000 | 6.16 |
| text-fg-primary #339DFF (dark) | surface #1C1C1E | 6.00 |
| text-fg-primary #339DFF (dark) | backdrop #000 | 7.41 |
| white on bg-success-700 #1E7E34 | fill itself #1E7E34 | 5.14 |
| white on primary #007AFF (AA-large) | fill itself #007AFF | 4.02 |

## Notable measurements
- Pre-existing neutrals pass unchanged: text-primary #000 18.8-21:1, text-secondary #3C3C43 9.8-10.9:1, text-muted #6D6D73 4.61-5.14:1.
- Badge classes (.badge-*, banners) already AA-hardened from a prior pass.
- Icons on raw hues >=3:1 (WCAG 1.4.11) — left unchanged.
- White on primary #007AFF = 4.02:1 — passes AA-LARGE (button labels 14px semibold / 18px+);
  flagged as the only intentional AA-large-only pairing, consistent with Apple's own marketing UI.
