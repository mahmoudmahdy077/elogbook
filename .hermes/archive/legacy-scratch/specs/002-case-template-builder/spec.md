# Feature Specification: Case Template Builder

## Overview

A visual case template builder that allows residents and program directors to create, customize, and manage case entry templates without writing JSON. Templates define the fields residents fill out when logging clinical cases, and must support both institutional customization and global logbook guidelines (ACGME, SCFHS, etc.).

## User Stories

### Residents
- As a resident, I want to select from pre-built templates so I can quickly start logging cases
- As a resident, I want to see a preview of a template before using it so I know what fields I'll need to fill
- As a resident, I want to favorite templates I use frequently so they appear first

### Program Directors / Admins
- As a director, I want to build templates using a visual drag-and-drop field editor so I don't need to write JSON
- As a director, I want to edit existing templates so I can refine fields based on program needs
- As a director, I want to duplicate a template so I can create variations for different rotations
- As a director, I want to set field validation rules (required, min/max, pattern) so data quality is enforced
- As a director, I want to import/export templates as JSON so I can share across institutions
- As a director, I want to map template fields to accreditation milestones so compliance tracking is automated

### System
- The system must enforce RLS: only director+ can create/edit/delete templates; all authenticated users can view
- The system must support global templates (shared across all tenants) and tenant-specific templates
- The system must audit-log all template mutations

## Requirements

### P0 - Must Have
1. **Visual Field Builder**: Replace raw JSON textarea with a form-based field editor supporting:
   - Field type selector (text, textarea, select, number, date, checkbox)
   - Field label and key auto-generation
   - Required toggle per field
   - Options array for select fields
   - Drag-and-drop reordering
2. **Template CRUD**: Create, read, update, delete templates with proper RLS enforcement
3. **Template Preview**: Preview how a template renders when filling out a case
4. **Template Duplication**: Clone an existing template with a new name

### P1 - Should Have
5. **Field Validation Rules**: Min/max length, pattern regex, custom error messages
6. **Field Descriptions**: Help text / placeholder text per field
7. **Default Values**: Pre-populate fields with default values
8. **Import/Export**: Export templates as JSON, import from JSON file
9. **Template Usage Analytics**: Show how many cases use each template (personal + tenant-wide)

### P2 - Nice to Have
10. **Accreditation Mapping**: Map template fields to ACGME/SCFHS milestones
11. **Template Categories**: Tags/categories beyond just specialty
12. **Conditional Fields**: Show/hide fields based on other field values
13. **Template Versioning**: Version history with rollback

## Acceptance Criteria

- [ ] Director can create a template using only the visual editor (no JSON)
- [ ] Director can add fields of all 6 types (text, textarea, select, number, date, checkbox)
- [ ] Director can reorder fields via drag-and-drop
- [ ] Director can mark fields as required
- [ ] Director can set validation rules (min/max length, pattern)
- [ ] Director can preview a template before saving
- [ ] Director can duplicate an existing template
- [ ] Director can edit an existing template's fields, name, and specialty
- [ ] Director can export a template as JSON
- [ ] Director can import a template from JSON
- [ ] Resident can see template preview when selecting a template
- [ ] All template operations are audit-logged
- [ ] RLS prevents non-director roles from creating/editing/deleting templates
- [ ] Global templates are visible to all tenants but not editable by them

## Edge Cases

- Deleting a template that has existing case entries must be blocked (ON DELETE RESTRICT)
- Importing a template with duplicate field keys must be rejected
- Select fields with empty options array must be rejected
- Template name + specialty combination should be unique per tenant
- Soft-deleted templates must not appear in the template picker

## Out of Scope (v1)

- Real-time collaborative editing
- Template marketplace / sharing between institutions
- AI-assisted template generation
- Mobile template builder (mobile gets read-only view)
