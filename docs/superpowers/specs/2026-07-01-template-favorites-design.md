# Template Favorites — Design Spec

## Problem

Residents log cases frequently using the same subset of case templates. Without
favorites or usage-based prioritization, they must scroll through the full
template list every time, slowing down case entry.

## Schema

### New table: `template_favorites`

```sql
CREATE TABLE template_favorites (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES case_templates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX idx_template_favorites_template_id
  ON template_favorites(template_id);

ALTER TABLE template_favorites ENABLE ROW LEVEL SECURITY;

-- Users see only their own favorites
CREATE POLICY template_favorites_select
  ON template_favorites FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY template_favorites_insert
  ON template_favorites FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY template_favorites_delete
  ON template_favorites FOR DELETE
  USING (user_id = auth.uid());
```

**Migration**: `00067_template_favorites.sql`

## Data flow

### Queries (run in parallel with `case_templates` fetch)

1. `SELECT template_id FROM template_favorites WHERE user_id = :uid`
2. `SELECT template_id, COUNT(*) as cnt FROM case_entries WHERE resident_id = :pid GROUP BY template_id` — personal usage
3. `SELECT t.id, COUNT(ce.id) as cnt FROM case_templates t LEFT JOIN case_entries ce ON ce.template_id = t.id AND ce.tenant_id = :tid GROUP BY t.id` — tenant-wide usage

### Sort pipeline (pure function in `@elogbook/shared`)

```
sortTemplates(templates[], favoriteIds[], personalCounts[], tenantCounts[])
  → sorted TemplateWithMeta[]
```

Tiers:
1. Favorited templates, ordered by `created_at` desc
2. Non-favorited templates where personal count > 0, desc
3. Non-favorited templates where tenant count > 0, desc
4. Remaining templates, alphabetical by name

Each item gets two synthetic fields: `is_favorite: boolean` and
`usage_count: number` (personal usage; 0 if none).

### Toggle

```
onToggleFavorite(templateId: string):
  if templateId in favoriteIds → supabase.from('template_favorites').delete().eq(...)
  else → supabase.from('template_favorites').insert({ user_id, template_id })
```

RLS guarantees `user_id = auth.uid()` on both INSERT and DELETE — no server
action needed.

## Types (`packages/shared/src/`)

### `types/database.ts` — add:

```ts
export interface TemplateFavorite {
  user_id: string;
  template_id: string;
  created_at: string;
}
```

### New `lib/template-sort.ts`:

```ts
export interface TemplateWithMeta extends CaseTemplate {
  is_favorite: boolean;
  usage_count: number;
}

export function sortTemplates(
  templates: CaseTemplate[],
  favoriteIds: Set<string>,
  personalCounts: Map<string, number>,
  tenantCounts: Map<string, number>,
): TemplateWithMeta[];
```

### Barrel export: re-export from `packages/shared/src/index.ts`

## Web UI

### `TemplateStep.tsx` — redesign

Replace the current `<Select>` dropdown with a visual card grid:

```html
<div class="bg-slate-900 border border-indigo-500/15 rounded-xl p-4 flex-1">
  <Icon name={getIcon(t.specialty)} />
  <div class="text-white font-heading">{t.specialty} - {t.name}</div>
  <div class="text-indigo-400 text-xs">{t.fields.length} fields</div>
  <button onClick={() => onToggleFavorite(t.id)}>
    {t.is_favorite ? '★' : '☆'}
  </button>
</div>
```

Styled with Tailwind classes. Tapping the card selects the template. Tapping
the star toggles the favorite (independent event, stopPropagation).

### `CaseForm.tsx` — changes

- In the `loadTemplates` useEffect, add parallel fetches for favorites and
  usage counts. Merge and sort templates into `TemplateWithMeta[]`.
- Pass `toggleFavorite` callback to `TemplateStep`.
- Remove the old `<Select>`-based template step rendering.

## Mobile UI

### `log-case.tsx` — changes

- In `loadTemplates`, add parallel fetches for favorites and usage counts.
- Sort templates using `sortTemplates` from shared.
- Each template card gets a star icon in the top-right corner:
  - "★" (filled, gold) if favorited
  - "☆" (outline, muted) if not
- Tapping the star toggles favorite status and re-sorts the visible list.
- Keep the existing 2-column `FlatList` grid; add
  `keyExtractor` to use template.id for stable re-render after sort.

## Error handling

- If favorites query fails, show all templates unsorted (graceful degradation).
- If usage query fails, fall back to favorites-first + alphabetical.
- Toggle failures show a brief error (Alert on mobile, toast on web).
- No offline support for favorites toggle (requires network).

## Testing

### Unit tests (`@elogbook/shared`)

- `sortTemplates` — 6 tests:
  1. Favorites appear first, in order of `created_at`.
  2. Personal usage sorted desc within non-favorites.
  3. Tenant usage sorted desc within non-favorites with no personal usage.
  4. Remaining templates sorted alphabetically.
  5. Empty favorites set returns templates in usage/alpha order.
  6. All counts empty returns alphabetical only.

### Integration (web)

- CaseForm renders template grid instead of dropdown.
- Toggling favorite calls supabase.insert/delete.
- Template list re-sorts after toggle.

### Integration (mobile)

- LoadTemplates includes favorites and counts.
- Star toggle fires API call and re-sorts.
- Offline/error fallback shows unsorted list.

## Migration

File: `supabase/migrations/00067_template_favorites.sql`

Contains: CREATE TABLE, INDEX, RLS policies (3), plus a down-migration
comment for rollback.

## Out of scope

- Supervisor/admin template management favorites.
- Shared favorites across tenant (per-user only).
- Template search/filter (separate feature).
- Offline favorite toggle syncing.
