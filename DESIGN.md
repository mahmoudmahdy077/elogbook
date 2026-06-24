# Design System: Impeccable Clinical UI

This document governs all visual styling, layout choices, and components across `@elogbook/web` and `@elogbook/mobile`.

---

## 1. Visual Tokens

### Colors (Deep Clinical Palette)
* **Backdrop (Dark Mode)**: Deep clinical slate-indigo (`#060814`). Avoid flat grays or pure blacks.
* **Backdrop (Light Mode)**: Clean slate-blue tint (`#F8FAFC`).
* **Primary Accent (Teal/Emerald)**: Clinical precision teal (`#0D9488`). Used for verification, active states, and success indicators.
* **Secondary Accent (Royal Indigo)**: Professional indigo (`#6366F1`). Used for branding, headings, and data visualizations.
* **Neutral Dark**: Deep navy-slate (`#0F172A`).
* **Neutral Light**: Cool slate gray (`#E2E8F0`).
* **Borders**: Thin, semi-transparent indigo outlines (`rgba(99, 102, 241, 0.15)`) with a subtle glowing border on active elements.

### Typography
* **Primary Headings**: `Outfit` (sans-serif, rounded, premium and modern).
* **Body / Controls**: `Inter` or `Plus Jakarta Sans` for clean data legibility.
* **Clinical Data (MRNs, Codes, Dates)**: `Geist Mono` or `JetBrains Mono` for distinct monospace visual recognition.

### Elevation & Layering
* **Data Panels (`.panel`)**: Opaque, deep navy-slate background with thin semi-transparent indigo borders. Default surface for cards, lists, tables, and content containers.
* **Overlay Panels (`.glass-panel`)**: Reserved exclusively for transient overlay surfaces — modals, wizards, dialogs, and sheets. Uses `backdrop-filter: blur(12px)` with a semi-transparent background.
  - Glassmorphism is a deliberate elevation signal, not a default card style. Never use `.glass-panel` for data-dense content containers.
  - Border: `1px solid rgba(255, 255, 255, 0.05)`.
  - Shadow: Soft, diffused drop-shadow with a color tint matching the backdrop.

---

## 2. Component System

### KPI Progress Rings (Goal Tracking)
* Use circular SVG graphs instead of boring horizontal progress bars.
* Glow effects on progress paths to highlight completion.

### Dynamic Wizard (Case Logging)
* Interactive steps with a visual indicator of completion.
* Auto-focus on primary inputs.
* Clean visual toggles for de-identification switches.

### Case Review List
* High-density layout showing case dates, specialties, templates, and statuses.
* Badge styling:
  - `draft`: neutral border badge.
  - `pending`: glowing amber badge (`#D97706`).
  - `approved`: glowing emerald badge (`#059669`).
  - `rejected`: glowing crimson badge (`#DC2626`).

---

## 3. Motion & Animation (Purposeful Motion)
* **Transitions**: Smooth transitions (`200ms cubic-bezier(0.4, 0, 0.2, 1)`) for hovers.
* **Modals / Sheets**: Spring-like slide-up transition. Avoid sudden appearances.
* **Feedback**: Tactile haptic feedback on mobile when tapping primary submit buttons.

---

## 4. Design Anti-Patterns (NEVER USE)
* **No overused Inter font for headings**: Headings must use a premium font (e.g., `Outfit`).
* **No flat `#000` or `#121212` backgrounds**: Use deep slate-indigo tints.
* **No purple-to-blue gradients**: Use refined indigo-to-teal gradients.
* **No nested hard-bordered cards**: Avoid placing boxes inside boxes with identical borders. Use depth layers instead.
* **No gray text on colored backgrounds**: Ensure strict contrast ratios exceeding Web Content Accessibility Guidelines (WCAG) AAA standards (minimum 7:1 ratio for body text).

---

## 5. Design Token Governance

### Single Source of Truth
All design tokens are defined in `packages/shared/src/constants/design-tokens.ts`. This TypeScript file is the **single source of truth** — never define colors, fonts, spacing, or shadows anywhere else.

### Using Clinical Tokens
- **React Native inline styles**: Use `clinicalTokens.colors.*` (e.g., `clinicalTokens.colors.backdrop.dark`)
- **NativeWind classes**: Use semantic class names — `bg-backdrop`, `bg-panel`, `text-primary`, `text-muted`, `border-border`, `bg-primary`
- **Never** use raw hex values or Tailwind base palette names (`bg-slate-900`, `text-gray-400`, `border-indigo-500`)
- **Placeholder colors**: Must use `clinicalTokens.colors.text.muted` as inline style (NativeWind doesn't support `placeholderTextColor`)

### Platform Component Pattern
- Shared components use the `.web.tsx` / `.native.tsx` extension pattern
- Platform defaults must be **identical** — see ProgressRing (`size=120`, `strokeWidth=8`) and ClinicalText size map for examples
- Any divergence requires a documented justification in the component file

### GlassPanel Usage Rules
- `.glass-panel` is reserved for **transient overlay surfaces only**: modals, wizards, dialogs, sheets
- **Never** use `.glass-panel` for data-dense content containers (cards, lists, tables)
- Data panels use `.panel` class with opaque `bg-panel` instead

### How to Add New Design Tokens
1. Add the value to `design-tokens.ts` in the appropriate category
2. Add the Tailwind mapping in `apps/web/tailwind.config.ts` (and `apps/mobile/tailwind.config.js` if needed)
3. Add the CSS variable in `apps/web/app/globals.css` `@theme inline` block
4. Update this DESIGN.md with the new token name and usage

### PR Compliance Checklist
- [ ] No hardcoded hex colors (`'#...'`) — use `clinicalTokens.*` or NativeWind semantic classes
- [ ] No Tailwind base palette colors (`bg-slate-*`, `text-gray-*`, `border-indigo-*`)
- [ ] Platform components have matching defaults (`.web.tsx` aligns with `.native.tsx`)
- [ ] `.glass-panel` only used for transient overlays, not data content
- [ ] All new text meets WCAG AAA contrast ratio (7:1)
