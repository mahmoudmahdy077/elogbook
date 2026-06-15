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
