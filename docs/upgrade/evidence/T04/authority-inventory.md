# T04 Evidence — Authority entry-point inventory (substep 1)

Status: inventory OBSERVED 2026-09-07 against tree `a0d544a` + working tree.
Role strings frozen for T04 (existing values kept; `admin` = platform-wide
operator label in UI, `institution_admin` = tenant admin).

## Central guard

- `apps/web/lib/supabase/require-admin.ts` — validates session → profile →
  tenant slug → allowedRoles. Did NOT check `status` or AAL2 (F09).
  Fixed in T04a: denies non-`active` (incl. NULL/missing) with 403.
  AAL2-per-operation stays per-route (uninstall/update precedent); a
  guard-wide AAL2 mandate would break non-MFA tenants — decided against,
  recorded here.

## Role-mutation paths

| Path | Actor check | Destination check | Tenant scope | AAL2 |
|---|---|---|---|---|
| `api/[tenant]/admin/assign-role` POST | institution_admin/admin via guard | `admin`→admin-only ✓ | post-hoc 403 (TOCTOU-shaped; T04c candidate) | none (gap) |
| `api/[tenant]/admin/users/[id]` PUT | guard | `admin`→admin-only ✓ | query-scoped + explicit 403 ✓ | none (gap) |
| Direct REST PATCH `profiles.role` | DB trigger: institution_admin/admin | **NONE pre-T04b** (F15) | trigger + RLS | MFA trigger = enrollment only |
| Direct REST PATCH own row | trigger (Wave-4 fix) | same gap | same | same |
| Signup INSERT | RLS: resident/supervisor only ✓ | n/a | own row | n/a |
| service_role | trigger system path (allowed) | allowed (by design) | n/a | n/a |

## DB triggers on profiles role writes

- `trg_authorize_role_change` (`20260825230000`): actor institution_admin/
  admin, same tenant. No destination restriction (fixed T04b).
- `trg_enforce_mfa` (`00086`): target must have verified MFA factor for
  director/institution_admin/admin destinations. Proves enrollment, never
  WHO authorizes or WHAT destination is permitted.
- Live probe 2026-09-07 (demo project, reverted immediately): unenrolled
  institution_admin PATCH own role→`admin` → P0001 MFA-block (role
  unchanged). Residual hole is the enrolled-actor path — closed by T04b,
  regression-covered by `p2_09` (runs in blocking CI db-tests).

## Identity sources (do not conflate)

- `get_user_role()` / `get_tenant_id()` read JWT app_metadata (stale
  across revocation until refresh). `requireTenantAdmin` reads `profiles`
  from DB per request (fresh role/status, stale-proof for revocation).
- Platform authority (`platform_admins` registry) does NOT exist yet (F10):
  "institution admins cannot promote to platform authority" is vacuous
  today and becomes T17's acceptance test. T04 hardens the existing
  tenant role system only.

## Deferred to later T04 commits (one defect per change)

- T04b: destination guard migration + `p2_09` (this batch).
- T04c candidate: tenant-scope assign-role lookup/update to the hardened
  pattern; AAL2 on privilege-change routes.
