# Quickstart: Case Template Builder

## Prerequisites

- E-Logbook running locally (`pnpm dev:web`)
- Supabase running (`supabase start`)
- Authenticated as a user with `director`, `institution_admin`, or `admin` role

## Validation Scenarios

### Scenario 1: Create Template via Visual Builder

1. Navigate to `/{tenant}/admin` → Templates tab
2. Click "Create Template"
3. Enter name: "My Surgery Log"
4. Enter specialty: "Surgery"
5. Click "Add Field"
6. Set label: "Procedure Name", type: "text", required: true
7. Click "Add Field"
8. Set label: "Supervision Level", type: "select", options: "Direct,Indirect,Independent"
9. Click "Save Template"
10. **Expected**: Template appears in list with 2 fields, 2 required

### Scenario 2: Edit Existing Template

1. Click on a template in the list
2. Click "Edit"
3. Drag "Supervision Level" field above "Procedure Name"
4. Add description to "Procedure Name": "Name of the procedure performed"
5. Click "Save"
6. **Expected**: Changes saved, audit log entry created

### Scenario 3: Preview Template

1. Click "Preview" on any template
2. **Expected**: Modal shows the template as it would appear in case creation
3. Fill in some fields
4. **Expected**: Validation rules fire (required fields, min/max, pattern)

### Scenario 4: Duplicate Template

1. Click "Duplicate" on a template
2. Enter new name: "My Surgery Log v2"
3. Click "Duplicate"
4. **Expected**: New template created with same fields, different name

### Scenario 5: Export/Import

1. Click "Export" on a template
2. **Expected**: JSON file downloads
3. Click "Import"
4. Select the downloaded JSON file
5. **Expected**: New template created from import

### Scenario 6: Role Enforcement

1. Log in as a `resident` user
2. Navigate to `/{tenant}/admin`
3. **Expected**: Admin page redirects to dashboard (no access)
4. Navigate directly to `/{tenant}/admin/templates`
5. **Expected**: 404 or redirect (no access)

### Scenario 7: Field Validation

1. Create a template with a "text" field
2. Set validation: minLength=5, maxLength=100
3. Save template
4. Preview template
5. Enter 3 characters in the field
6. **Expected**: Validation error "Minimum 5 characters required"

### Scenario 8: Select Field Validation

1. Create a template with a "select" field
2. Leave options empty
3. Try to save
4. **Expected**: Error "Select fields must have at least one option"

## Run Tests

```bash
# Unit tests for shared schemas
pnpm --filter @elogbook/shared test

# Component tests for TemplateBuilder
pnpm --filter @elogbook/web test -- --run TemplateBuilder

# E2E tests
pnpm --filter @elogbook/web test:e2e -- --grep "template"
```

## Database Reset (if needed)

```bash
supabase db reset
# This re-seeds global templates (Surgery, Radiology)
```
