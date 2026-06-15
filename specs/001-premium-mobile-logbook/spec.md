# Feature Specification: Premium Mobile Logbook

**Feature Branch**: `001-premium-mobile-logbook`

**Created**: 2026-06-11

**Status**: Draft

**Input**: User description: "I want to transform this into a comprehensive system for junior residents and doctors to log their cases on the go and on mobile during their shifts to get their cases verified by the program directors and consultants I would like to focus on design upgrading to the highest beautiful elements in HeroUI"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-Handed Shift Case Logging (Priority: P1)

Junior residents on busy clinical shifts need to log surgical and clinical procedures rapidly using one hand on their mobile device. They select a case template, enter essential details with minimal typing, and submit for verification — all within 60 seconds while standing in a corridor or changing rooms.

**Why this priority**: Case logging is the core workflow. If residents cannot log quickly on mobile during shifts, the system fails its primary purpose. Every other feature depends on cases existing in the system.

**Independent Test**: A resident can log into the mobile app, select a specialty template, fill required fields, submit a case, and see it appear in their case list — all without touching the web dashboard. The submission generates a pending verification request visible to supervisors.

**Acceptance Scenarios**:

1. **Given** a resident is authenticated and on shift, **When** they tap "Log New Case", **Then** they see a visually striking template selection screen with specialty cards showing familiar medical icons and colors within 1 second.
2. **Given** a resident selected a template, **When** they fill the required fields with one-thumb reachable inputs, **Then** the form auto-advances through sections without requiring two-handed interaction, and the "Submit" button is always within thumb reach.
3. **Given** a resident completed all required fields, **When** they tap "Submit for Verification", **Then** the case is saved, a satisfying visual confirmation appears with haptic feedback, and the case status transitions to "Pending Verification" with the assigned supervisor notified.
4. **Given** the resident is in a low-signal area (OR, radiology ward), **When** they submit a case without connectivity, **Then** the case is saved locally with a clear offline indicator and automatically syncs when connectivity returns.

---

### User Story 2 - Beautiful Verification Dashboard for Supervisors (Priority: P1)

Program directors and consultants need to review, approve, or reject resident cases through a visually premium dashboard that makes verification efficient and even enjoyable. They see pending cases grouped by resident, specialty, and urgency, with rich case previews and one-tap approval actions.

**Why this priority**: Verification closes the logbook loop. Without supervisor approval, residents cannot meet accreditation requirements. This is equally critical as logging.

**Independent Test**: A supervisor logs in, sees a dashboard with pending cases displayed in elegant HeroUI cards with glowing status indicators, taps a case to view full details, and approves or rejects it with a single action. The resident sees the updated status immediately.

**Acceptance Scenarios**:

1. **Given** a supervisor is authenticated, **When** they open the app, **Then** they see a verification dashboard with animated KPI counters (count-up from 0 over 1.5s) showing pending/today/this week totals, and a scrollable feed of pending cases in premium card layouts with patient de-identified summaries.
2. **Given** pending cases exist across multiple residents, **When** the supervisor browses the verification feed, **Then** cases are visually grouped by resident with profile avatars, specialty badges, and urgency indicators, allowing quick scanning.
3. **Given** a supervisor taps a case, **When** the case detail sheet slides up, **Then** they see all case fields, procedure details, and the resident's reflection notes in a glass-panel overlay with clear "Approve" (emerald glow) and "Reject" (crimson glow) buttons.
4. **Given** a supervisor approves a case, **When** they tap "Approve", **Then** a celebratory micro-animation plays with haptic feedback, the case card gracefully exits the pending list, and the resident's accreditation progress ring animates to reflect the new count.

---

### User Story 3 - Resident Progress & Accreditation Tracking (Priority: P2)

Residents need to see their verification progress at a glance through beautiful visual indicators — circular progress rings, specialty breakdowns, and milestone tracking — giving them motivation and clarity on their accreditation journey.

**Why this priority**: Progress tracking drives resident engagement and ensures accreditation compliance. It's the motivational layer that turns logging from a chore into a rewarding experience.

**Independent Test**: A resident navigates to their progress screen and sees animated SVG progress rings for each specialty, a timeline of verified cases, and their overall completion percentage — all with the premium clinical design aesthetic.

**Acceptance Scenarios**:

1. **Given** a resident has logged and had cases verified, **When** they view their progress dashboard, **Then** they see animated circular SVG progress rings for each specialty with glowing completion arcs and percentage labels that animate on entry.
2. **Given** a resident is approaching a program goal deadline, **When** they view their dashboard, **Then** they see an amber notification banner with a clock icon showing remaining cases needed (e.g., "3 cases needed by June 30") with a gentle pulse animation — using encouraging language ("You're almost there") not alarming or negative wording.
3. **Given** a resident taps a specialty progress ring, **When** the detail view expands, **Then** they see a chronological timeline of all verified cases in that specialty with beautiful status badges and the approving supervisor's name.

---

### User Story 4 - Cross-Platform Design Consistency (Priority: P2)

The mobile and web applications must feel like a single, cohesive premium product with identical design language, color systems, typography, motion patterns, and component styling — powered by HeroUI across both platforms.

**Why this priority**: Design inconsistency between mobile and web erodes professional credibility. Residents use mobile during shifts and web for detailed review — the transition must feel seamless.

**Independent Test**: A user opens the same case on mobile and web side-by-side. The color palette, typography (Outfit headings, Inter body, Geist Mono for clinical data), badge styles, glass-panel modals, and transition animations are visually identical across both platforms.

**Acceptance Scenarios**:

1. **Given** a user switches from mobile to web, **When** they view any screen (dashboard, cases, approvals), **Then** the visual identity is indistinguishable — identical dark slate-indigo backdrop, teal/indigo accents, glowing status badges, and glass-panel overlays.
2. **Given** any interactive element (button, toggle, chip, modal), **When** the user interacts with it, **Then** the hover, focus, active, and disabled states follow the identical HeroUI design tokens on both platforms.
3. **Given** the user has accessibility needs, **When** they navigate the app, **Then** focus indicators, contrast ratios, and screen reader labels are consistent and compliant across both platforms.

---

### User Story 5 - AI-Powered Clinical Reflection Assistant (Priority: P3)

After logging cases, residents want to reflect on their clinical experience and identify learning patterns. An AI assistant analyzes their case history and provides supportive, evidence-based insights — highlighting trends, suggesting areas for further study, and tracking skill progression across specialties without ever diagnosing or recommending treatments.

**Why this priority**: AI differentiates the product from basic logbooks and adds genuine educational value. It transforms passive logging into active learning.

**Independent Test**: A resident opens the AI Insights panel from their dashboard, asks "What patterns do you see in my surgical cases this month?", and receives a structured, non-diagnostic summary of their case distribution, common procedures, and suggested reflection topics — all within 10 seconds.

**Acceptance Scenarios**:

1. **Given** a resident has 20+ logged cases across multiple specialties, **When** they open the AI Insights panel, **Then** they see pre-generated insight cards showing case volume trends, most frequent procedures, and specialty distribution with visually rich charts.
2. **Given** a resident types a free-text question about their case history, **When** they submit it, **Then** the AI responds within 10 seconds with a supportive, educational answer that references specific cases while maintaining full patient de-identification.
3. **Given** a resident's institution has not enabled AI or the resident has exhausted their quota, **When** they access AI features, **Then** they see a clear upgrade prompt explaining the value and guiding them to subscription options.

---

### User Story 6 - Institution SaaS Management & Resident Tracking (Priority: P2)

Program directors and institution administrators need a comprehensive web dashboard to manage their SaaS subscription, track all residents' performance metrics, configure billing, and oversee program-wide accreditation compliance — all with the same premium clinical design.

**Why this priority**: The SaaS business model requires institutional buyers to see clear ROI through resident tracking and subscription management. This is the monetization engine.

**Independent Test**: An institution admin logs into the web dashboard, views their current plan with active resident count, browses resident performance metrics (case volumes, verification rates, milestone progress), upgrades their plan, and sees the new features activate immediately.

**Acceptance Scenarios**:

1. **Given** an institution admin is authenticated, **When** they view the admin dashboard, **Then** they see a SaaS billing overview with current plan details, active resident seats used/available, next billing date, and a prominent "Upgrade Plan" button with plan comparison cards.
2. **Given** an institution admin navigates to resident tracking, **When** they view the performance overview, **Then** they see a sortable, filterable table of all residents with case counts, verification rates, milestone completion percentages, and last active dates — with export to PDF capability.
3. **Given** an institution admin selects "Upgrade Plan", **When** they choose a new plan and complete payment, **Then** the new features (additional seats, AI access, advanced reporting) activate immediately with a confirmation banner and the resident experience updates seamlessly.
4. **Given** an institution has 200+ residents, **When** the admin views the performance dashboard, **Then** all aggregated metrics render within 3 seconds with smooth loading skeletons, even at peak usage.

---

### Edge Cases

- What happens when a resident submits a case with a template that has been updated or deleted by a director since they started filling it?
- How does the mobile app handle rapid successive case submissions (resident logging 5+ cases back-to-back after a busy shift) without data loss or UI freezing?
- What happens when a supervisor rejects a case — how is the feedback communicated to the resident, and how do they resubmit?
- How does the system handle a resident who switches institutions/programs mid-training — their case history must follow them? (Deferred: requires cross-tenant data migration tooling; out of scope for this feature)
- What happens when multiple supervisors attempt to approve the same case simultaneously?
- How does the de-identification toggle affect what supervisors see in the verification view?
- **Concurrent supervisor approval**: The database MUST use a row-level lock (SELECT ... FOR UPDATE) or conditional UPDATE on approval_requests to prevent race conditions when two supervisors approve the same case simultaneously. The second supervisor MUST receive a "Case already reviewed" response.
- How does the system enforce data residency when an institution in Saudi Arabia requires data to stay in GCC region while using the same application instance as EU institutions?
- What happens when AI insights encounter a case with insufficient data — does it gracefully degrade or refuse to generate?
- How does the SaaS billing system handle a lapsed subscription for an institution with 200 active residents — grace period, read-only mode, or immediate suspension? *(Addressed by FR-025: 30-day read-only grace period, then suspension.)*
- What happens when an individual resident subscriber upgrades mid-billing-cycle — pro-rating or immediate full charge?
- How does the system degrade gracefully under burst load of 10,000 concurrent users — which features get priority and which can be deferred?

## Clarifications

### Session 2026-06-11

- Q: Which global medical data protection standards must the system comply with? → A: All global standards from day one (10+ jurisdictions including HIPAA, GDPR, SCFHS, GMC, PIPEDA, Australian Privacy Act, and others)
- Q: What concurrent user scale must the system support for enterprise production readiness? → A: 5,000 concurrent users with burst capacity to 10,000
- Q: How should data residency be enforced for global compliance? → A: Tenant-level region tagging with logical separation within a single database instance
- Q: What medical safety guardrails must the AI assistant enforce? → A: Balanced — AI may identify patterns, suggest study areas, cite guidelines, ask reflective questions; MUST NOT diagnose, prescribe, prognose, or recommend treatments
- Q: How should offline sync handle conflicts when a case is modified both locally and server-side? → A: Server wins with notification — server state is authoritative; resident's offline edits saved as new draft with conflict notification

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Mobile app MUST present case templates as visually distinct specialty cards with medical iconography, specialty name, and required field count.
- **FR-002**: Case logging form MUST be operable with one-handed thumb interaction — all primary inputs and the submit button within the lower 60% of the screen.
- **FR-003**: Case submission MUST trigger haptic feedback and a celebratory micro-animation confirming successful logging.
- **FR-004**: Supervisor verification dashboard MUST display pending cases grouped by resident with profile avatars, specialty badges, and relative time indicators (e.g., "2 hours ago").
- **FR-005**: Case detail view for supervisors MUST present all case data in a glass-panel overlay with clearly distinguished Approve (emerald) and Reject (crimson) actions.
- **FR-006**: Approval and rejection actions MUST trigger animated transitions — the case card exits the pending list with a directional slide animation.
- **FR-007**: Resident progress dashboard MUST feature animated SVG circular progress rings per specialty with glowing completion arcs and percentage labels.
- **FR-008**: All UI elements (buttons, chips, badges, modals, cards, inputs, toggles) MUST use HeroUI component primitives on the web and visually identical NativeWind-built primitives on mobile, with the clinical design token system applied consistently across both platforms.
- **FR-009**: Status badges MUST use the defined glowing style: draft (neutral), pending (glowing amber), approved (glowing emerald), rejected (glowing crimson).
- **FR-010**: The mobile app MUST support offline case logging — cases submitted without connectivity are stored locally and auto-synced when connectivity returns, with a visible sync status indicator.
- **FR-011**: All screens MUST use the clinical slate-indigo backdrop (`#060814` dark mode) with no flat black or gray backgrounds anywhere.
- **FR-012**: Headings MUST render in Outfit font, body text in Inter, and clinical identifiers (MRN hashes, dates, codes) in Geist Mono across all screens.
- **FR-013**: The program director "Program Overview" dashboard MUST show an institution-wide analytics view with: (a) resident completion rates displayed as animated donut charts with segment breakdown by status; (b) pending verification counts as a sortable table with resident names, specialty, pending cases, and days-since-last-activity; (c) specialty distribution as a color-coded horizontal bar chart with hover tooltips showing exact case counts; (d) all charts animated on viewport entry with staggered 50ms delays. This dashboard is distinct from the resident progress dashboard (FR-007) and the resident tracking table (FR-021).
- **FR-014**: Residents MUST receive an in-app notification (badge count or banner) when a supervisor approves or rejects their case.
- **FR-015**: Rejected cases MUST include the supervisor's feedback comment and allow the resident to edit and resubmit from their case detail screen.
- **FR-016**: All modals, sheets, and overlays MUST use glass-panel styling (`backdrop-filter: blur(12px)`, translucent border, diffused shadow) — never solid opaque containers for transient surfaces.
- **FR-017**: System MUST enforce compliance with HIPAA, GDPR, SCFHS, GMC, PIPEDA, Australian Privacy Act, and other applicable global medical data protection standards via de-identification, encryption at rest and in transit, audit trails, data residency controls, and patient consent management.
- **FR-018**: The mobile app MUST include a dedicated AI Insights screen (accessible from the tab bar) that analyzes logged cases and provides supportive, evidence-based clinical reflections without diagnosing or prescribing treatment. The web dashboard MUST embed an AI Insights widget in the resident dashboard view.
- **FR-019**: Institution administrators MUST be able to view a SaaS billing dashboard showing subscription plans, payment history, invoice management, and resident seat counts with upgrade/downgrade capabilities.
- **FR-020**: Individual residents MUST be able to subscribe to premium plans (AI insights, PDF export, unlimited cases) via in-app purchase or web checkout with immediate feature activation.
- **FR-021**: Program directors MUST have access to an institution-wide performance analytics dashboard showing aggregated resident case volumes, verification rates, milestone completion percentages, and specialty distribution across the entire program.
- **FR-022**: System MUST enforce tenant-level data residency via region configuration — each tenant's data tagged with a geographic region constraint that governs storage location, backup storage, and processing jurisdiction.
- **FR-023**: AI assistant MUST enforce medical safety guardrails: it MAY identify clinical patterns, suggest study areas, cite medical guidelines, and ask reflective questions; it MUST NOT diagnose conditions, prescribe medications, make prognosis statements, or recommend specific treatments. Every AI response MUST include a visible disclaimer that it is educational only and not medical advice.
- **FR-024**: Offline sync MUST resolve conflicts using server-authoritative strategy — when a case is modified both locally and server-side, the server state wins; the resident's offline edits are preserved as a new draft with a clear in-app notification explaining the conflict and offering one-tap resubmission.
- **FR-025**: When an institutional subscription lapses or enters past_due status, the system MUST enter a 30-day read-only grace period for that tenant. During the grace period, residents and supervisors MAY view existing cases but MUST NOT log new cases or submit approvals; the admin dashboard MUST display a prominent billing banner with a "Renew Now" action. After the grace period expires, the tenant MUST be suspended until payment is restored.

### Key Entities *(include if feature involves data)*

- **Case Entry**: A resident's logged procedure with template fields, patient de-identified data, status (draft/pending/approved/rejected), and accreditation mappings. The core entity around which all workflows revolve.
- **Approval Request**: Links a case entry to a supervisor, tracks approval status, reviewer comments, and timestamps. Represents the verification workflow state.
- **Resident Profile**: Contains the resident's identity, specialty, assigned program, and accreditation goal targets. Governs what dashboards and progress views are shown.
- **Program Goal**: A director-defined target (e.g., "50 laparoscopic cholecystectomies") linked to a resident with a deadline and progress counter.
- **Case Template**: A specialty-specific form structure defining required and optional fields, used to generate the case logging form dynamically.
- **Subscription Plan**: A pricing tier (Free, Premium, Institutional Basic/Pro/Enterprise) defining features, case limits, AI access, and pricing for individual residents and institutions.
- **AI Insight Query**: A resident's natural-language question about their case history with an AI-generated response, logged for audit and quality review.
- **Institution Billing Record**: A periodic invoice for institutional tenants tracking active resident seats, per-resident fees, total amount, and payment status.
- **Compliance Configuration**: Per-tenant settings for data residency region, retention policies, consent requirements, and applicable regulatory frameworks governing that tenant's data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A resident can complete a new case log from template selection to submission confirmation in under 60 seconds on mobile.
- **SC-002**: 90% of case logging interactions are achievable with one thumb without requiring the user to reposition their grip.
- **SC-003**: Supervisors can review and take action (approve/reject) on a pending case in under 15 seconds from the verification feed.
- **SC-004**: The mobile app design achieves a System Usability Scale (SUS) score of 85+ when tested with medical residents in a clinical setting.
- **SC-005**: Design consistency score between mobile and web exceeds 95% when evaluated against the DESIGN.md token checklist (colors, typography, elevation, motion, component states).
- **SC-006**: Offline case submissions sync successfully within 30 seconds of connectivity restoration with zero data loss across 100 consecutive offline-online cycles.
- **SC-007**: 100% of interactive elements meet WCAG AAA contrast ratio minimums (7:1 for body text, 4.5:1 for large text).
- **SC-008**: Resident engagement (cases logged per week per active resident) increases by 30% compared to a basic form-based logging interface.
- **SC-009**: System passes compliance audits for HIPAA, GDPR, SCFHS, and GMC within a single audit cycle without critical findings — verified via external penetration testing and data protection impact assessment.
- **SC-010**: AI insights generate clinically relevant, non-diagnostic reflections with 95% relevance rating from supervising physicians in blind quality reviews.
- **SC-011**: Institution SaaS billing workflow (plan selection → payment → activation → seat management) completes end-to-end in under 5 minutes for new institutional customers.
- **SC-012**: Institution-wide performance dashboard renders aggregated data for up to 500 residents within 3 seconds of page load.
- **SC-013**: System maintains 99.9% uptime (excluding planned maintenance) with full disaster recovery capability restoring service within 4 hours of a catastrophic failure.
- **SC-014**: System supports 5,000 concurrent active users with burst capacity to 10,000 while maintaining sub-500ms API response times for 95th percentile of requests.

## Assumptions

- The existing HeroUI component library (`@heroui/react` v3.1+) is available and configured in the web application, and equivalent HeroUI-compatible primitives will be implemented for React Native on mobile using NativeWind with matching design tokens.
- The Supabase backend with RLS, triggers, and audit trails remains the data layer — this specification focuses on the UI/UX and workflow layer above it.
- The shared `@elogbook/shared` package with Zod schemas and TypeScript types continues to serve as the validation and type contract for both platforms.
- Magic link authentication for mobile remains the primary login method; password login is available on web.
- The existing de-identification infrastructure (`is_deidentified` toggle, `patient_hash`, `patient_age_years`) is functional and does not require changes for this feature.
- Program directors and consultants access the verification dashboard primarily via mobile during their rounds, with the web dashboard serving as the detailed review and reporting interface.
- Dark mode is the default and primary theme; light mode is secondary.
- Global compliance with HIPAA, GDPR, SCFHS, GMC, PIPEDA, and Australian Privacy Act will be achieved through the highest-common-denominator approach — implementing the strictest requirement from each standard as the universal baseline.
- Data residency will be handled at the tenant configuration level, allowing each institution to specify their required data storage region without fragmenting the application codebase.
- SaaS billing supports multiple payment gateways (Stripe primary, Paddle/LemonSqueezy secondary) with webhook-based subscription lifecycle management.
- AI functionality leverages the existing multi-provider architecture (OpenAI, Anthropic, Azure, OpenRouter) with strict guardrails preventing diagnostic or treatment-recommendation outputs.
