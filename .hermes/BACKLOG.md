# E-Logbook Enterprise — BACKLOG

> Priority-ordered task list. Top undone task = next implementation target.

---

## Phase: Fix Typecheck Pipeline (DONE)

- [x] Fix `packages/env` typecheck failure — create `tsconfig.base.json`, install `@types/node`, add node types to tsconfig
- [x] Fix pre-existing typecheck errors in mobile (`Svg.default.Svg` → `Svg.Svg`, `as` → `as unknown as`)
- [x] Fix pre-existing typecheck error in web route test (missing `afterEach` import)

## Phase: Lint Cleanup

- [ ] Fix remaining 4 ESLint errors in web (jsx/global unknown properties, e2e hooks rule)
- [ ] Fix remaining 1 ESLint error in mobile (unescaped entity)
- [ ] Address 109+68 warnings (prefer type annotations over `any`, unused vars)

## Phase: Apple Health Redesign — Visual Polish

- [ ] Verify DashboardContent.tsx matches Apple Health prototype
- [ ] Verify frosted glass Sidebar renders correctly
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
