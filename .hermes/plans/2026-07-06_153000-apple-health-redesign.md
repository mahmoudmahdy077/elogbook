# E-Logbook Enterprise — Apple Health-Inspired Design Upgrade

> **For Hermes:** Use subagent-driven-development skill to implement task-by-task.

**Goal:** Transform E-Logbook from a dark teal-themed app into a clean, light, Apple Health-inspired clinical tool — frosted glass surfaces, calming blue accent, zero decoration, clinical restraint.

**Prototype:** http://194.146.13.223/elogbook-redesign-v2.html

**Architecture:** Light theme (`#F2F2F7` Apple system background), white cards with subtle borders, frosted glass sidebar, Apple blue accent (`#007AFF`), SF-style Inter typography (600w headings, 400w body), Apple Watch-style thin KPI rings, flat pill badges, zero glow/shadows.

---

## Phase 1: Design Tokens (shared package)

### Task 1.1: Rewrite design-tokens.ts — Full Light Palette

**Files:** `packages/shared/src/constants/design-tokens.ts`

Replace entire `clinicalTokens` object:

```typescript
export const clinicalTokens = {
  colors: {
    backdrop: { dark: '#F2F2F7', light: '#FFFFFF' },
    surface: { dark: '#FFFFFF', overlay: 'rgba(255, 255, 255, 0.72)' },
    accent: { DEFAULT: '#007AFF', hover: '#0066D6', subtle: 'rgba(0, 122, 255, 0.06)', light: 'rgba(0, 122, 255, 0.10)' },
    neutral: { light: '#E5E5EA', dark: '#F2F2F7', darker: '#FFFFFF' },
    success: { DEFAULT: '#34C759', bg: 'rgba(52, 199, 89, 0.10)' },
    warning: { DEFAULT: '#FF9500', bg: 'rgba(255, 149, 0, 0.10)' },
    danger: { DEFAULT: '#FF3B30', bg: 'rgba(255, 59, 48, 0.10)' },
    border: { DEFAULT: 'rgba(60, 60, 67, 0.10)', strong: 'rgba(60, 60, 67, 0.18)' },
    text: { primary: '#000000', secondary: '#3C3C43', muted: '#8E8E93', onPrimary: '#FFFFFF' },
    pending: '#FF9500',
    approved: '#34C759',
    rejected: '#FF3B30',
  },
  fonts: {
    heading: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    mono: "'SF Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radius: { sm: 8, md: 10, lg: 14, xl: 18, full: 9999 },
  shadows: {}, // NO shadows — Apple Health uses borders only
  glass: {
    bg: 'rgba(255, 255, 255, 0.72)',
    blur: 20,
    border: 'rgba(255, 255, 255, 0.6)',
  },
  animation: {
    fast: '200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
    medium: '300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
  },
} as const;
```

---

## Phase 2: CSS Layer (web app)

### Task 2.1: Rewrite globals.css

**Files:** `apps/web/app/globals.css`

Key changes:
- Background: `#F2F2F7`
- `.panel` → white bg + subtle border, no shadow
- `.glass-panel` → frosted glass via `backdrop-filter: blur(20px)`
- Remove all `badge-*` glow shadows — replace with flat color bg pills
- Typography: headings at 600w, `-0.025em` tracking
- `--color-accent`: `#007AFF`
- Remove HeroUI semantic color scales (migrate off HeroUI where possible)
- Light theme override block not needed (default is light now)

### Task 2.2: Update tailwind.config.ts + web

**Files:** `apps/web/tailwind.config.ts`, `apps/mobile/tailwind.config.js`

Sync all color mappings to new tokens.

---

## Phase 3: Core Components

### Task 3.1: Sidebar — Frosted Glass

**Files:** `apps/web/components/Sidebar.tsx`

- Frosted glass background via `.glass-panel` class
- Brand icon: blue gradient, "EL" monogram
- Nav sections with uppercase labels (Apple-style)
- Active item: blue accent bg, blue text
- Remove search bar (or move to Cmd+K modal)
- Blue count badge on Approvals
- User avatar in footer: circular gradient

### Task 3.2: StatusBadge — Flat Pills

**Files:** `packages/shared/src/components/StatusBadge.web.tsx`, `.native.tsx`

- No glow, no box-shadow
- Background: 10% opacity of status color
- Text: status color at full opacity
- Border-radius: 999px (pill)
- Dot indicator: 6px circle
- Font: 0.7rem, 600w, uppercase

### Task 3.3: Dashboard KPI Rings

**Files:** `apps/web/components/DashboardContent.tsx`

- Replace current KpiRing with thin-stroke SVG rings (Apple Watch style)
- Stroke-width: 4 (thin)
- Background ring: `rgba(60,60,67,0.10)`
- Fill ring: status color, no glow, no drop-shadow filter
- Value: 1.25rem, 600w, Inter
- Label: 0.75rem, 500w, uppercase, muted color

---

## Phase 4: Dashboard Page

### Task 4.1: DashboardContent Full Redesign

**Files:** `apps/web/components/DashboardContent.tsx`

Full rebuild matching prototype:
- Page header: "Welcome, Ahmed" at 2rem/600w, subtitle in muted
- "Log New Case" button: pill shape, blue bg, white text
- KPI grid: 4 cards, thin rings, no animation (or subtle CSS fade-in)
- Recent cases: white card with separator lines between items
- Goal progress: thin 4px bars, blue fill, monospace counts
- Pending approvals: amber-tinted alert card (subtle, no glow)
- Quick links: white cards with icons, hover → blue border
- Remove Framer Motion animations → CSS @keyframes (lighter, no JS bundle cost)

### Task 4.2: Approvals & Case Form Pages (Light Touch)

**Files:** `apps/web/components/ApprovalsDashboard.tsx`, `apps/web/components/CaseForm.tsx`

- Update to white card / frosted glass backgrounds
- Status badges use new flat pill style
- Blue accent buttons (pill shape)
- Remove any glow/shadow effects

---

## Phase 5: Mobile Alignment

### Task 5.1: Sync Mobile Tokens

**Files:** `apps/mobile/tailwind.config.js`, `apps/mobile/global.css`

- Sync colors to Apple light palette
- Update font stacks (Inter 600w headings)
- Frosted glass → use BlurView for native

### Task 5.2: Delete Duplicate Components

**Files to delete:**
- `apps/mobile/components/ProgressRing.tsx` (use `@elogbook/shared`)
- `apps/mobile/components/StatusBadge.tsx` (use `@elogbook/shared`)
- `apps/mobile/components/GlassPanel.tsx` (use `@elogbook/shared`)

Update all mobile screen imports to use shared package.

---

## Phase 6: Polish & Verify

```bash
pnpm typecheck        # 0 errors
pnpm lint:all         # 0 errors
pnpm test             # all 284+ pass
pnpm build:web        # succeeds, 30 routes
```

### Visual QA Checklist
- [ ] Dashboard at 375px / 768px / 1440px
- [ ] Resident view correct
- [ ] Supervisor view (pending approvals card)
- [ ] Director view (resident overview)
- [ ] Light/dark toggle (ensure light is default, dark maps correctly)
- [ ] Reduced motion: animations disabled
- [ ] Mobile Expo build renders with new tokens

---

## Risks

1. **HeroUI still in use** — Some components (CaseForm wizard steps, tables) use HeroUI. They'll look slightly off until replaced. Acceptable for this phase.
2. **Dark theme** — Current codebase assumes dark-by-default. We're flipping to light-by-default. Check `layout.tsx` theme detection.
3. **Mobile WatermelonDB** — doesn't reference design tokens directly, low risk.
4. **Light theme contrast** — Verify text colors meet WCAG AA on light backgrounds.
