# E-Logbook Enterprise — BACKLOG

> Priority-ordered task list. Top undone task = next implementation target.

---

## Phase: Fix Typecheck Pipeline (DONE)

- [x] Fix `packages/env` typecheck failure — create `tsconfig.base.json`, install `@types/node`, add node types to tsconfig
- [x] Fix pre-existing typecheck errors in mobile (`Svg.default.Svg` → `Svg.Svg`, `as` → `as unknown as`)
- [x] Fix pre-existing typecheck error in web route test (missing `afterEach` import)

## Phase: Pipeline Health Restoration (Jul 13)

- [x] Fix typecheck errors in web (CaseComments.tsx double-cast, CaseForm.tsx missing TemplateField)
- [x] Fix typecheck errors in mobile (missing Model imports, SVG aliases, DateTimePicker type, unknown params, font declarations)
- [x] All 472 tests pass, typecheck clean across all 5 packages

## Phase: Lint Cleanup

- [x] Fix remaining 4 ESLint errors in web (jsx/global unknown properties, e2e hooks rule)
- [x] Fix remaining 1 ESLint error in mobile (unescaped entity)
- [x] Address 34 remaining warnings (prefer type annotations over `any`, unused vars) — down from 177

## Phase: Apple Health Redesign — Visual Polish

- [x] Verify DashboardContent.tsx matches Apple Health prototype
- [x] Verify frosted glass Sidebar renders correctly
- [ ] Verify StatusBadge pills (flat, no glow) on all pages
- [ ] Verify KPI rings (thin SVG, Apple Watch style) in DashboardContent
- [ ] Verify light theme is default, dark theme works via `.dark` class on `<html>`

## Phase: Mobile Alignment

- [ ] Sync mobile tailwind config with web token values
- [ ] Delete duplicate components (ProgressRing.tsx, StatusBadge.tsx, GlassPanel.tsx) in mobile — use shared package versions
- [ ] Verify mobile Expo build with new tokens

## Phase: Testing & Quality

- [ ] Verify page responsiveness at 375px / 768px / 1440px
- [ ] Run `pnpm build:web` to verify production build succeeds
- [ ] Audit WCAG AA contrast on all light-theme text colors

## Phase: Documentation

- [ ] Add README section about the design token system
- [ ] Document the env package usage pattern
