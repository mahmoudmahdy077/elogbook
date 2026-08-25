# Tasks: Case Template Builder

> **For agentic workers:** Execute each task sequentially. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec**: `specs/002-case-template-builder/spec.md`
**Plan**: `specs/002-case-template-builder/plan.md`
**Data Model**: `specs/002-case-template-builder/data-model.md`

---

## Task 1: Extend Shared Types & Schemas

**Files:**
- Modify: `packages/shared/src/types/database.ts`
- Modify: `packages/shared/src/schemas/cases.ts`

- [ ] **Step 1: Extend TemplateField type in database.ts**

Add optional v2 properties to the existing `TemplateField` interface:

```typescript
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

- [ ] **Step 2: Extend templateFieldSchema in cases.ts**

Update the existing `templateFieldSchema` to include v2 properties and add field-level refinement for select fields:

```typescript
export const fieldValidationSchema = z.object({
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  patternMessage: z.string().optional(),
}).refine(
  (v) => v.minLength === undefined || v.maxLength === undefined || v.minLength <= v.maxLength,
  { message: 'minLength must be <= maxLength' }
);

export const templateFieldSchema = z.object({
  key: z.string().min(1, 'Field key is required'),
  label: z.string().min(1, 'Field label is required'),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  order: z.number().int().min(0).optional(),
  validation: fieldValidationSchema.optional(),
}).refine(
  (field) => field.type !== 'select' || (field.options && field.options.length > 0),
  { message: 'Select fields must have at least one option' }
);
```

- [ ] **Step 3: Add field key uniqueness refinement to caseTemplateSchema**

Add a cross-field refinement to ensure no duplicate keys:

```typescript
// Add to existing caseTemplateSchema
.refine(
  (template) => {
    const keys = template.fields.map(f => f.key);
    return keys.length === new Set(keys).size;
  },
  { message: 'Duplicate field keys are not allowed' }
)
```

- [ ] **Step 4: Verify shared package compiles**

Run: `pnpm --filter @elogbook/shared typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/database.ts packages/shared/src/schemas/cases.ts
git commit -m "feat(shared): extend TemplateField schema with v2 properties"
```

---

## Task 2: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDD_template_builder.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Migration: Case Template Builder
-- Adds unique index for template name+specialty within tenant

-- Partial unique index: prevents duplicate template names per specialty per tenant
-- Only applies to non-deleted templates
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_templates_name_specialty_unique
  ON case_templates (tenant_id, name, specialty)
  WHERE deleted_at IS NULL;

-- Comment for documentation
COMMENT ON INDEX idx_case_templates_name_specialty_unique IS
  'Ensures unique template name+specialty per tenant for active templates';
```

- [ ] **Step 2: Verify migration applies**

Run: `supabase db reset` (or `supabase db push` for dev)
Expected: Migration applies without errors

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/YYYYMMDD_template_builder.sql
git commit -m "feat(db): add unique index for template name+specialty"
```

---

## Task 3: Template API Routes

**Files:**
- Create: `apps/web/app/api/[tenant]/templates/route.ts`
- Create: `apps/web/app/api/[tenant]/templates/[id]/route.ts`
- Create: `apps/web/app/api/[tenant]/templates/[id]/duplicate/route.ts`
- Create: `apps/web/app/api/[tenant]/templates/import/route.ts`
- Create: `apps/web/app/api/[tenant]/templates/export/[id]/route.ts`

- [ ] **Step 1: Create GET/POST route (list + create)**

```typescript
// apps/web/app/api/[tenant]/templates/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared/schemas/cases';
import { GLOBAL_TENANT_ID } from '@elogbook/shared/constants/app';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { data: templates, error } = await supabase
    .from('case_templates')
    .select('*')
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Get usage counts
  const { data: usageCounts } = await supabase
    .rpc('get_template_usage_counts', {
      p_tenant_id: profile.tenant_id,
      p_resident_id: profile.id,
    });

  const usageMap = new Map(
    (usageCounts ?? []).map((u: { template_id: string; personal_count: number; tenant_count: number }) => [u.template_id, u])
  );

  const enriched = (templates ?? []).map(t => ({
    ...t,
    is_global: t.tenant_id === GLOBAL_TENANT_ID,
    usage_count: usageMap.get(t.id)?.tenant_count ?? 0,
    personal_count: usageMap.get(t.id)?.personal_count ?? 0,
  }));

  return NextResponse.json({ templates: enriched });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = caseTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // Check uniqueness
  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', parsed.data.name)
    .eq('specialty', parsed.data.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name and specialty already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: parsed.data.name,
      specialty: parsed.data.specialty,
      fields: parsed.data.fields,
      required_fields: parsed.data.required_fields ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template }, { status: 201 });
}
```

- [ ] **Step 2: Create GET/PUT/DELETE route (single template)**

```typescript
// apps/web/app/api/[tenant]/templates/[id]/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared/schemas/cases';
import { GLOBAL_TENANT_ID } from '@elogbook/shared/constants/app';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .select('*')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Check template exists and belongs to tenant (not global)
  const { data: existing } = await supabase
    .from('case_templates')
    .select('id, tenant_id')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  if (existing.tenant_id === GLOBAL_TENANT_ID) {
    return NextResponse.json({ error: 'Cannot edit global templates' }, { status: 403 });
  }

  if (existing.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = caseTemplateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Check for existing case entries
  const { count } = await supabase
    .from('case_entries')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id);

  if (count && count > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${count} case entries reference this template`,
      entry_count: count,
    }, { status: 409 });
  }

  // Soft delete
  const { error } = await supabase
    .from('case_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, message: 'Template deleted' });
}
```

- [ ] **Step 3: Create duplicate route**

```typescript
// apps/web/app/api/[tenant]/templates/[id]/duplicate/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Fetch source template
  const { data: source } = await supabase
    .from('case_templates')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (!source) {
    return NextResponse.json({ error: 'Source template not found' }, { status: 404 });
  }

  const body = await request.json();
  const newName = body.name || `${source.name} (Copy)`;

  // Check uniqueness
  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', newName)
    .eq('specialty', source.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: newName,
      specialty: source.specialty,
      fields: source.fields,
      required_fields: source.required_fields,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template }, { status: 201 });
}
```

- [ ] **Step 4: Create import route**

```typescript
// apps/web/app/api/[tenant]/templates/import/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared/schemas/cases';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const templateData = body.template_data?.template || body;

  const parsed = caseTemplateSchema.safeParse(templateData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // Check uniqueness
  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', parsed.data.name)
    .eq('specialty', parsed.data.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name and specialty already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: parsed.data.name,
      specialty: parsed.data.specialty,
      fields: parsed.data.fields,
      required_fields: parsed.data.required_fields ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template }, { status: 201 });
}
```

- [ ] **Step 5: Create export route**

```typescript
// apps/web/app/api/[tenant]/templates/export/[id]/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { GLOBAL_TENANT_ID } from '@elogbook/shared/constants/app';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .select('name, specialty, fields, required_fields')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const exportData = {
    elogbook_template_version: 1,
    exported_at: new Date().toISOString(),
    template,
  };

  return NextResponse.json(exportData, {
    headers: {
      'Content-Disposition': `attachment; filename="${template.name.replace(/[^a-z0-9]/gi, '_')}.json"`,
    },
  });
}
```

- [ ] **Step 6: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/[tenant]/templates/
git commit -m "feat(api): add template CRUD, duplicate, import, export routes"
```

---

## Task 4: Visual Field Builder Components

**Files:**
- Create: `apps/web/components/FieldEditor.tsx`
- Create: `apps/web/components/FieldList.tsx`
- Create: `apps/web/components/TemplateBuilder.tsx`

- [ ] **Step 1: Create FieldEditor component**

```tsx
// apps/web/components/FieldEditor.tsx
'use client';

import { useState } from 'react';
import type { TemplateField } from '@elogbook/shared/types/database';

interface FieldEditorProps {
  field: TemplateField;
  index: number;
  onUpdate: (index: number, field: TemplateField) => void;
  onRemove: (index: number) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
] as const;

export default function FieldEditor({
  field,
  index,
  onUpdate,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: FieldEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const update = (partial: Partial<TemplateField>) => {
    onUpdate(index, { ...field, ...partial });
  };

  const generateKey = (label: string) => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  };

  return (
    <div
      className={`p-4 rounded-lg border transition-opacity ${isDragging ? 'opacity-50' : ''} ${field.required ? 'border-primary/30 bg-primary/5' : 'border-border'}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="cursor-grab text-text-muted hover:text-text-primary">⠿</span>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 text-left font-medium text-sm"
        >
          {field.label || 'New Field'}
        </button>
        {field.required && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Required</span>
        )}
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-danger hover:text-danger/80 text-sm"
        >
          Remove
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Label</label>
              <input
                type="text"
                value={field.label}
                onChange={(e) => {
                  const label = e.target.value;
                  update({ label, key: field.key || generateKey(label) });
                }}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                placeholder="e.g. Procedure Name"
              />
            </div>
            <div>
              <label className="block text-xs mb-1 text-text-muted">Key</label>
              <input
                type="text"
                value={field.key}
                onChange={(e) => update({ key: e.target.value })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm font-mono"
                placeholder="procedure_name"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1 text-text-muted">Type</label>
              <select
                value={field.type}
                onChange={(e) => update({ type: e.target.value as TemplateField['type'] })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required ?? false}
                  onChange={(e) => update({ required: e.target.checked })}
                  className="rounded border-border"
                />
                <span className="text-sm">Required</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1 text-text-muted">Description (help text)</label>
            <input
              type="text"
              value={field.description ?? ''}
              onChange={(e) => update({ description: e.target.value || undefined })}
              className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
              placeholder="Optional help text shown below the field"
            />
          </div>

          {field.type === 'select' && (
            <div>
              <label className="block text-xs mb-1 text-text-muted">Options (one per line)</label>
              <textarea
                value={(field.options ?? []).join('\n')}
                onChange={(e) => update({ options: e.target.value.split('\n').filter(Boolean) })}
                className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                rows={3}
                placeholder="Option 1&#10;Option 2&#10;Option 3"
              />
            </div>
          )}

          {(field.type === 'text' || field.type === 'textarea') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Min Length</label>
                <input
                  type="number"
                  value={field.validation?.minLength ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, minLength: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Max Length</label>
                <input
                  type="number"
                  value={field.validation?.maxLength ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, maxLength: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  min={0}
                />
              </div>
            </div>
          )}

          {field.type === 'number' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Min Value</label>
                <input
                  type="number"
                  value={field.validation?.min ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, min: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Max Value</label>
                <input
                  type="number"
                  value={field.validation?.max ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, max: e.target.value ? Number(e.target.value) : undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                />
              </div>
            </div>
          )}

          {field.type === 'text' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1 text-text-muted">Pattern (regex)</label>
                <input
                  type="text"
                  value={field.validation?.pattern ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, pattern: e.target.value || undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm font-mono"
                  placeholder="^[A-Z]{2}\\d{4}$"
                />
              </div>
              <div>
                <label className="block text-xs mb-1 text-text-muted">Pattern Error Message</label>
                <input
                  type="text"
                  value={field.validation?.patternMessage ?? ''}
                  onChange={(e) => update({
                    validation: { ...field.validation, patternMessage: e.target.value || undefined }
                  })}
                  className="w-full px-3 py-1.5 rounded-lg bg-neutral-dark border border-border text-sm"
                  placeholder="Invalid format"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create FieldList component (drag-and-drop container)**

```tsx
// apps/web/components/FieldList.tsx
'use client';

import { useState, useCallback } from 'react';
import FieldEditor from './FieldEditor';
import type { TemplateField } from '@elogbook/shared/types/database';

interface FieldListProps {
  fields: TemplateField[];
  onChange: (fields: TemplateField[]) => void;
}

export default function FieldList({ fields, onChange }: FieldListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const newFields = [...fields];
      const [removed] = newFields.splice(dragIndex, 1);
      newFields.splice(dragOverIndex, 0, removed);
      // Update order property
      const ordered = newFields.map((f, i) => ({ ...f, order: i }));
      onChange(ordered);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }, [dragIndex, dragOverIndex, fields, onChange]);

  const handleUpdate = useCallback((index: number, field: TemplateField) => {
    const newFields = [...fields];
    newFields[index] = field;
    onChange(newFields);
  }, [fields, onChange]);

  const handleRemove = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  const handleAdd = useCallback(() => {
    const newField: TemplateField = {
      key: `field_${Date.now()}`,
      label: '',
      type: 'text',
      required: false,
      order: fields.length,
    };
    onChange([...fields, newField]);
  }, [fields, onChange]);

  return (
    <div className="space-y-2">
      {fields.map((field, index) => (
        <FieldEditor
          key={field.key || index}
          field={field}
          index={index}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          isDragging={dragIndex === index}
        />
      ))}

      <button
        type="button"
        onClick={handleAdd}
        className="w-full p-3 rounded-lg border border-dashed border-border hover:border-primary/50 text-text-muted hover:text-primary text-sm transition-colors"
      >
        + Add Field
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create TemplateBuilder main component**

```tsx
// apps/web/components/TemplateBuilder.tsx
'use client';

import { useState, useCallback } from 'react';
import FieldList from './FieldList';
import TemplatePreview from './TemplatePreview';
import type { TemplateField } from '@elogbook/shared/types/database';

interface TemplateBuilderProps {
  initialTemplate?: {
    id?: string;
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  };
  specialties: string[];
  onSave: (template: {
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  }) => Promise<void>;
  onCancel: () => void;
}

export default function TemplateBuilder({
  initialTemplate,
  specialties,
  onSave,
  onCancel,
}: TemplateBuilderProps) {
  const [name, setName] = useState(initialTemplate?.name ?? '');
  const [specialty, setSpecialty] = useState(initialTemplate?.specialty ?? '');
  const [fields, setFields] = useState<TemplateField[]>(
    initialTemplate?.fields ?? []
  );
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredFields = fields
    .filter(f => f.required)
    .map(f => f.key);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Template name is required');
      return;
    }
    if (!specialty) {
      setError('Specialty is required');
      return;
    }
    if (fields.length === 0) {
      setError('At least one field is required');
      return;
    }

    // Validate field keys are unique
    const keys = fields.map(f => f.key);
    if (keys.length !== new Set(keys).size) {
      setError('Duplicate field keys are not allowed');
      return;
    }

    // Validate select fields have options
    for (const field of fields) {
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        setError(`Field "${field.label}" is a dropdown but has no options`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({ name, specialty, fields, required_fields: requiredFields });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [name, specialty, fields, requiredFields, onSave]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs mb-1 text-text-muted">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
            placeholder="e.g. General Surgery Log"
          />
        </div>
        <div>
          <label className="block text-xs mb-1 text-text-muted">Specialty</label>
          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border"
          >
            <option value="">Select specialty</option>
            {specialties.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Fields ({fields.length})</h3>
          <button
            type="button"
            onClick={() => setShowPreview(true)}
            className="text-sm text-primary hover:underline"
          >
            Preview Template
          </button>
        </div>
        <FieldList fields={fields} onChange={setFields} />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-neutral-dark/50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : initialTemplate?.id ? 'Update Template' : 'Create Template'}
        </button>
      </div>

      {showPreview && (
        <TemplatePreview
          fields={fields}
          templateName={name || 'Untitled Template'}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/FieldEditor.tsx apps/web/components/FieldList.tsx apps/web/components/TemplateBuilder.tsx
git commit -m "feat(ui): add visual template builder with drag-and-drop fields"
```

---

## Task 5: Template Preview Component

**Files:**
- Create: `apps/web/components/TemplatePreview.tsx`

- [ ] **Step 1: Create TemplatePreview component**

```tsx
// apps/web/components/TemplatePreview.tsx
'use client';

import { useState } from 'react';
import type { TemplateField } from '@elogbook/shared/types/database';

interface TemplatePreviewProps {
  fields: TemplateField[];
  templateName: string;
  onClose: () => void;
}

export default function TemplatePreview({ fields, templateName, onClose }: TemplatePreviewProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};

    for (const field of fields) {
      const value = values[field.key];

      if (field.required && (value === undefined || value === '' || value === null)) {
        newErrors[field.key] = `${field.label} is required`;
        continue;
      }

      if (value === undefined || value === '' || value === null) continue;

      const v = field.validation;
      if (!v) continue;

      if (field.type === 'text' || field.type === 'textarea') {
        const str = String(value);
        if (v.minLength && str.length < v.minLength) {
          newErrors[field.key] = `Minimum ${v.minLength} characters required`;
        }
        if (v.maxLength && str.length > v.maxLength) {
          newErrors[field.key] = `Maximum ${v.maxLength} characters allowed`;
        }
        if (v.pattern) {
          try {
            const regex = new RegExp(v.pattern);
            if (!regex.test(str)) {
              newErrors[field.key] = v.patternMessage || 'Invalid format';
            }
          } catch {
            // Invalid regex, skip
          }
        }
      }

      if (field.type === 'number') {
        const num = Number(value);
        if (v.min !== undefined && num < v.min) {
          newErrors[field.key] = `Minimum value is ${v.min}`;
        }
        if (v.max !== undefined && num > v.max) {
          newErrors[field.key] = `Maximum value is ${v.max}`;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleValidate = () => {
    validate();
  };

  const renderField = (field: TemplateField) => {
    const value = values[field.key];
    const error = errors[field.key];

    const baseInputClass = `w-full px-3 py-2 rounded-lg bg-neutral-dark border text-sm ${
      error ? 'border-danger' : 'border-border'
    }`;

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
            placeholder={field.description}
          />
        );
      case 'textarea':
        return (
          <textarea
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
            rows={3}
            placeholder={field.description}
          />
        );
      case 'select':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
          >
            <option value="">Select...</option>
            {(field.options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      case 'number':
        return (
          <input
            type="number"
            value={value !== undefined ? String(value) : ''}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value ? Number(e.target.value) : '' })}
            className={baseInputClass}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            value={String(value ?? '')}
            onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
            className={baseInputClass}
          />
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-sm">{field.label}</span>
          </label>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="panel p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Preview: {templateName}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">✕</button>
        </div>

        <div className="space-y-4">
          {fields.map(field => (
            <div key={field.key}>
              {field.type !== 'checkbox' && (
                <label className="block text-xs mb-1 text-text-muted">
                  {field.label}
                  {field.required && <span className="text-danger ml-1">*</span>}
                </label>
              )}
              {renderField(field)}
              {field.description && field.type !== 'checkbox' && (
                <p className="text-xs text-text-muted mt-1">{field.description}</p>
              )}
              {errors[field.key] && (
                <p className="text-xs text-danger mt-1">{errors[field.key]}</p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={handleValidate}
            className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-neutral-dark/50"
          >
            Validate
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/TemplatePreview.tsx
git commit -m "feat(ui): add template preview with validation"
```

---

## Task 6: Import/Export Component

**Files:**
- Create: `apps/web/components/TemplateImportExport.tsx`

- [ ] **Step 1: Create TemplateImportExport component**

```tsx
// apps/web/components/TemplateImportExport.tsx
'use client';

import { useState, useRef } from 'react';

interface TemplateImportExportProps {
  templateId?: string;
  templateName?: string;
  tenantSlug: string;
  onImportComplete: () => void;
}

export default function TemplateImportExport({
  templateId,
  templateName,
  tenantSlug,
  onImportComplete,
}: TemplateImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!templateId) return;

    try {
      const res = await fetch(`/api/${tenantSlug}/templates/export/${templateId}`);
      if (!res.ok) throw new Error('Export failed');

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(templateName ?? 'template').replace(/[^a-z0-9]/gi, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const res = await fetch(`/api/${tenantSlug}/templates/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_data: data }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');

      setSuccess(`Template "${result.template.name}" imported successfully`);
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {templateId && (
        <button
          type="button"
          onClick={handleExport}
          className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-neutral-dark/50"
        >
          Export
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
        id="template-import"
      />
      <label
        htmlFor="template-import"
        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-neutral-dark/50 cursor-pointer"
      >
        {importing ? 'Importing...' : 'Import'}
      </label>

      {error && <span className="text-xs text-danger">{error}</span>}
      {success && <span className="text-xs text-success">{success}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/TemplateImportExport.tsx
git commit -m "feat(ui): add template import/export component"
```

---

## Task 7: Template Management Page

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/admin/templates/page.tsx`

- [ ] **Step 1: Create templates admin page**

```tsx
// apps/web/app/(authenticated)/[tenant]/admin/templates/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import TemplateBuilder from '@/components/TemplateBuilder';
import TemplateImportExport from '@/components/TemplateImportExport';
import type { TemplateField } from '@elogbook/shared/types/database';

interface Template {
  id: string;
  name: string;
  specialty: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  is_global: boolean;
  usage_count: number;
}

const SPECIALTIES = [
  'Surgery', 'Internal Medicine', 'Pediatrics', 'Emergency',
  'Radiology', 'Cardiology', 'Neurology', 'Orthopedics',
  'Psychiatry', 'Obstetrics', 'Dermatology', 'Ophthalmology',
];

export default function TemplatesPage() {
  const params = useParams();
  const tenantSlug = params.tenant as string;

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenantSlug}/templates`);
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleSave = useCallback(async (template: {
    name: string;
    specialty: string;
    fields: TemplateField[];
    required_fields: string[];
  }) => {
    const url = editing?.id
      ? `/api/${tenantSlug}/templates/${editing.id}`
      : `/api/${tenantSlug}/templates`;
    const method = editing?.id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to save');
    }

    setEditing(null);
    setCreating(false);
    loadTemplates();
  }, [editing, tenantSlug, loadTemplates]);

  const handleDuplicate = useCallback(async (template: Template) => {
    const res = await fetch(`/api/${tenantSlug}/templates/${template.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${template.name} (Copy)` }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to duplicate');
      return;
    }

    loadTemplates();
  }, [tenantSlug, loadTemplates]);

  const handleDelete = useCallback(async (template: Template) => {
    if (!confirm(`Delete "${template.name}"? This cannot be undone.`)) return;

    const res = await fetch(`/api/${tenantSlug}/templates/${template.id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || 'Failed to delete');
      return;
    }

    loadTemplates();
  }, [tenantSlug, loadTemplates]);

  if (loading) return <div className="p-6">Loading templates...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Case Templates</h1>
        <div className="flex gap-2">
          <TemplateImportExport
            tenantSlug={tenantSlug}
            onImportComplete={loadTemplates}
          />
          {!creating && !editing && (
            <button
              onClick={() => setCreating(true)}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
            >
              Create Template
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm mb-4">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {(creating || editing) && (
        <div className="panel p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editing ? 'Edit Template' : 'Create New Template'}
          </h2>
          <TemplateBuilder
            initialTemplate={editing ?? undefined}
            specialties={SPECIALTIES}
            onSave={handleSave}
            onCancel={() => { setEditing(null); setCreating(false); }}
          />
        </div>
      )}

      <div className="space-y-3">
        {templates.length === 0 && (
          <p className="text-text-muted text-sm">No templates yet. Create one to get started.</p>
        )}

        {templates.map(template => (
          <div
            key={template.id}
            className="panel p-4 flex items-center justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{template.name}</span>
                {template.is_global && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">Global</span>
                )}
              </div>
              <div className="text-xs text-text-muted mt-1">
                {template.specialty} · {template.fields.length} fields · {template.required_fields.length} required · {template.usage_count} uses
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TemplateImportExport
                templateId={template.id}
                templateName={template.name}
                tenantSlug={tenantSlug}
                onImportComplete={loadTemplates}
              />
              {!template.is_global && (
                <>
                  <button
                    onClick={() => setEditing(template)}
                    className="px-3 py-1.5 rounded border border-border text-xs hover:bg-neutral-dark/50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDuplicate(template)}
                    className="px-3 py-1.5 rounded border border-border text-xs hover:bg-neutral-dark/50"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => handleDelete(template)}
                    className="px-3 py-1.5 rounded border border-danger/30 text-danger text-xs hover:bg-danger/10"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(authenticated)/[tenant]/admin/templates/page.tsx"
git commit -m "feat(ui): add template management admin page"
```

---

## Task 8: Wire Templates Page into Admin Navigation

**Files:**
- Modify: `apps/web/components/AdminTabPanel.tsx`

- [ ] **Step 1: Add Templates tab to AdminTabPanel**

Read `apps/web/components/AdminTabPanel.tsx` and add a "Templates" tab that links to `/{tenant}/admin/templates`.

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/AdminTabPanel.tsx
git commit -m "feat(ui): add Templates tab to admin panel"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm --filter @elogbook/shared typecheck && pnpm --filter @elogbook/web typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm --filter @elogbook/web lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Run unit tests**

Run: `pnpm test:unit`
Expected: PASS

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete case template builder implementation"
```
