# Contract: Offline Sync Protocol

**Feature**: Premium Mobile Logbook | **Components**: `apps/mobile/lib/sync.ts`, WatermelonDB, Supabase

## Overview

The offline sync protocol ensures case data logged in low-signal clinical environments (OR, radiology wards) is reliably synchronized to the Supabase backend when connectivity returns. Conflicts are resolved using server-authoritative strategy.

## Data Flow

```
Resident logs case offline
        │
        ▼
WatermelonDB (local DB) ← primary store
        │
        ▼ (connectivity restored)
SyncService.pushPendingCases()
        │
        ├── Success → Supabase → WatermelonDB (mark synced)
        │
        └── Conflict → Supabase state authoritative
                │
                ├── Server case saved
                ├── Local edits → new draft (sync_status: 'conflict')
                └── Resident notified with conflict banner
```

## Sync Trigger Points

| Trigger | Behavior |
|---------|----------|
| App foreground | `SyncService.checkPending()` — push all pending drafts |
| Connectivity restored (`netinfo`) | `SyncService.onConnectivityChange(true)` — schedule push |
| Pull-to-refresh on case list | `SyncService.pullCases()` — fetch latest from server |
| Case submitted online | Direct Supabase insert (bypasses local store) |
| Periodic interval | Every 30 seconds when online |

## WatermelonDB Schema (Existing — Activated)

### case_entries (Local)

```typescript
// apps/mobile/lib/db/schema.ts — existing, now activated
{
  id: string,                    // UUID matching server entry (or local UUID for drafts)
  tenant_id: string,
  resident_id: string,
  template_id: string,
  patient_mrn: string?,          // null if de-identified
  patient_dob: number?,          // timestamp, null if de-identified
  patient_age_years: number?,
  patient_hash: string?,
  case_date: number,             // timestamp
  field_values: string,          // JSON stringified
  accreditation_mappings: string, // JSON stringified
  is_deidentified: boolean,
  status: string,                // 'draft' | 'pending' | 'approved' | 'rejected'
  local_sync_status: string,     // 'pending' | 'syncing' | 'synced' | 'conflict' | 'error'
  created_at: number,
  updated_at: number,
}
```

### case_templates (Local Cache)

```typescript
{
  id: string,
  tenant_id: string,
  specialty: string,
  name: string,
  fields: string,         // JSON stringified TemplateField[]
  required_fields: string, // JSON stringified string[]
  created_at: number,
  updated_at: number,
}
```

## Sync Protocol

### Push (Local → Server)

```
1. Query WatermelonDB for case_entries WHERE local_sync_status IN ('pending', 'error')
2. For each draft:
   a. Set local_sync_status = 'syncing'
   b. POST to Supabase case_entries INSERT
   c. On success (201):
      - Update local record: server_id = response.id, local_sync_status = 'synced'
      - Remove from AsyncStorage draft store
   d. On conflict (409 — case already exists on server):
      - Load server version of case
      - Compare updated_at timestamps
      - If server is newer: preserve local edits as NEW draft (local_sync_status = 'conflict')
      - Trigger FR-024 conflict notification
   e. On error (5xx, network):
      - Set local_sync_status = 'error'
      - Retry on next sync cycle (exponential backoff: 30s, 60s, 120s, max 5min)
   f. On validation error (422):
      - Set local_sync_status = 'error'
      - Show inline validation error on the draft
```

### Pull (Server → Local)

```
1. GET Supabase case_entries WHERE resident_id = ? AND updated_at > last_sync_timestamp
2. For each server case:
   a. Check if exists in WatermelonDB by id
   b. If exists: update local record (server authoritative)
   c. If not exists: create local record
   d. Set local_sync_status = 'synced'
3. GET Supabase case_templates WHERE tenant_id = ? AND updated_at > last_template_sync
4. Cache templates locally for offline template selection
```

## Conflict Resolution Matrix

| Local State | Server State | Resolution |
|-------------|-------------|------------|
| `draft` (unsynced) | Not exists | Push local → server (normal flow) |
| `draft` (unsynced) | `draft` (same id) | Server wins; local becomes conflict draft |
| `draft` (unsynced) | `pending` (same id) | Server wins (case already submitted); local discarded |
| `draft` (unsynced) | `approved` (same id) | Server wins; local discarded (case already verified) |
| `draft` (synced) | `rejected` | Pull server update; show rejection notification |
| `draft` (unsynced) | `rejected` | Server wins; local edits become new conflict draft |

## Sync Status Indicators

| Status | Mobile UI | Description |
|--------|-----------|-------------|
| `idle` | No indicator | Online, no pending sync |
| `syncing` | Blue pulsing dot in header | Active sync in progress |
| `synced` | Brief green checkmark → fades | Sync completed successfully |
| `error` | Red dot + "Sync failed" banner | Push failed, will retry |
| `offline` | Yellow banner "Offline mode" | No connectivity detected |
| `conflict` | Amber banner "Case updated by supervisor" | Conflict detected, see drafts |

## Network Detection

```typescript
// apps/mobile/lib/sync.ts — enhancement
import NetInfo from '@react-native-community/netinfo';

// Subscribe to connectivity changes
NetInfo.addEventListener(state => {
  if (state.isConnected && previousState === 'offline') {
    SyncService.pushPendingCases();
    SyncService.pullTemplates(tenantId);
  }
  SyncService.updateStatus(state.isConnected ? 'idle' : 'offline');
});
```

Package required: `@react-native-community/netinfo` (add to `apps/mobile/package.json`)
