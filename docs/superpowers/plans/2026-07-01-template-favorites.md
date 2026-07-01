# Template Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow residents to star/favorite case templates and have the template picker sorted by favorites then usage.

**Architecture:** New `template_favorites` table (migration 00067) + shared `sortTemplates()` pure function in `@elogbook/shared` + card grid redesign of web TemplateStep + star toggle on mobile template cards.

**Tech Stack:** Supabase (migration + RLS), Vitest (unit tests), @heroui/react (web), React Native (mobile), TypeScript 6.

---

## File Inventory

| File | Action |
|------|--------|
| `supabase/migrations/00067_template_favorites.sql` | Create |
| `packages/shared/src/types/database.ts` | Modify — add `TemplateFavorite` interface |
| `packages/shared/src/lib/template-sort.ts` | Create — `sortTemplates()` + `TemplateWithMeta` type |
| `packages/shared/src/lib/__tests__/template-sort.test.ts` | Create — 6 unit tests |
| `packages/shared/src/index.ts` | Modify — re-export template-sort |
| `apps/web/components/case-form/TemplateStep.tsx` | Modify — replace dropdown with card grid, add star toggle |
| `apps/web/components/CaseForm.tsx` | Modify — add favorites + usage parallel fetches, pass toggleFavorite |
| `apps/mobile/app/(tabs)/log-case.tsx` | Modify — add favorites + usage fetches, sort, add star toggle |

---

### Task 1: Migration — `template_favorites` table

**Files:**
- Create: `supabase/migrations/00067_template_favorites.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 00067: Add template_favorites table for per-user starred templates

CREATE TABLE template_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES case_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX idx_template_favorites_template_id
  ON template_favorites(template_id);

ALTER TABLE template_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_favorites_select
  ON template_favorites FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY template_favorites_insert
  ON template_favorites FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY template_favorites_delete
  ON template_favorites FOR DELETE
  USING (user_id = auth.uid());

-- Down (rollback):
-- DROP TABLE IF EXISTS template_favorites;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/00067_template_favorites.sql
git commit -m "feat(db): add template_favorites table with RLS"
```

---

### Task 2: Shared types — add `TemplateFavorite` interface

**Files:**
- Modify: `packages/shared/src/types/database.ts`

- [ ] **Step 1: Add `TemplateFavorite` interface**

After the `CaseTemplate` interface (around line 71), add:

```typescript
export interface TemplateFavorite {
  user_id: string;
  template_id: string;
  created_at: string;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/database.ts
git commit -m "feat(shared): add TemplateFavorite interface"
```

---

### Task 3: Shared utility — `sortTemplates` pure function + 6 unit tests

**Files:**
- Create: `packages/shared/src/lib/template-sort.ts`
- Create: `packages/shared/src/lib/__tests__/template-sort.test.ts`

- [ ] **Step 1: Write `template-sort.ts`**

```typescript
import type { CaseTemplate } from '../types/database';

export interface TemplateWithMeta extends CaseTemplate {
  is_favorite: boolean;
  usage_count: number;
}

export function sortTemplates(
  templates: CaseTemplate[],
  favoriteIds: Set<string>,
  personalCounts: Map<string, number>,
  tenantCounts: Map<string, number>,
): TemplateWithMeta[] {
  const withMeta: TemplateWithMeta[] = templates.map((t) => ({
    ...t,
    is_favorite: favoriteIds.has(t.id),
    usage_count: personalCounts.get(t.id) ?? 0,
  }));

  return withMeta.sort((a, b) => {
    const aFav = a.is_favorite ? 1 : 0;
    const bFav = b.is_favorite ? 1 : 0;

    if (aFav !== bFav) return bFav - aFav;

    const aPersonal = personalCounts.get(a.id) ?? 0;
    const bPersonal = personalCounts.get(b.id) ?? 0;
    if (aPersonal !== bPersonal) return bPersonal - aPersonal;

    const aTenant = tenantCounts.get(a.id) ?? 0;
    const bTenant = tenantCounts.get(b.id) ?? 0;
    if (aTenant !== bTenant) return bTenant - aTenant;

    return a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 2: Write 6 unit tests**

```typescript
import { describe, it, expect } from 'vitest';
import { sortTemplates } from '../template-sort';
import type { CaseTemplate } from '../../types/database';

const tpl = (id: string, name: string): CaseTemplate => ({
  id,
  tenant_id: 't-1',
  specialty: 'Surgery',
  name,
  fields: [],
  required_fields: [],
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  deleted_at: null,
});

describe('sortTemplates', () => {
  const templates = [
    tpl('a', 'Alpha'),
    tpl('b', 'Beta'),
    tpl('c', 'Charlie'),
    tpl('d', 'Delta'),
  ];

  it('places favorites first', () => {
    const result = sortTemplates(templates, new Set(['b', 'a']), new Map(), new Map());
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
    expect(result[2].id).toBe('c');
    expect(result[3].id).toBe('d');
  });

  it('sorts non-favorites by personal usage desc', () => {
    const personal = new Map([['a', 5], ['c', 3]]);
    const result = sortTemplates(templates, new Set(), personal, new Map());
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
    expect(result[2].id).toBe('b');
    expect(result[3].id).toBe('d');
  });

  it('sorts by tenant usage when personal usage is tied', () => {
    const tenant = new Map([['c', 10], ['a', 5]]);
    const result = sortTemplates(templates, new Set(), new Map(), tenant);
    expect(result[0].id).toBe('c');
    expect(result[1].id).toBe('a');
  });

  it('falls back to alphabetical when all counts are zero', () => {
    const result = sortTemplates(templates, new Set(), new Map(), new Map());
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns empty array for empty templates', () => {
    const result = sortTemplates([], new Set(), new Map(), new Map());
    expect(result).toEqual([]);
  });

  it('sets is_favorite and usage_count on each item', () => {
    const personal = new Map([['a', 3]]);
    const result = sortTemplates(templates, new Set(['a']), personal, new Map());
    expect(result[0].is_favorite).toBe(true);
    expect(result[0].usage_count).toBe(3);
    expect(result[1].is_favorite).toBe(false);
    expect(result[1].usage_count).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify**

Run: `cd packages/shared && pnpm add -D vitest 2>$null; npx vitest run lib/__tests__/template-sort.test.ts`
Expected: 6 passed, 0 failed

- [ ] **Step 4: Re-export from shared barrel**

Add to `packages/shared/src/index.ts` (after existing exports):

```typescript
export * from './lib/template-sort';
```

- [ ] **Step 5: Verify typecheck**

Run: `cd packages/shared && npx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/lib/template-sort.ts packages/shared/src/lib/__tests__/template-sort.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add sortTemplates pure function with 6 unit tests"
```

---

### Task 4: Web — redesign TemplateStep to card grid with star toggle

**Files:**
- Modify: `apps/web/components/case-form/TemplateStep.tsx`

- [ ] **Step 1: Rewrite TemplateStep**

Replace the entire file content:

```tsx
'use client';

import { TemplateWithMeta } from '@elogbook/shared';
import HelpPopover from '@/components/HelpPopover';

interface TemplateStepProps {
  templates: TemplateWithMeta[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

const SPECIALTY_ICONS: Record<string, string> = {
  surgery: '🔪',
  radiology: '🔬',
  emergency: '⚡',
  internal: '❤️',
  cardiology: '💓',
  neurology: '🧠',
  orthopedics: '🦴',
  pediatrics: '👶',
  psychiatry: '💬',
  custom: '📋',
};

function getIcon(specialty: string): string {
  return SPECIALTY_ICONS[specialty.toLowerCase()] ?? '📋';
}

export default function TemplateStep({
  templates,
  selectedTemplateId,
  onSelect,
  onToggleFavorite,
}: TemplateStepProps) {
  if (templates.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold font-heading">Select Case Template</h3>
        <p className="text-sm text-neutral-light/60">No templates available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold font-heading">
          Select Case Template
        </h3>
        <HelpPopover>
          <p className="mb-2">
            <strong>Templates</strong> define the fields you need to fill out for a particular type of clinical case.
          </p>
          <p className="mb-2">
            Templates are organized by <strong>specialty</strong> and <strong>case type</strong>.
          </p>
          <p>
            Your program director sets up templates that match your accreditation framework.
          </p>
        </HelpPopover>
      </div>
      <p className="text-sm text-neutral-light/60">
        Choose a template for your logbook entry. Star your favorites for quick access.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => {
          const isSelected = t.id === selectedTemplateId;
          return (
            <div
              key={t.id}
              className={`relative rounded-xl p-4 border cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-teal-900/30 border-teal-500'
                  : 'bg-slate-900 border-indigo-500/15 hover:border-indigo-500/40'
              }`}
              onClick={() => onSelect(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(t.id); }}
              aria-label={`${t.specialty} - ${t.name} template`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{getIcon(t.specialty)}</span>
                  <div>
                    <div className="text-white font-heading text-sm">
                      {t.specialty} — {t.name}
                    </div>
                    <div className="text-indigo-400 text-xs mt-1">
                      {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                      {t.usage_count > 0 && (
                        <span className="text-slate-500 ml-2">
                          {t.usage_count} used
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(t.id); }}
                  className={`text-lg p-1 rounded hover:bg-slate-700/50 transition-colors ${
                    t.is_favorite ? 'text-amber-400' : 'text-slate-600'
                  }`}
                  aria-label={t.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                  type="button"
                >
                  {t.is_favorite ? '★' : '☆'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update CaseForm.tsx to pass new props**

Make these edits to `apps/web/components/CaseForm.tsx`:

**a) Imports (around line 10):** Add `sortTemplates` and `TemplateWithMeta`:

```typescript
import { sortTemplates, type TemplateWithMeta } from '@elogbook/shared';
```

**b) Template state type (line 95):**

```typescript
const [templates, setTemplates] = useState<TemplateWithMeta[]>([]);
```

**c) Add `favoriteIds` and `toggleFavorite`:**

After the `accreditationFrameworks` state (line 98):

```typescript
const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
```

Add before the `loadFrameworks` effect (around line 139):

```typescript
const toggleFavorite = useCallback(async (templateId: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  if (favoriteIds.has(templateId)) {
    const { error } = await supabase
      .from('template_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('template_id', templateId);
    if (error) { setErrors([error.message]); return; }
    setFavoriteIds((prev) => { const next = new Set(prev); next.delete(templateId); return next; });
    setTemplates((prev) => prev.map((t) => t.id === templateId ? { ...t, is_favorite: false } : t));
  } else {
    const { error } = await supabase
      .from('template_favorites')
      .insert({ user_id: user.id, template_id: templateId });
    if (error) { setErrors([error.message]); return; }
    setFavoriteIds((prev) => { const next = new Set(prev); next.add(templateId); return next; });
    setTemplates((prev) => prev.map((t) => t.id === templateId ? { ...t, is_favorite: true } : t));
  }
}, [supabase, favoriteIds]);
```

**d) Replace the `loadTemplates` effect (lines 123-137):**

```typescript
useEffect(() => {
  async function loadTemplates() {
    const [{ data: tenantTemplates, error }, { data: globalTemplates }] = await Promise.all([
      supabase.from('case_templates').select('*').eq('tenant_id', tenantId),
      supabase.from('case_templates').select('*').eq('tenant_id', GLOBAL_TENANT_ID),
    ]);
    if (error) {
      setErrors([error.message]);
      setLoadingTemplates(false);
      return;
    }
    const allTemplates = [...(tenantTemplates || []), ...(globalTemplates || [])] as Template[];

    let favIds = new Set<string>();
    let personalCounts = new Map<string, number>();
    let tenantCounts = new Map<string, number>();

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const [favResult, profileResult] = await Promise.all([
        supabase.from('template_favorites').select('template_id').eq('user_id', user.id),
        supabase.from('profiles').select('id').eq('user_id', user.id).single(),
      ]);
      if (favResult.data) {
        favIds = new Set(favResult.data.map((r: { template_id: string }) => r.template_id));
      }
      if (profileResult.data) {
        const profileId = (profileResult.data as { id: string }).id;
        const { data: personalData } = await supabase
          .from('case_entries')
          .select('template_id')
          .eq('resident_id', profileId);
        if (personalData) {
          personalCounts = new Map(
            Array.from(
              personalData.reduce((acc: Map<string, number>, r: { template_id: string }) => {
                acc.set(r.template_id, (acc.get(r.template_id) ?? 0) + 1);
                return acc;
              }, new Map<string, number>())
            )
          );
        }
        setFavoriteIds(favIds);
        const sorted = sortTemplates(allTemplates, favIds, personalCounts, tenantCounts);
        setTemplates(sorted);
        setLoadingTemplates(false);
      }
    }
  }
  loadTemplates();
}, [tenantId, supabase]);
```

Add tenant-wide usage query after the personalCounts block and before `setFavoriteIds`:

```typescript
const { data: tenantEntries } = await supabase
  .from('case_entries')
  .select('template_id')
  .eq('tenant_id', tenantId);
if (tenantEntries) {
  tenantCounts = new Map(
    Array.from(
      tenantEntries.reduce((acc: Map<string, number>, r: { template_id: string }) => {
        acc.set(r.template_id, (acc.get(r.template_id) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    )
  );
}
```

**e) Update the TemplateStep render call (line 381-386):**

```tsx
{step === 0 && (
  <TemplateStep
    templates={templates}
    selectedTemplateId={selectedTemplateId}
    onSelect={(id) => { setSelectedTemplateId(id); setFieldValues({}); }}
    onToggleFavorite={toggleFavorite}
  />
)}
```

Remove the `fieldCount` prop from TemplateStep usage.

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Verify tests still pass**

Run: `cd apps/web && npx vitest run`
Expected: 102+ passed, 0 failed

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/case-form/TemplateStep.tsx apps/web/components/CaseForm.tsx
git commit -m "feat(web): redesign template picker to card grid with star favorites"
```

---

### Task 5: Mobile — add favorites to log-case.tsx

**Files:**
- Modify: `apps/mobile/app/(tabs)/log-case.tsx`

- [ ] **Step 1: Add imports**

Add at the top (alongside existing imports):

```typescript
import { sortTemplates, type TemplateWithMeta } from '@elogbook/shared';
```

- [ ] **Step 2: Add state for favorites and toggle**

After `const templatesRef = useRef(templates);`:

```typescript
const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Replace `loadTemplates` function**

Replace the existing `loadTemplates` function (around line 261) with:

```typescript
const loadTemplates = async () => {
  setLoading(true);
  setFetchError(false);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { setLoading(false); return; }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) { setLoading(false); return; }

  const { data, error } = await supabase
    .from('case_templates')
    .select('*')
    .eq('tenant_id', profile.tenant_id);

  if (error) { setFetchError(true); setLoading(false); return; }

  if (data) {
    const allTemplates = data as unknown as TemplateWithMeta[];
    let favIds = new Set<string>();
    let personalCounts = new Map<string, number>();

    const { data: favData } = await supabase
      .from('template_favorites')
      .select('template_id')
      .eq('user_id', user.id);
    if (favData) {
      favIds = new Set(favData.map((r: { template_id: string }) => r.template_id));
    }

    const { data: personalData } = await supabase
      .from('case_entries')
      .select('template_id')
      .eq('resident_id', profile.id);
    if (personalData) {
      personalCounts = new Map(
        Array.from(
          personalData.reduce((acc: Map<string, number>, r: { template_id: string }) => {
            acc.set(r.template_id, (acc.get(r.template_id) ?? 0) + 1);
            return acc;
          }, new Map<string, number>())
        )
      );
    }

    setFavoriteIds(favIds);
    const sorted = sortTemplates(allTemplates, favIds, personalCounts, new Map());
    setTemplates(sorted as unknown as CaseTemplate[]);

    const autoSelectId = editCaseId || duplicateCaseId || String(repeatLastEntry) === 'true' ? selectedTemplateId : null;
    if (autoSelectId) {
      const t = sorted.find((x) => x.id === autoSelectId);
      if (t) setSelectedTemplate(t);
    }
  }
  setLoading(false);
};
```

- [ ] **Step 4: Add `toggleFavorite` function**

Add before `selectTemplate`:

```typescript
const toggleFavorite = async (templateId: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  if (favoriteIds.has(templateId)) {
    const { error } = await supabase
      .from('template_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('template_id', templateId);
    if (error) { Alert.alert('Error', 'Failed to remove favorite.'); return; }
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      next.delete(templateId);
      return next;
    });
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === templateId ? { ...t, is_favorite: false } as unknown as CaseTemplate : t
      )
    );
  } else {
    const { error } = await supabase
      .from('template_favorites')
      .insert({ user_id: user.id, template_id: templateId });
    if (error) { Alert.alert('Error', 'Failed to add favorite.'); return; }
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      next.add(templateId);
      return next;
    });
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === templateId ? { ...t, is_favorite: true } as unknown as CaseTemplate : t
      )
    );
  }
};
```

- [ ] **Step 5: Add star toggle to template card**

Modify the `renderTemplateCard` function. Add a star button at the top-right of the card.

Change the existing renderTemplateCard (around line 566) to:

```typescript
const renderTemplateCard = useCallback(({ item: t }: { item: CaseTemplate }) => {
  const tmpl = t as unknown as TemplateWithMeta;
  return (
    <TouchableOpacity
      className="bg-slate-900 border border-indigo-500/15 rounded-xl p-4 active:scale-95 m-1 flex-1"
      style={{ maxWidth: '48%' }}
      onPress={() => selectTemplate(t)}
      accessibilityLabel={`${t.specialty} - ${t.name} template`}
      accessibilityRole="button"
    >
      <View className="flex-row justify-between items-start">
        <Ionicons name={getSpecialtyIcon(t.specialty)} size={28} color={clinicalTokens.colors.primary.DEFAULT} />
        <TouchableOpacity
          onPress={() => toggleFavorite(t.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={tmpl.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          accessibilityRole="button"
        >
          <Text className={tmpl.is_favorite ? 'text-amber-400' : 'text-slate-600'} style={{ fontSize: 18 }}>
            {tmpl.is_favorite ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text className="text-white mt-3" numberOfLines={2} style={{ fontFamily: clinicalTokens.fonts.heading }}>
        {t.specialty} - {t.name}
      </Text>
      <Text className="text-indigo-400 text-xs mt-2 bg-indigo-500/10 self-start px-2 py-0.5 rounded-full" style={{ fontFamily: clinicalTokens.fonts.body }}>
        {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
      </Text>
    </TouchableOpacity>
  );
}, [selectTemplate, toggleFavorite]);
```

- [ ] **Step 6: Verify typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/\(tabs\)/log-case.tsx
git commit -m "feat(mobile): add template favorites star toggle and usage-based sort"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run shared tests**

```bash
cd packages/shared && npx vitest run lib/__tests__/template-sort.test.ts
```
Expected: 6 passed

- [ ] **Step 2: Run web tests**

```bash
cd apps/web && npx vitest run
```
Expected: 102+ passed

- [ ] **Step 3: Run web typecheck**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: no output

- [ ] **Step 4: Run mobile typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```
Expected: no output

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat: template favorites — migration, sort utility, web + mobile UI"
```

- [ ] **Step 6: Push**

```bash
git push
```
