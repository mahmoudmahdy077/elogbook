# Impact-Aware Confirm Dialogs — Design Spec

## Problem

Three destructive admin actions lack impact-aware confirmation:

1. **Template deletion**: No confirmation at all. DB `ON DELETE RESTRICT`
   prevents deletion when entries exist, but the error is shown post-hoc.
2. **Accreditation framework deletion**: Basic `window.confirm()` with no
   impact data (affected case entries, templates).
3. **Role changes** (`UserManager.tsx`): Immediate, no confirmation.

## Solution

### Generalized `ConfirmDialog` component

Extend the existing `ConfirmDialog` (currently at
`components/case-form/ConfirmDialog.tsx`) to accept:

```typescript
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  impact?: string;          // e.g. "5 case entries use this template"
  severity: 'info' | 'warning' | 'danger';
  confirmLabel: string;      // e.g. "Delete", "Change Role"
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
```

- `severity='danger'` → red accent, "Delete" button
- `severity='warning'` → amber accent
- `severity='info'` → teal accent (current case-submission style)

### Impact query pattern

Before showing the dialog, the caller runs a quick `COUNT(*)` query:

| Action | Query |
|--------|-------|
| Delete template | `SELECT COUNT(*) FROM case_entries WHERE template_id = :id AND deleted_at IS NULL` |
| Delete framework | `SELECT COUNT(*) FROM case_entries WHERE accreditation_mappings @> '[{"framework_id": ":id"}]'` |
| Change role | `SELECT COUNT(*) FROM case_entries WHERE resident_id = :id` (optional — warn if user has active cases) |

The impact string is shown between the message and the action buttons.

### Files changed

| File | Change |
|------|--------|
| `components/case-form/ConfirmDialog.tsx` | Generalize props, add severity/impact/confirmLabel |
| `components/TemplateEditor.tsx` | Add impact query + dialog before delete |
| `components/CompetencyManager.tsx` | Replace `window.confirm()` with dialog + impact query |
| `components/UserManager.tsx` | Add dialog before role change |
| `components/CaseForm.tsx` | Update usage of ConfirmDialog (pass new props) |

### Deleted

- `RetentionForm.tsx` — existing `window.confirm()` replaced with new dialog.

### Error handling

- If impact query fails, show dialog with "Unable to determine impact" and
  allow deletion anyway (degraded mode).
- Dialog loading state shown while impact query runs.
- If delete fails server-side (e.g., FK violation), show error via existing
  `ErrorDisplay` pattern.

### Testing

- 1 unit test: ConfirmDialog renders all severity variants.
- No impact data → show generic message without impact line.
