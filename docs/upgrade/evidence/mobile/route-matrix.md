# N0.4 — web/mobile role/route matrix (generated from the tree)

**Date:** 2026-09-09 · **Sources:** `apps/web/app/(authenticated)/[tenant]/*`,
`apps/web/app/platform/*`, `apps/mobile/app/(tabs)/*`, `apps/mobile/lib/route-guard.ts`.

Legend: **supported** (mobile screen + capability guard + server enforcement) ·
**denied** (no mobile screen; deep links refused; server denies) ·
**web-only** (no mobile screen; deep links route to web where offered, else refused).

| Web tenant route | Mobile screen | Disposition | Server enforcement |
|---|---|---|---|
| dashboard | index | supported | RLS tenant scope |
| cases | my-cases, case-detail, log-case | supported | RLS + op RPC (N3) |
| approvals | approvals | supported (approver roles) | approve/reject RPCs |
| evaluations / evaluate | evaluations | supported | RLS + capability gate |
| goals | — | web-only (denied on mobile) | RLS tenant scope |
| milestones | milestones | supported | RLS tenant scope |
| rotations | rotations | supported | RLS tenant scope |
| analytics | analytics | supported | RLS + mode ceiling |
| reports | — | web-only (denied on mobile) | RLS + export policy |
| audit | — | denied | admin-only RLS, no mobile surface |
| billing | — | denied | admin-only, no mobile surface |
| compliance | — | denied | admin-only, no mobile surface |
| consent | — | web-only (denied on mobile) | tenant policy |
| invites | — | denied | admin-only, no mobile surface |
| onboarding | — | web-only (denied on mobile) | — |
| resident | — | denied | supervisor+ only |
| settings | — | web-only (denied on mobile) | tenant-admin only |
| admin | — | denied | tenant-admin only, no mobile surface |
| duty hours (mobile-only) | duty-hours | supported | RLS + capability gate |
| AI insights (mobile-only) | ai-insights | supported | quota RPC + disclosure |
| profile (mobile-only) | profile | supported | own-profile RLS |

Platform-admin console (`/platform/*`): **denied on mobile entirely** —
no screens, deep links refused, platform APIs require the platform-admin
grant server-side. Tenant-admin console: same (denied). Bulk export: denied
(no action ships; export endpoints enforce mode + step-up server-side).

## Guard centralization

`apps/mobile/lib/route-guard.ts` is the single map
(route → required `SensitiveAction` | `deny` | `web-only`). The tab layout,
side menu, and deep-link handler all consult it; menu affordances use
display-role hints only. `route-guard.test.ts` pins every row above,
including stale/suspended/denied deep-link cases.
