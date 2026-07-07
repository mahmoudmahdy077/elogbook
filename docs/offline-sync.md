# Offline Sync — E-Logbook Mobile

## Architecture

The mobile app uses WatermelonDB for local storage with a Supabase backend for persistence.

```
┌─────────────┐     ┌──────────────┐     ┌──────────┐
│  React      │────▶│  WatermelonDB│◀────│ Supabase │
│  Native UI  │     │  (SQLite)    │     │  (PG)    │
└─────────────┘     └──────┬───────┘     └──────────┘
                           │
                    ┌──────▼────────┐
                    │  Sync Module  │
                    │  pullChanges  │
                    │  pushChanges  │
                    └───────────────┘
```

## Sync Flow

1. **Online mode (default)**
   - All reads go to WatermelonDB (instant)
   - Writes go to WatermelonDB + queue for Supabase push
   - Background sync pushes local changes every 5 seconds

2. **Offline mode**
   - Reads from WatermelonDB (always works)
   - Writes queued locally
   - When connectivity resumes, push all queued changes

3. **Conflict resolution**
   - Last-write-wins at the field level
   - Server timestamps override local on sync
   - Conflicts are logged in `sync_log` table

## Setup

The sync module is already configured in:
- `/apps/mobile/models/` — WatermelonDB model definitions
- `/apps/mobile/sync/` — pull/push sync implementations

## Key edge cases handled

| Scenario | Behavior |
|----------|----------|
| No internet | Read/write local, queue pushes |
| Sync conflict | Server wins, local overwritten |
| Large dataset (>10K rows) | Paginated pull (500 per page) |
| App killed mid-sync | Next sync resumes from last checkpoint |
| Token expired on sync | Re-authenticate, retry |
| Concurrent edits same record | Last-write-wins |

## Testing sync edge cases

```bash
# Toggle device network off/on to test offline queue
# Monitor sync_log table for conflict records

# Verify: create case while offline → go online → check it appears on web
# Verify: edit same case on web + mobile → server wins on sync
# Verify: delete while offline → record marked deleted_at, cleaned on sync
```

## Performance considerations

- WatermelonDB lazy-loads records — only loads visible ones
- Sync uses incremental pulls (`created_at > last_sync`)
- Tables with >50K rows need periodic local compaction
- Image/attachment sync uses separate blob storage (not WatermelonDB)

## Sync configuration

File: `/apps/mobile/sync/config.ts`

```typescript
export const SYNC_CONFIG = {
  pullIntervalMs: 5000,       // Pull server changes every 5s
  pushIntervalMs: 5000,       // Push local changes every 5s
  retryDelayMs: 1000,         // Wait 1s before retry after failure
  maxRetries: 3,              // Max retry attempts per operation
  pullBatchSize: 500,         // Records per pull page
  conflictStrategy: 'server', // 'server' | 'client' | 'manual'
};
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Sync stuck | Check network, restart app, check sync_log |
| Duplicate records | Run local dedup: `yarn sync:dedup` |
| High battery drain | Reduce pullIntervalMs to 30000 |
| Data not appearing | Force sync from settings: "Refresh" |
