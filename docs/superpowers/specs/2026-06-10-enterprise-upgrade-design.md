# Design Spec: E-Logbook Enterprise Upgrade

**Date:** 2026-06-10
**Source:** `upgrade/DESIGN.md`, `upgrade/implementation_plan.md`, `upgrade/PRODUCT.md`

## Overview

Upgrade the existing e-logbook system into an enterprise-grade clinical SaaS with HIPAA/GDPR compliance, accreditation framework mapping, offline mobile capability, and a premium clinical UI design system.

## User Decisions

| Decision | Choice |
|---|---|
| Patient identifiers | Both modes: configurable de-identification + optional encryption |
| Offline mobile DB | WatermelonDB with sync engine |
| Payments | Both individual Stripe Checkout + B2B institutional invoicing |
| Accreditation | Full framework directory with milestone mapping |

## Track 1: Database & Supabase Backend

### Schema Changes (new migration file)
- **`case_entries` additions:**
  - `patient_age_years` (INTEGER, nullable) — replaces DOB in de-identified mode
  - `patient_hash` (TEXT, nullable) — cryptographically salted one-way hash of MRN for collision checking
  - `accreditation_mappings` (JSONB, default `[]`) — links cases to specific educational milestones
  - `is_deidentified` (BOOLEAN, default `true`)
- **New table `accreditation_frameworks`:**
  - `id`, `tenant_id`, `name`, `version`, `milestones` (JSONB), `created_at`, `updated_at`
  - Milestones contain: code, description, competency_area, target_minimum, specialty
- **New table `attachment_signatures`:**
  - `id`, `attachment_id`, `resident_id`, `signature_hash`, `verified_at`, `method`

### RLS Hardening
- Write-once immutability: residents can UPDATE case_entries only when status='draft'
- Cross-tenant isolation: supervisors can only read cases within their tenant
- Audit trigger captures user-agent, session signature, detailed change diffs

### Database Functions
- `hash_patient_mrn(mrn TEXT, salt TEXT)` — one-way hash function
- `calculate_age_at_procedure(dob DATE, procedure_date DATE)` — age computation

## Track 2: Shared Package (@elogbook/shared)

### Types (`database.ts`)
- Add rows for new/accredited tables
- Update CaseEntry type with new fields
- Add AccreditationFramework, AttachmentSignature, AccreditationMapping types

### Schemas (`cases.ts`)
- Conditional Zod validation: when `is_deidentified=true`, require `patient_age_years` + `patient_hash`, forbid `patient_mrn`/`patient_dob`
- When `is_deidentified=false`, require `patient_mrn`/`patient_dob`
- Add `AccreditationMappingSchema`, `AccreditationFrameworkSchema`

## Track 3: Web Application (@elogbook/web)

### New Components
- **`CompetencyManager.tsx`** — Program Directors upload/edit accreditation curriculums, map templates to milestones. Tabbed interface: Framework List, Milestone Editor, Template Mapping.
- **`ApprovalsDashboard.tsx`** — Supervisor portal with inline quick-verify, rejection feedback loop, verification history timeline, batch approve.

### Modified Components
- **`CaseForm.tsx`** — Redesign with:
  - Multi-step wizard (Template Select → Patient Info → Case Details → Review)
  - De-identification step with HIPAA explanation and toggle
  - Dynamic milestone mapping based on template selection
  - Glow-validated required fields
- **`globals.css`** — Add design tokens:
  - CSS custom properties for color palette (slate-indigo backdrop `#060814`, teal primary `#0D9488`, indigo secondary `#6366F1`)
  - Glassmorphic utility classes (`.glass-panel`, `.glass-border`)
  - Font imports: Outfit (headings), Inter (body), Geist Mono (clinical data)
  - Glow badge classes for case statuses (amber pending, emerald approved, crimson rejected)
  - Motion transition tokens

### Visual Upgrades (apply DESIGN.md across all pages)
- Color palette replacement across all components
- Typography: Outfit for headings, Geist Mono for MRNs/dates/codes
- Glassmorphic cards with backdrop blur replacing hard borders
- Animated SVG KPI progress rings for goal tracking
- Framer Motion transitions for list additions/modals

## Track 4: Mobile Application (@elogbook/mobile)

### New Files
- **`lib/sync.ts`** — WatermelonDB sync engine:
  - Local database with mirror of case_entries + templates
  - Pull: fetch cases from Supabase on app open / reconnect
  - Push: sync local drafts when connectivity restored
  - Conflict resolution: mark local drafts with error state if server validation fails
  - Connection health monitoring via NetInfo

### Modified Files
- **`log-case.tsx`** — Enhanced offline logging:
  - Cached templates from local WatermelonDB
  - Haptic feedback on save/submit
  - expo-camera integration for barcode scanning → de-identified hashes
  - Offline indicator banner

## Track 5: Design System Integration

Apply tokens from DESIGN.md systematically:
1. Replace all hardcoded colors with CSS variables
2. Add Outfit/Geist Mono font configuration
3. Replace nested bordered cards with glassmorphic panels
4. Add glow badge styles for case statuses
5. Add Framer Motion transitions to page/layout components
6. KPI progress rings using SVG for goal tracking
7. Monospace styling for all clinical data fields (MRNs, DOBs, codes)

## Verification

- `pnpm --filter @elogbook/shared typecheck` — shared types
- `pnpm --filter @elogbook/web typecheck` — web types
- `pnpm --filter @elogbook/mobile typecheck` — mobile types
- `pnpm --filter @elogbook/web lint` — web lint
- `pnpm --filter @elogbook/mobile lint` — mobile lint
- Supabase migration applies cleanly: `supabase db reset`
