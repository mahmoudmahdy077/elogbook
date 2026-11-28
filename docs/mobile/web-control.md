# Mobile app control from the web

The Expo app (`apps/mobile`) is configured per tenant from **Admin → Mobile App**
(`/…/admin/mobile`). Changes are live on each device's next launch or next
foreground; no app-store release is required.

## What the web controls

| Control | Stored in | App behaviour |
| --- | --- | --- |
| Module toggles | `mobile_app_config.enabled_features` | Hides the module from the side menu and blocks its tab. Data is untouched. |
| Maintenance mode | `maintenance_mode`, `maintenance_message` | Full-screen block with the tenant's message and a sign-out escape. |
| Forced update | `min_app_version`, `force_update`, `update_url` | Blocks builds older than the minimum and opens the store link. |
| Announcement | `announcement` (title, body, severity, expiry) | Dismissible dashboard banner; an expiry hides it automatically. |
| Push broadcast | `push_tokens` | Sends through Expo Push to all/role-filtered registered devices; tapping it opens the dashboard. |
| Branding colour | `tenants.custom_branding.primary_color` | Used for tab accents and the New Case button. |

Attachments use the same bucket/table as the web and are controlled by the
`attachments` module key. Module keys are shared in
`packages/shared/src/constants/mobile-config.ts`
(`MOBILE_FEATURE_KEYS`). Add a key there before exposing a new toggle.

## Read / write path

- The app reads `mobile_app_config` directly through RLS (`tenant_id =
  get_tenant_id()`), caches the last snapshot per tenant, and re-reads it on
  boot, sign-in and every foreground. Offline starts use the cached values.
- The web route `POST /api/[tenant]/admin/mobile` validates and upserts the
  row with the service role, then writes an `audit_logs` row
  (`mobile_app_config_update`, `mobile_push_broadcast`).
- These are presentation controls, never authorization: RLS and the command
  RPCs still decide every read/write. A hidden module is not a permission
  boundary.

## Case submission parity

The app's submit path now matches the web:

1. The case is saved as a draft (`status='draft'`).
2. `POST /api/mobile/v1/cases/{id}/submit` (bearer JWT) runs the shared
   `submitDraftEntry` core: draft/ownership/subscription checks, the
   `submit_case` RPC, supervisor `approval_requests`, the `case.submitted`
   webhook and the pending-approval push.
3. If the web host is unreachable but Supabase is not, the app falls back to
   the `submit_case` RPC so the case is still submitted (webhook and push are
   skipped for that one request).
4. If both are offline, the case is queued as a draft; when the queue flushes
   the app calls the same submit endpoint (falling back to the RPC), so
   approvals, webhook and push still happen after reconnect. A draft whose
   submit fails is recoverable from My Cases.

Supervisor inboxes on both clients read pending `case_entries`, so a case
submitted from either client is visible on both.
