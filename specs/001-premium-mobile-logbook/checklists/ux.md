# UX Requirements Quality Checklist: Premium Mobile Logbook

**Purpose**: Validate UX requirements completeness, clarity, consistency, and measurability before implementation
**Created**: 2026-06-11
**Feature**: [spec.md](../spec.md)
**Depth**: Deep — exhaustive UX requirements scrutiny across all 6 user stories
**Focus**: Visual design, interaction design, cross-platform consistency, accessibility, motion, state coverage

## Visual Design Token Requirements

- [ ] CHK001 - Are the exact color hex values specified for all status badge states (draft, pending, approved, rejected) including glow/shadow properties? [Clarity, Spec §FR-009]
- [ ] CHK002 - Is the glass-panel styling fully specified with numeric values for backdrop-blur intensity, border opacity, border color, shadow offset, shadow blur, and shadow color tint? [Completeness, Spec §FR-016]
- [ ] CHK003 - Are typography requirements defined for ALL text hierarchy levels beyond headings/body/clinical-data — including captions, labels, button text, chip text, and badge text with specific font, weight, size, and line-height? [Gap, Spec §FR-012]
- [ ] CHK004 - Are the specific HeroUI component primitives (which HeroUI components map to which UI elements) enumerated for buttons, chips, badges, modals, cards, inputs, and toggles? [Clarity, Spec §FR-008]
- [ ] CHK005 - Are light mode color tokens defined with equivalent contrast ratios to dark mode, or is light mode intentionally scoped out of this feature? [Coverage, Spec §Assumption - dark mode primary]

## Case Logging UX Requirements (US1)

- [ ] CHK006 - Are the template specialty cards' visual properties fully specified — card dimensions, icon size/position, specialty name typography, required-field-count badge styling, and selection state? [Completeness, Spec §FR-001]
- [ ] CHK007 - Is "one-thumb reachable" quantified with specific screen-zone boundaries (e.g., lower 60% of viewport) and does it account for varying device sizes (small phone vs. large phablet)? [Clarity, Spec §FR-002]
- [ ] CHK008 - Are the form auto-advance behavior and transition animation between wizard steps specified with timing, easing curve, and direction? [Gap, Spec §US1-Acceptance-2]
- [ ] CHK009 - Is the "celebratory micro-animation" for case submission described with specific visual elements, duration, scale/opacity changes, and whether it precedes or follows the haptic feedback? [Clarity, Spec §FR-003]
- [ ] CHK010 - Are haptic feedback requirements specified for all trigger points (submit, error, offline save) with distinct haptic patterns per feedback type? [Gap, Spec §FR-003]
- [ ] CHK011 - Is the offline indicator's visual design specified — icon, color, position (banner vs. badge vs. inline), animation (pulsing vs. static), and transition between online/offline states? [Completeness, Spec §FR-010]
- [ ] CHK012 - Are validation error states for the case form specified — inline field error styling, form-level error summary, error color tokens, and whether errors prevent auto-advance? [Gap, Spec §US1]
- [ ] CHK013 - Are requirements defined for the template loading state (before templates are fetched) and the empty state (no templates available for resident's specialty)? [Coverage, Spec §US1]

## Verification Dashboard UX Requirements (US2)

- [ ] CHK014 - Are the animated KPI counters specified with animation type (count-up, fade-in), duration, easing, and initial/final visual states? [Clarity, Spec §US2-Acceptance-1]
- [ ] CHK015 - Are the pending case card layouts fully specified — card dimensions, de-identified patient summary format, relative timestamp format, specialty badge styling, and resident avatar size/shape? [Completeness, Spec §FR-004]
- [ ] CHK016 - Is the case detail sheet's slide-up animation specified with spring parameters (tension, friction), overlay backdrop opacity, and dismissal gesture (swipe-down threshold)? [Clarity, Spec §US2-Acceptance-3]
- [ ] CHK017 - Are the Approve and Reject button visual treatments fully distinct — emerald glow properties for Approve, crimson glow properties for Reject, size ratio, icons, and disabled state? [Consistency, Spec §FR-005]
- [ ] CHK018 - Is the "case card gracefully exits" animation after approval specified — direction (slide-left, fade-out, scale-down), duration, whether adjacent cards animate to fill the gap, and behavior when it's the last card in group? [Clarity, Spec §FR-006]
- [ ] CHK019 - Are requirements defined for the verification dashboard's empty state (no pending cases) and loading state (fetching pending cases)? [Coverage, Spec §US2]
- [ ] CHK020 - Is the urgency indicator system specified — what visual treatments distinguish urgent from routine cases (color, icon, badge, border), and what criteria define urgency? [Gap, Spec §FR-004]

## Progress Dashboard UX Requirements (US3)

- [ ] CHK021 - Are the SVG circular progress ring specifications complete — ring thickness, track color, progress gradient/glow, percentage label font/size/position, and animation duration/delay when entering viewport? [Completeness, Spec §FR-007]
- [ ] CHK022 - Is the "visually prominent yet supportive nudge" for approaching deadlines quantified — nudge position (banner, card, badge), color treatment, animation (gentle pulse?), and text tone guidelines? [Clarity, Spec §US3-Acceptance-2]
- [ ] CHK023 - Are the expanded detail view requirements specified — transition animation from ring to detail, timeline entry layout (date, case name, supervisor, status badge), and chronological ordering (ascending/descending)? [Completeness, Spec §US3-Acceptance-3]
- [ ] CHK024 - Are requirements defined for the progress dashboard when zero cases have been logged (empty state) and when a specialty has zero verified cases? [Coverage, Spec §US3]

## Cross-Platform Consistency Requirements (US4)

- [ ] CHK025 - Is the cross-platform visual consistency requirement measurable — what constitutes "indistinguishable" and which specific properties (color delta tolerance, font rendering differences, shadow variance) are within acceptable range? [Measurability, Spec §SC-005]
- [ ] CHK026 - Are interactive state requirements (hover, focus, active, disabled, pressed) consistently defined across ALL element types — buttons, toggles, chips, modals, cards, inputs — on both platforms? [Consistency, Spec §US4-Acceptance-2]
- [ ] CHK027 - Are requirements specified for platform-specific UX patterns that CANNOT be identical (mobile swipe-to-dismiss vs. web click-outside, mobile haptics vs. web hover tooltips) — which differences are acceptable? [Gap, Spec §US4]
- [ ] CHK028 - Are screen reader label requirements specified for all interactive elements across both platforms, including dynamic content (status changes, KPI counter updates, notification badges)? [Coverage, Spec §US4-Acceptance-3]

## AI Insights UX Requirements (US5)

- [ ] CHK029 - Are the pre-generated insight card visual specifications complete — card layout, chart type per data category, color palette for charts, card ordering, and distinction from regular case cards? [Completeness, Spec §US5-Acceptance-1]
- [ ] CHK030 - Is the AI response rendering specified — text formatting support (bold, lists, paragraphs), loading indicator during 10-second response time, streaming vs. batch display, and scroll behavior for long responses? [Gap, Spec §US5-Acceptance-2]
- [ ] CHK031 - Is the mandatory disclaimer's visual treatment specified — position (top/bottom of response, banner), typography (size, weight, color), persistence (always visible or dismissible), and content wording? [Completeness, Spec §FR-023]
- [ ] CHK032 - Are the AI quota-exhausted and AI-disabled states specified with visual design for the upgrade prompt — card layout, feature value proposition copy, CTA button styling, and transition to subscription flow? [Clarity, Spec §US5-Acceptance-3]
- [ ] CHK033 - Is the AI panel's empty state (no cases to analyze) and error state (AI provider unavailable, timeout) specified with user-facing messaging and fallback UI? [Coverage, Spec §US5]

## SaaS Institution Dashboard UX Requirements (US6)

- [ ] CHK034 - Are the plan comparison cards fully specified — card dimensions, plan name/price typography, feature list with checkmark/cross icons, "current plan" highlight treatment, and "Upgrade" CTA button styling? [Completeness, Spec §US6-Acceptance-1]
- [ ] CHK035 - Are resident tracking table requirements complete — column definitions, sort indicators, filter controls (dropdown, search, date range), row hover state, pagination vs. infinite scroll, and export button styling? [Completeness, Spec §US6-Acceptance-2]
- [ ] CHK036 - Is the "loading skeleton" specification for large datasets (200+ residents) detailed — skeleton shape per element (card, table row, chart), animation style (shimmer, pulse), and transition to loaded content? [Clarity, Spec §US6-Acceptance-4]
- [ ] CHK037 - Is the upgrade confirmation banner specified — position, animation (slide-down, fade-in), color treatment (emerald success), auto-dismiss timing, and content (plan name, features activated)? [Gap, Spec §US6-Acceptance-3]

## Notification & Feedback UX Requirements

- [ ] CHK038 - Are in-app notification requirements specified with visual treatment for both badge count (position, color, max number) and banner (position, animation, auto-dismiss timing, action button)? [Completeness, Spec §FR-014]
- [ ] CHK039 - Is the rejection feedback UX fully specified — how supervisor's comment is displayed on the resident's case detail, visual distinction of rejected cases in the case list, and the "edit and resubmit" button styling and placement? [Completeness, Spec §FR-015]
- [ ] CHK040 - Are the conflict notification requirements for offline sync specified — banner vs. modal, content wording ("Your offline edits conflicted with a supervisor review"), and the one-tap resubmission button's visual treatment? [Clarity, Spec §FR-024]

## General UX State Requirements

- [ ] CHK041 - Are loading state requirements consistently specified for EVERY data-fetching screen — template list, case list, verification feed, progress dashboard, AI panel, resident table, billing dashboard? [Consistency, Spec §Multiple]
- [ ] CHK042 - Are empty state requirements defined for every list/dashboard — including empty-state illustration/icon, title, description, and primary CTA (e.g., "Log your first case")? [Coverage, Spec §Multiple]
- [ ] CHK043 - Are error state requirements specified with user-facing error messages mapped to common failure types (network error, auth expired, permission denied, server error) with consistent visual treatment? [Coverage, Spec §Edge Cases]
- [ ] CHK044 - Are offline state visual indicators specified consistently across all screens — does every screen show connectivity status, and is the offline banner/non-intrusive indicator design uniform? [Consistency, Spec §FR-010]

## Accessibility UX Requirements

- [ ] CHK045 - Is the 7:1 contrast ratio requirement (WCAG AAA) verified against ALL color pairings in the clinical palette — text on backdrop, text on panels, text on glass-panels, badges on backgrounds, buttons on panels? [Measurability, Spec §SC-007]
- [ ] CHK046 - Are focus indicator requirements specified — color, thickness, offset, style (outline vs. glow), and whether they differ between keyboard (Tab) and pointer (click) focus? [Gap, Spec §US4-Acceptance-3]
- [ ] CHK047 - Are motion sensitivity requirements specified — do all animations respect `prefers-reduced-motion`, and is there a user-facing toggle to disable animations independently? [Gap, Spec §General]

## Motion & Animation Requirements

- [ ] CHK048 - Is the transition easing curve `cubic-bezier(0.4, 0, 0.2, 1)` consistently applied across ALL specified animations (wizard steps, card exits, KPI counters, progress rings, sheet slide-up, notification banners) or are different curves used for different animation types? [Consistency, Spec §FR-006 + DESIGN.md]
- [ ] CHK049 - Are animation duration requirements defined per animation type — micro-interactions (button press, toggle), content transitions (cards, sheets), celebratory animations (submission, approval), and data animations (KPI counters, progress rings)? [Gap, Spec §FR-003/006/007]
- [ ] CHK050 - Are entrance animation requirements specified for list items (staggered delay, direction, duration) when screens first load — case list, verification feed, resident table, timeline? [Gap, Spec §US1-US6]

## UX Measurability & Acceptance

- [ ] CHK051 - Is the 60-second case logging benchmark (SC-001) decomposed into sub-task time budgets (template selection, field filling, review, submission) to identify which UX step needs optimization if the target is missed? [Measurability, Spec §SC-001]
- [ ] CHK052 - Is the 90% one-thumb interaction target (SC-002) measurable — what constitutes an "interaction," how is grip repositioning detected, and what device sizes are included in the measurement? [Measurability, Spec §SC-002]
- [ ] CHK053 - Is the 95% design consistency score (SC-005) defined with a scoring rubric — how many points per token category (colors, typography, elevation, motion, component states), what delta is acceptable per property? [Measurability, Spec §SC-005]
- [ ] CHK054 - Are the "premium visualizations" for the director dashboard (FR-013) specified with measurable criteria — what chart types, data density, and interactivity level constitute "premium"? [Ambiguity, Spec §FR-013]

## Notes

- Items marked [Gap] identify requirements that are missing from the current spec and should be added before implementation
- Items marked [Clarity] identify requirements that exist but lack precise, measurable specification
- Items marked [Completeness] identify partially-specified requirements needing additional detail
- Items marked [Coverage] identify scenarios/states not addressed in current requirements
- Items marked [Consistency] identify potential conflicts or alignment gaps between sections
- Items marked [Measurability] identify success criteria that need clearer measurement definitions
- Items marked [Ambiguity] identify vague adjectives lacking quantification
- All items include traceability to spec sections; items without spec references use [Gap]
