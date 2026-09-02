# Service-Role Inventory — Phase 1.7 (TICKET-007)

**Status:** `ACCEPTED` — inventory generated, classification pending human review (Rule 3/Rule 7). No code changed in this commit except inventory; tenant isolation is NOT established by this file.

**Generated:** 2026-09-02 via `Get-ChildItem -Recurse -Path apps/web -Filter *.ts | Select-String createServiceRoleClient`
**Count:** 60 hits across ~20 files (see raw list below). Gate A (`scripts/verify-tenant-scope.mjs`) is the detector; this inventory plus a route-level integration test per privileged mutation is the proof (see PRODUCTION_UPGRADE_PLAN.md Phase 1.7).

> **Why this is human-only:** Classifying a query as `tenant-scoped` / `institution-scoped` / `intentionally global` requires judgment about whether RLS bypass is intentional. A small model must not exercise that judgment (Rule 3). This file records the raw inventory and defers classification to a human reviewer per TICKET-007.

## Raw grep — every call site

```
apps\web\app\(authenticated)\[tenant]\audit\export\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\(authenticated)\[tenant]\audit\export\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\contact\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\contact\route.ts: const admin = createServiceRoleClient();
apps\web\app\api\uninstall\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\uninstall\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\update\execute\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\update\execute\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\[tenant]\admin\ai-config\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\[tenant]\admin\ai-config\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\[tenant]\admin\assign-role\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\[tenant]\admin\assign-role\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\[tenant]\admin\branding\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\[tenant]\admin\branding\route.ts: const adminClient = createServiceRoleClient(); (x2)
apps\web\app\api\[tenant]\admin\invite\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\[tenant]\admin\invite\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\[tenant]\admin\payment-gateway\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin';
apps\web\app\api\[tenant]\admin\payment-gateway\route.ts: const adminClient = createServiceRoleClient();
apps\web\app\api\[tenant]\admin\scim\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x3 call sites)
apps\web\app\api\[tenant]\admin\sso\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x4 call sites)
apps\web\app\api\[tenant]\admin\users\[id]\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x3)
apps\web\app\api\[tenant]\admin\users\[id]\action\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x1)
apps\web\app\api\[tenant]\admin\webhooks\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x4)
apps\web\app\api\[tenant]\admin\webhooks\test\route.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x1)
apps\web\lib\notifications.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x1)
apps\web\lib\webhooks.ts: import { createServiceRoleClient } from '@/lib/supabase/admin'; (x1)
apps\web\lib\supabase\admin.ts: export function createServiceRoleClient() { (definition)
```

## Classification template (human to fill)

| File | Query | Tenant-scoped? | Institution-scoped? | Intentionally global? | Evidence (test) |
|---|---|---|---|---|---|
| `app/(authenticated)/[tenant]/audit/export/route.ts:83` | `profiles` + `audit_logs` | ? | ? | ? | `TICKET-007-??` |
| `app/api/[tenant]/admin/users/[id]/route.ts:80` | `profiles` `tenant_id` | Yes — verified in `cross-tenant.test.ts` | No | No | `cross-tenant.test.ts:PUT` |
| `app/api/[tenant]/admin/users/[id]/action/route.ts:24` | `profiles` `tenant_id` | Yes | No | No | `cross-tenant.test.ts:action` |
| `app/api/uninstall/route.ts:72` | `audit_logs` `tenant_id` | Yes (audit) | No | No | — |
| `app/api/update/execute/route.ts:62` | `audit_logs` | Yes | No | No | — |
| ... | ... | ... | ... | ... | ... |

**Next steps per TICKET-007 (multiple tickets, one per route group):**

1.1 `admin/users` — already tenant-scoped + cross-tenant test (see `cross-tenant.test.ts`). Gate A should be green for these.
1.2 `admin/ai-config`, `branding`, `payment-gateway`, `sso`, `scim`, `webhooks`, `invite`, `assign-role` — each needs per-route integration test that attempts cross-tenant mutation and expects 403/404.
1.3 `audit/export`, `compliance/export`, `billing`, `reports` — verify tenant filter on every service-role query.
1.4 `notifications.ts`, `webhooks.ts` — verify they do not leak cross-tenant data (service role used for dispatch).
1.5 `contact`, `uninstall`, `update` — administrative builds, verify tenant isolation is not applicable but audit is.

Gate A (`scripts/verify-tenant-scope.mjs`) must be implemented to flag any `createServiceRoleClient` query on a tenant-scoped table without `.eq('tenant_id'` in the same chain. Until that script exists, this inventory is the only detector.

## Blocked by

- Human reviewer with RLS expertise to classify each row.
- Integration test harness with two tenants (see `supabase/tests/p1_1b_cross_tenant_write_isolation.sql` as reference).

## References

- PRODUCTION_UPGRADE_PLAN.md §II D-7, §IV Gate A, §V TICKET-007
- Existing passing: `cross-tenant.test.ts` (2 tests), `p1_1b` SQL, `p1_3` SQL
