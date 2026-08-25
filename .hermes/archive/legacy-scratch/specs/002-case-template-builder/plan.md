# Implementation Plan: Case Template Builder

**Branch**: `feature/case-template-builder` | **Date**: 2026-08-18 | **Spec**: `specs/002-case-template-builder/spec.md`

**Input**: Feature specification from `/specs/002-case-template-builder/spec.md`

## Summary

Build a visual case template builder that replaces the raw-JSON TemplateEditor with a form-based field editor, adds template CRUD with proper RLS, preview, duplication, import/export, and field validation rules. The builder is director+ only; residents get a read-only template picker with preview.

## Technical Context

**Language/Version**: TypeScript 6.0, Node.js 22, React 19

**Primary Dependencies**: Next.js 16 (App Router), Supabase (PostgreSQL 17), Zod v4, Framer Motion, Tailwind CSS v4

**Storage**: PostgreSQL via Supabase (case_templates table with JSONB fields column)

**Testing**: Vitest (unit), Playwright (e2e)

**Target Platform**: Web (responsive), mobile read-only via Expo

**Project Type**: Web application (monorepo: apps/web, apps/mobile, packages/shared)

**Performance Goals**: Template list <200ms, field editor interactions <50ms, save <500ms

**Constraints**: Must work with existing RLS policies, must not break existing case creation flow, must follow DESIGN.md tokens

**Scale/Scope**: ~10 templates per tenant, ~20 fields per template, 50 concurrent editors

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Security & Compliance First | PASS | RLS enforced on case_templates; audit trigger exists; field validation prevents injection |
| II. Clinical Precision UX | PASS | Will use DESIGN.md tokens; visual builder must follow panel/glass-panel patterns |
| III. Schema-Driven Development | PASS | Zod schemas in @elogbook/shared already exist for templates; will extend |
| IV. Offline-First Mobile | PASS | Mobile gets read-only template view; no builder on mobile |
| V. Role-Based Multi-Tenancy | PASS | RLS already enforces director+ for mutations; global template pattern preserved |

## Project Structure

### Documentation (this feature)

```text
specs/002-case-template-builder/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── contracts/           # Phase 1 output
```

### Source Code (repository root)

```text
apps/web/
├── app/(authenticated)/[tenant]/admin/templates/
│   └── page.tsx                    # Template management page (replaces admin tab)
├── components/
│   ├── TemplateBuilder.tsx          # Main visual builder component
│   ├── FieldEditor.tsx              # Individual field editor row
│   ├── FieldList.tsx                # Drag-and-drop field list
│   ├── TemplatePreview.tsx          # Preview modal
│   ├── TemplateImportExport.tsx     # Import/export UI
│   └── TemplateCard.tsx             # Template card for picker (enhanced)
├── app/api/[tenant]/templates/
│   ├── route.ts                     # GET (list), POST (create)
│   └── [id]/route.ts               # GET (one), PUT (update), DELETE
├── app/api/[tenant]/templates/[id]/duplicate/
│   └── route.ts                     # POST (duplicate)
└── app/api/[tenant]/templates/import/
    └── route.ts                     # POST (import from JSON)

packages/shared/
├── src/types/database.ts            # Add TemplateField v2 type
├── src/schemas/cases.ts             # Extend templateFieldSchema with validation rules
└── src/constants/templates.ts       # Field type definitions, default templates

supabase/migrations/
└── YYYYMMDD_template_builder.sql    # Add validation_rules, description, default_value, order to fields
```

**Structure Decision**: Extends existing monorepo structure. New API routes follow existing `[tenant]/` pattern. Components live alongside existing TemplateEditor.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | All changes fit within existing architecture | N/A |
