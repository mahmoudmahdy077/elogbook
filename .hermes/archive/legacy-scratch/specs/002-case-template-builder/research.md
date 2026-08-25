# Research: Case Template Builder

## Decision 1: Field Builder Approach

**Decision**: Form-based field editor with drag-and-drop reordering (using `@dnd-kit/core`)

**Rationale**: 
- Form-based is more accessible and intuitive than JSON editing
- `@dnd-kit` is the modern React DnD library (maintained, accessible, touch-friendly)
- Aligns with clinical UX principle - directors are not developers

**Alternatives considered**:
- Raw JSON editor with syntax highlighting: Rejected - not clinical UX, error-prone
- Block-based editor (like Notion): Rejected - overkill for structured form fields
- React DnD (old library): Rejected - unmaintained, poor touch support

## Decision 2: Field Schema Extension

**Decision**: Extend the existing `TemplateField` interface with optional properties rather than replacing it

**Rationale**:
- Backward compatible with existing templates
- Existing `fields` JSONB column can store new properties without migration
- Zod schema can be extended with `.optional()` for new fields

**New properties**:
```typescript
interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
  // New v2 properties
  description?: string;      // Help text / placeholder
  defaultValue?: unknown;    // Pre-populated value
  order?: number;            // Explicit ordering (fallback: array index)
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;        // Regex pattern
    patternMessage?: string; // Custom error message
  };
}
```

**Alternatives considered**:
- Separate `template_field_validations` table: Rejected - over-normalized for JSONB schema
- Store validations as separate JSONB column: Rejected - adds complexity without benefit

## Decision 3: Template Preview Implementation

**Decision**: Reuse `CaseDetailsStep` component in a modal with mock data

**Rationale**:
- `CaseDetailsStep` already renders fields dynamically based on template
- Passing a mock `field_values` object shows exactly how the form will look
- No duplicate rendering logic

**Alternatives considered**:
- New preview component: Rejected - duplicating rendering logic
- iframe sandbox: Rejected - overkill, poor UX

## Decision 4: Import/Export Format

**Decision**: JSON format matching the `case_templates` table schema, with metadata wrapper

**Rationale**:
- Direct Supabase compatibility
- JSON is universal, version-controllable
- Metadata wrapper includes schema version for future migrations

**Export format**:
```json
{
  "elogbook_template_version": 1,
  "exported_at": "2026-08-18T00:00:00Z",
  "template": {
    "name": "General Surgery Log",
    "specialty": "Surgery",
    "fields": [...],
    "required_fields": [...]
  }
}
```

**Alternatives considered**:
- CSV: Rejected - can't represent nested field structures
- YAML: Rejected - no benefit over JSON, adds parser dependency
- Custom binary format: Rejected - not portable

## Decision 5: Drag-and-Drop Library

**Decision**: `@dnd-kit/core` + `@dnd-kit/sortable`

**Rationale**:
- Accessible (ARIA live regions, keyboard support)
- Touch-friendly (works on tablets)
- Lightweight (~10KB gzipped)
- Modern React 19 compatible
- Used by major products (Notion, Figma)

**Alternatives considered**:
- react-beautiful-dnd: Deprecated
- react-dnd: Heavier, less accessible
- Custom implementation: Too much work for accessibility compliance

## Decision 6: Validation Rules Enforcement

**Decision**: Client-side validation in the field editor + server-side validation in the Zod schema

**Rationale**:
- Client-side gives instant feedback in the builder
- Server-side ensures data integrity regardless of client
- Both use the same Zod schema as source of truth

**Alternatives considered**:
- Database CHECK constraints: Rejected - too rigid for JSONB field values
- Edge function validation: Rejected - adds latency, unnecessary complexity

## Decision 7: Template Uniqueness

**Decision**: Unique constraint on (tenant_id, name, specialty) where deleted_at IS NULL

**Rationale**:
- Prevents confusing duplicate templates within a tenant
- Soft-delete means the constraint must be partial (NULL deleted_at)
- Global templates use sentinel tenant_id, so they're naturally scoped

**Alternatives considered**:
- No uniqueness constraint: Rejected - confusing for users
- Unique on name only: Rejected - same name different specialty should be allowed
