# API Contracts: Case Template Builder

## Base URL
All endpoints are scoped: `/api/[tenant]/templates`

## Authentication
All endpoints require authenticated Supabase session. Role checks enforced per endpoint.

---

## GET /api/[tenant]/templates

List templates for the tenant (including global templates).

**Auth**: All authenticated roles
**RLS**: `tenant_id = get_tenant_id() OR tenant_id = GLOBAL_TENANT_ID`

**Response 200**:
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "General Surgery Log",
      "specialty": "Surgery",
      "fields": [{ "key": "...", "label": "...", "type": "text" }],
      "required_fields": ["procedure_name"],
      "created_at": "2026-08-18T00:00:00Z",
      "updated_at": "2026-08-18T00:00:00Z",
      "usage_count": 42,
      "is_global": false
    }
  ]
}
```

---

## POST /api/[tenant]/templates

Create a new template.

**Auth**: director, institution_admin, admin
**RLS**: `tenant_id = get_tenant_id() AND role IN (director, institution_admin, admin)`

**Request Body**:
```json
{
  "name": "General Surgery Log",
  "specialty": "Surgery",
  "fields": [
    {
      "key": "procedure_name",
      "label": "Procedure Name",
      "type": "text",
      "required": true,
      "description": "Name of the procedure performed",
      "validation": { "minLength": 2, "maxLength": 200 }
    },
    {
      "key": "supervision_level",
      "label": "Supervision Level",
      "type": "select",
      "options": ["Independent", "Direct Supervision", "Indirect Supervision"],
      "required": true
    }
  ],
  "required_fields": ["procedure_name", "supervision_level"]
}
```

**Response 201**:
```json
{
  "template": {
    "id": "uuid",
    "name": "General Surgery Log",
    "specialty": "Surgery",
    "fields": [...],
    "required_fields": [...],
    "created_at": "...",
    "updated_at": "..."
  }
}
```

**Errors**:
- `400` - Validation failed (duplicate keys, missing options, etc.)
- `403` - Insufficient permissions
- `409` - Template with same name+specialty already exists

---

## GET /api/[tenant]/templates/[id]

Get a single template.

**Auth**: All authenticated roles
**RLS**: `tenant_id = get_tenant_id() OR tenant_id = GLOBAL_TENANT_ID`

**Response 200**:
```json
{
  "template": { ... }
}
```

---

## PUT /api/[tenant]/templates/[id]

Update an existing template.

**Auth**: director, institution_admin, admin
**RLS**: `tenant_id = get_tenant_id() AND role IN (director, institution_admin, admin)`
**Restriction**: Cannot update global templates (tenant_id = GLOBAL_TENANT_ID)

**Request Body**: Same as POST (partial update supported)

**Response 200**:
```json
{
  "template": { ... }
}
```

**Errors**:
- `400` - Validation failed
- `403` - Insufficient permissions or attempting to edit global template
- `404` - Template not found

---

## DELETE /api/[tenant]/templates/[id]

Soft-delete a template.

**Auth**: director, institution_admin, admin
**RLS**: `tenant_id = get_tenant_id() AND role IN (director, institution_admin, admin)`
**Restriction**: Cannot delete if case_entries reference this template (ON DELETE RESTRICT)

**Response 200**:
```json
{
  "success": true,
  "message": "Template deleted"
}
```

**Errors**:
- `403` - Insufficient permissions
- `404` - Template not found
- `409` - Template has existing case entries (cannot delete)

---

## POST /api/[tenant]/templates/[id]/duplicate

Duplicate a template with a new name.

**Auth**: director, institution_admin, admin

**Request Body**:
```json
{
  "name": "General Surgery Log (Copy)"
}
```

**Response 201**:
```json
{
  "template": { ... }
}
```

---

## POST /api/[tenant]/templates/import

Import a template from JSON.

**Auth**: director, institution_admin, admin

**Request Body**:
```json
{
  "template_data": {
    "elogbook_template_version": 1,
    "template": {
      "name": "Imported Template",
      "specialty": "Surgery",
      "fields": [...],
      "required_fields": [...]
    }
  }
}
```

**Response 201**:
```json
{
  "template": { ... },
  "warnings": []
}
```

---

## GET /api/[tenant]/templates/export/[id]

Export a template as JSON.

**Auth**: All authenticated roles

**Response 200** (Content-Type: application/json):
```json
{
  "elogbook_template_version": 1,
  "exported_at": "2026-08-18T00:00:00Z",
  "template": {
    "name": "...",
    "specialty": "...",
    "fields": [...],
    "required_fields": [...]
  }
}
```
