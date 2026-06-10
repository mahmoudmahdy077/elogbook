# Implementation Plan: E-Logbook Enterprise Upgrade

This plan outlines the roadmap and technical specifications to upgrade the existing electronic logbook system into a full, enterprise-level electronic logbook for medical residents globally.

---

## User Review Required

Please review the proposed security controls (de-identification, encryption, and write-once immutability) and the custom accreditation mapping architecture. We must ensure these conform to your target clinical environments.

> [!WARNING]
> Storing Patient MRNs (Medical Record Numbers) and DOBs (Dates of Birth) in plaintext is a severe compliance violation under HIPAA and GDPR. This plan proposes immediate database-level migrations to encrypt these fields or replace them with de-identified hashes.

---

## Open Questions

### 1. Patient Identifiers & HIPAA Compliance
* **Current State:** The database stores `patient_mrn` (plaintext) and `patient_dob` (plaintext date).
* **Question:** Do you want us to support a **strict de-identification mode** (Safe Harbor compliant) where no MRN or full birth date is stored (storing only age at procedure and a cryptographically salted one-way hash of the MRN for collision checking), or should we implement **database-level encryption** (using PG-Crypto or similar) for environments where MRNs must be stored but must not be visible to unauthorized users?

### 2. Offline Database Strategy for Mobile App
* **Current State:** The mobile app relies entirely on online Supabase queries.
* **Question:** For offline case logging (since residents frequently work in shielded lead-lined ORs and radiology wards with no signal), should we integrate **WatermelonDB** or **SQLite with a custom sync engine**? WatermelonDB is highly optimized for React Native sync but adds build complexity, while SQLite with custom syncing allows precise control.

### 3. Payment Gateway Scope
* **Current State:** Stripe logic is partially implemented.
* **Question:** Since this is an enterprise system, will billing be handled primarily at the **institution/hospital level** (B2B SaaS with invoices), or do we need to fully support **individual residents buying premium features** via mobile in-app purchases or Stripe checkout?

### 4. Accreditation Frameworks
* **Current State:** Goal tracking is a simple numeric count per resident.
* **Question:** Should we implement a structured **Competency/Milestone Directory** where program directors can upload official curriculum requirements (e.g., ACGME milestones, SCFHS logs, GMC competencies) and map log templates directly to these milestones?

---

## Proposed Changes

We will upgrade the system across four main domains: **Security & Compliance**, **Accreditation & Workflows**, **Offline Mobile Engine**, and **Premium UI/UX Design**.

### 1. Database & Supabase Backend
We will harden the data tier and implement enterprise compliance features.

#### [MODIFY] [00001_schema.sql](file:///g:/elogbook/supabase/migrations/00001_schema.sql)
* Update `case_entries` table to support de-identification properties:
  - Add `patient_age_years` (integer) to replace birth date in de-identified mode.
  - Add `patient_hash` (text) to store one-way salted hashes of MRNs.
  - Add `accreditation_mappings` (jsonb) to link cases to specific educational milestones.
  - Add `is_deidentified` (boolean) default true.
* Introduce an `accreditation_frameworks` table to define milestones, competency rules, and procedural target minimums.
* Add an `attachment_signatures` table to cryptographically verify files uploaded by residents.

#### [MODIFY] [00002_rls_policies.sql](file:///g:/elogbook/supabase/migrations/00002_rls_policies.sql)
* Reinforce RLS for `case_entries`:
  - Ensure residents can *never* modify a case entry once its status moves from `draft` to `pending` or `approved` (write-once immutability).
  - Prevent residents from reading other residents' cases entirely.
  - Restrict supervisors to reading only cases assigned to them or within their departments.
  - Add audit trigger checks to enforce blocklists on queries.

#### [MODIFY] [00003_triggers.sql](file:///g:/elogbook/supabase/migrations/00003_triggers.sql)
* Hardened `audit_case_entry` trigger to capture detailed user-agent data, session signatures, and changes.
* Add a trigger to block updates to submitted logs unless rejected by a supervisor.

---

### 2. Shared Packages (`@elogbook/shared`)
Establish the common validation rules and types.

#### [MODIFY] [database.ts](file:///g:/elogbook/packages/shared/src/types/database.ts)
* Update shared types to match the new `is_deidentified`, `patient_age_years`, `patient_hash`, and `accreditation_mappings` fields.
* Add types for accreditation frameworks, competency logs, and sync status payloads.

#### [MODIFY] [cases.ts](file:///g:/elogbook/packages/shared/src/schemas/cases.ts)
* Enhance Zod validation schemas to conditionally validate patient data based on the `is_deidentified` toggle.
* Add schemas for milestone validation.

---

### 3. Web Application (`@elogbook/web`)
Create the core administrative, analytics, and workflow components with rich, modern design.

#### [NEW] [CompetencyManager.tsx](file:///g:/elogbook/apps/web/components/CompetencyManager.tsx)
* A component for Program Directors to upload and edit accreditation curriculums and associate them with case templates.

#### [NEW] [ApprovalsDashboard.tsx](file:///g:/elogbook/apps/web/components/ApprovalsDashboard.tsx)
* A supervisor-focused review portal allowing quick inline verification, rejection feedback loops, and verification history.

#### [MODIFY] [CaseForm.tsx](file:///g:/elogbook/apps/web/components/CaseForm.tsx)
* Redesign CaseForm with modern styling:
  - Interactive validation for required template fields.
  - Interactive "De-identify Patient Info" wizard explaining HIPAA rules.
  - Dynamic mapping to accreditation milestones.

#### [MODIFY] [globals.css](file:///g:/elogbook/apps/web/app/globals.css)
* Add a global theme configuration with:
  - Deep dark mode backing (e.g., slate/zinc neutral tones).
  - Vibrant accent colors (medical emerald/teal and indigo).
  - Glassmorphic helper classes (backdrop filter blur, thin glowing borders).

---

### 4. Mobile Application (`@elogbook/mobile`)
Bring premium offline capability and simplified procedure logging.

#### [NEW] [sync.ts](file:///g:/elogbook/apps/mobile/lib/sync.ts)
* Custom SQLite or WatermelonDB replication service:
  - Intercepts requests when offline, saving draft cases locally.
  - Monitors connection health and pushes synchronized cases to Supabase when network is restored.
  - Resolves conflicts by marking local drafts with error states if Supabase validation fails.

#### [MODIFY] [log-case.tsx](file:///g:/elogbook/apps/mobile/app/(tabs)/log-case.tsx)
* Enhance layout to support quick offline logging:
  - Cached templates available offline.
  - Haptic feedback on action steps.
  - Integration with `expo-camera` to scan hospital stickers or barcodes and convert them into de-identified hashes.

---

### 5. Design System & UI/UX Upgrades (Impeccable Design Integration)
We will leverage the Impeccable design framework to transition the user interfaces away from generic SaaS styles into a premium, professional clinical system.

#### 1. Setup & Context Grounding
All design and implementation agents must strictly reference the project's [PRODUCT.md](file:///g:/elogbook/PRODUCT.md) and [DESIGN.md](file:///g:/elogbook/DESIGN.md) configurations before styling or restructuring elements.

#### 2. Visual Upgrades & Anti-Pattern Elimination
* **Color System**: Replace the flat, dark-gray theme with a clinical slate-indigo gradient backdrop (`#060814`) in Next.js (`globals.css`) and NativeWind configs. All dark panels must contain subtle color tints—never use raw `#000` or `#121212` blocks.
* **Typography Refactoring**: Import and configure the `Outfit` font for headings and structural labels in the web application (using Google Fonts or local imports) and the mobile application. All clinical data identifiers (like MRNs and dates) must utilize a monospace font (`Geist Mono`) to separate them visually from general text.
* **Structural Layering**: Remove nested cards. Instead, separate interface modules using:
  - Transparent backdrop blur panels (`backdrop-filter: blur(12px)`) with thin borders.
  - Generous padding and spacing layout grids (`gap-6`, `p-6`) rather than heavy boxes.
  - Soft glowing borders on focused elements.

#### 3. UX Workflows & Delight Features
* **Case Logger Wizard**: Evolve the procedure entry forms on both web and mobile into a multi-step logging wizard. Add a dedicated "De-identification Check" step that visibly hashes the patient's MRN and displays a warning when full PII is typed.
* **Tactile Interactions**: Use micro-motion effects (`framer-motion`) for list transitions and additions on the web, and layout transition animations on mobile. Ensure mobile buttons execute subtle haptic impulses on trigger.
* **Accreditation Dashboard**: Replace boring stats cards with circular SVG progress rings showing milestone completion rates.

---

## Verification Plan

### Automated Tests
1. **Zod Validation Tests**:
   - `pnpm --filter @elogbook/shared test` (add Vitest suite to package).
2. **RLS Policy Verification**:
   - Run Supabase test suite using `supabase test db`.

### Manual Verification
1. **Offline Mode Simulation**:
   - Place device in Airplane mode, log a surgical case. Verify case is saved to local store.
   - Restore connection. Verify case syncs to Supabase, updates status to `draft`/`pending`, and triggers auditor functions.
2. **PII Verification**:
   - Inspect database tables after submitting a case with de-identification active. Verify no MRNs are present in plaintext.

---

## Agent Coding Standards & Validation Protocols (The Karpathy & ECC Development Recipe)

Any AI model or agent working on this codebase MUST act as a first-principles engineer and a severe critic of its own work, adopting the developer roles advocated by Andrej Karpathy and the Everything Claude Code (ECC) guidelines.

### 1. The "Build It from Scratch" First-Principles Role
* **Rule**: Do not add a library, utility, or database abstraction without understanding its underlying mechanics.
* **Under the Hood Check**: Before writing code, you must locate the dependent layers. For instance:
  - If writing a database migration, you must map the RLS logic down to the query planner and JWT metadata.
  - If editing the mobile sync engine, trace the SQLite schema and synchronization loops in raw SQL before wrapping them in high-level handlers.
* **Zero Guessing**: Do not import undefined files or guess at library APIs. If a type or helper function does not exist in `@elogbook/shared`, write/export it explicitly with robust typings.

### 2. The "Recipe for Training & Code Assembly" Role
Adhere strictly to Karpathy's incremental training recipe, adapted for full-stack software development:
1. **Visualize and Inspect the Data**:
   - Before coding a feature, query the existing tables or read the component states to understand the current shapes.
   - Print out data objects and structure shapes during execution to ensure no type mismatch.
2. **Overfit a Single Case (Mock first)**:
   - When building a new integration (e.g., the de-identification engine or Stripe webhook), implement the simplest possible mock path or hardcoded test.
   - Verify that this single case succeeds before writing the generalized version.
3. **Grow Incrementally (From Scratch to Hero)**:
   - Build features step-by-step: Database Schema -> Zod Model -> API Endpoint -> React UI Component.
   - Stop and compile after each step. Never write a giant block of multi-layered code and try to debug it all at once.

### 3. The "Severe Critic" Self-Review Role
You must act as a critic of your own work before submitting it:
* **The 2 AM Code Rule**: Treat your initial code draft as if it was "written at 2 AM" and is likely wrong. Review it line-by-line.
* **Critique Checklist**:
  - *Are there any implicit type conversions or 'any' types?* (Strict types only).
  - *Could this edit break the mobile offline database?*
  - *Does this change introduce a patient privacy leak?* (Verify MRN and DOB sanitization).
  - *Are we using proper clean code variables and comments that explain the 'why' instead of the 'what'?*

### 4. Everything Claude Code (ECC) Coding Standards
To ensure high-quality software execution, all code modifications must align with the following ECC principles:
* **Immutability (CRITICAL)**: Always create new copies of objects or arrays. Never mutate parameters or state in place (e.g., use object spread `...`, map/filter, or Immer).
* **KISS, DRY, YAGNI**:
  - Keep the implementation as simple as possible. Avoid premature optimizations.
  - Extract duplicated logic into `@elogbook/shared` helpers.
  - Do not write speculative code or abstractions for features that "might be needed later."
* **File Size & Cohesion**: Keep files small (200-400 lines typical, 800 lines absolute maximum). Extract logical subunits into separate files.
* **Public Boundary Typing**: Every exported function, react component props, hook, and API must define explicit parameter and return types. Let TypeScript infer simple local variables.
* **Error Handling**: Never swallow errors silently or write empty catch blocks. Always log detailed error contexts on the server-side, and map them to clean, user-friendly messages on UI boundaries.

### 5. "Vibe Coding" with First-Principles Guardrails
While you may use natural language directing to iterate quickly on UI/UX components:
* You **must not** treat code as a black box. You are responsible for every line of generated code.
* You **must** run strict compilation and validation checks after every single iteration.

#### Mandatory Integration Validation Gate:
Before declaring any task complete, the agent must run and pass:
1. **TypeScript Verification**:
   ```bash
   pnpm --filter @elogbook/web typecheck
   pnpm --filter @elogbook/mobile typecheck
   pnpm --filter @elogbook/shared typecheck
   ```
2. **Linter Verification**:
   ```bash
   pnpm --filter @elogbook/web lint
   pnpm --filter @elogbook/mobile lint
   ```
3. **Supabase Migration Sandbox Reset**:
   If migrations are changed:
   ```bash
   supabase db reset
   ```
   Confirm all schema migrations and seeds apply without errors.
