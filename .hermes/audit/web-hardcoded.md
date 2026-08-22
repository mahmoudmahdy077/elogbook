| 7 | apps/web/components/CaseImport.tsx | whole file (~300 lines) | Dead code: CSV case-import modal never mounted | `export default function CaseImport(...)` — zero imports of `CaseImport` anywhere in repo (grep across apps/web incl. e2e/tests = only self-references). Functional Supabase bulk-insert code, but unreachable UI | P2 | Wire into cases list page toolbar (with template_id handling — note it inserts without template_id) or delete |
| 8 | apps/web/components/AIInsightsPanel.tsx | 24-26, 66-67 | Feature depends on Edge Function; panel itself never rendered in app scope | `supabase.functions.invoke('ai-insights', ...)` — function exists in supabase/functions/ai-insights ✓, but grep shows no page/layout imports `AIInsightsPanel` (only self). UI reachable nowhere | P2 | Mount on resident dashboard/case detail, or delete; also confirm deployed function name matches |

## Sweep coverage so far

- TODO/FIXME/HACK/XXX/coming soon/not implemented: UserManager.tsx:62 (#1) + lib/supabase/auth.ts:106 comment re missing tenant-switcher join table (P6.x TODO)
- No empty onClick handlers; no console.log in app/components/lib; href="#" only a11y skip-link (legit)
- alert(): UserTable ×3, SubscriptionManager ×4 (#2, #3)
- Comment blocks >10 lines: none found (max comment runs are live explanatory comments in lib/supabase/middleware.ts)
- QuickAddFAB/QuickAddCase/QuickAddWrapper: wired correctly (dashboard mounts wrapper)
- CommandPalette + lib/shortcuts.tsx: palette items fully built from shortcuts registry; wired via ShortcutsRenderer in app/layout.tsx — legit
- ImpactDialog: used by TemplateEditor, GoalActions, CompetencyManager — legit
