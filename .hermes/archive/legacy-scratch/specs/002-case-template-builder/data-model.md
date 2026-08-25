# Data Model: Case Template Builder

## Entities

### 1. case_templates (existing, extended)

The core template entity. Already exists; extended with new field properties.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, auto | Template identifier |
| `tenant_id` | UUID | FK -> tenants, NOT NULL | Owning tenant (or global sentinel) |
| `specialty` | TEXT | NOT NULL | Medical specialty |
| `name` | TEXT | NOT NULL | Template display name |
| `fields` | JSONB | NOT NULL | Array of TemplateField objects |
| `required_fields` | JSONB | DEFAULT '[]' | Array of required field keys |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | auto | Last update timestamp |
| `deleted_at` | TIMESTAMPTZ | nullable | Soft-delete timestamp |

### 2. TemplateField (JSONB structure)

Each element in the `fields` JSONB array:

```typescript
interface TemplateField {
  // Required (existing)
  key: string;           // Unique within template, used as field_values key
  label: string;         // Display label
  type: FieldType;       // One of 6 types

  // Optional (existing)
  options?: string[];    // For 'select' type
  required?: boolean;    // Whether field must be filled

  // New v2 properties
  description?: string;        // Help text shown below label
  defaultValue?: unknown;      // Pre-populated value
  order?: number;              // Explicit sort order (fallback: array index)
  validation?: FieldValidation; // Validation rules
}

type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';

interface FieldValidation {
  minLength?: number;    // Min character count (text/textarea)
  maxLength?: number;    // Max character count (text/textarea)
  min?: number;          // Min value (number)
  max?: number;          // Max value (number)
  pattern?: string;      // Regex pattern (text)
  patternMessage?: string; // Custom error message for pattern failure
}
```

### 3. template_favorites (existing)

User's favorited templates. No changes needed.

| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | UUID | FK -> auth.users, PK |
| `template_id` | UUID | FK -> case_templates, PK |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

## Relationships

```
tenants ──1:N── case_templates
case_templates ──1:N── case_entries (template_id FK, ON DELETE RESTRICT)
case_templates ──M:N── auth.users (via template_favorites)
```

## Validation Rules

### Field Key Uniqueness
- All `fields[].key` values within a template MUST be unique
- Enforced by: Zod schema (cross-field validation)
- Error: "Duplicate field key: {key}"

### Required Fields Cross-Check
- All keys in `required_fields` MUST exist in `fields[].key`
- Enforced by: Existing Zod schema (`caseTemplateSchema`)
- Error: "Required field {key} does not exist in fields"

### Select Field Options
- If `type === 'select'`, `options` MUST be a non-empty array
- Enforced by: Zod schema
- Error: "Select fields must have at least one option"

### Template Name Uniqueness
- `(tenant_id, name, specialty)` MUST be unique where `deleted_at IS NULL`
- Enforced by: Partial unique index (new migration)
- Error: "A template with this name and specialty already exists"

### Field Validation Rules
- `minLength` MUST be <= `maxLength` (if both provided)
- `min` MUST be <= `max` (if both provided)
- `pattern` MUST be a valid regex
- Enforced by: Zod schema

## State Transitions

### Template Lifecycle
```
[Created] ──soft-delete──> [Archived]
[Archived] ──restore──> [Active]
[Active] ──edit──> [Active] (with audit log)
```

### Case Entry Template Reference
```
Template (active) ──used by──> Case Entries
Template (deleted) ──blocked──> Cannot create new entries (RESTRICT)
Template (deleted) ──existing──> Existing entries preserved
```

## Migration Plan

### New Migration: `YYYYMMDD_template_builder.sql`

```sql
-- 1. Add partial unique index for template name+specialty
CREATE UNIQUE INDEX idx_case_templates_name_specialty_unique 
  ON case_templates (tenant_id, name, specialty) 
  WHERE deleted_at IS NULL;

-- 2. No schema changes needed (JSONB is flexible)
-- New field properties are stored within existing 'fields' JSONB column
-- Zod schema handles validation of new properties
```

### Shared Types Update: `packages/shared/src/types/database.ts`

```typescript
// Extend TemplateField (additive, backward-compatible)
export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
  // v2 additions
  description?: string;
  defaultValue?: unknown;
  order?: number;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternMessage?: string;
  };
}
```

### Shared Schema Update: `packages/shared/src/schemas/cases.ts`

```typescript
// Extend templateFieldSchema
export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  // v2 additions
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().int().min(0).optional(),
  validation: z.object({
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    patternMessage: z.string().optional(),
  }).optional(),
}).refine(
  (field) => field.type !== 'select' || (field.options && field.options.length > 0),
  { message: 'Select fields must have at least one option' }
);
```
