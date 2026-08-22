# E-Logbook Setup, Update & Uninstall Wizard — Design Spec

**Date:** 2026-08-18
**Status:** Draft
**Scope:** Dockerized installation, update, uninstall wizards with self-hosted Supabase and data safeguard rails

---

## 1. Overview

A graphical setup wizard that installs the complete E-Logbook platform on a fresh server (VPS or dedicated) without requiring terminal or SSH access. The wizard:

**Scope decomposition** — This spec covers 4 independent sub-projects, each implementable separately:

1. **Setup Wizard** (Sections 3, 11, 12) — Fresh installation
2. **Update Wizard** (Section 4) — Version management
3. **Uninstall Wizard** (Section 5) — Clean removal
4. **Data Safeguard Rails** (Section 6, 7) — Backup/restore infrastructure

- Checks server requirements (Docker, disk, RAM, ports)
- Installs and deploys a full self-hosted Supabase stack from Docker
- Deploys the E-Logbook application via Docker Compose
- Configures the database, environment, admin users, domains, and SSL
- Provides update and uninstall wizards
- Preserves all data across restarts, updates, and container pulls

**Entry point:** User runs a single `docker compose` command, opens browser to `http://server:3000`, and completes setup through the GUI.

---

## 2. Architecture

### 2.1 System Stack

```
┌──────────────────────────────────────────────────────────────┐
│                     Docker Host (VPS/Dedicated)               │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              E-Logbook Docker Network                    │  │
│  │                                                          │  │
│  │  ┌────────────┐  ┌────────┐                             │  │
│  │  │  E-Logbook │  │ Caddy  │   ← Reverse proxy + SSL     │  │
│  │  │  App :3000 │  │:80/:443│                             │  │
│  │  └────────────┘  └────────┘                             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          │                                     │
│                    Docker Network                              │
│                          │                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │            Supabase Self-Hosted Stack                    │  │
│  │                                                          │  │
│  │  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │  │
│  │  │ PostgreSQL │ │ GoTrue   │ │ PostgREST│ │ Realtime  │ │  │
│  │  │ :5432     │ │ Auth     │ │ :3000    │ │ :4000     │ │  │
│  │  └───────────┘ └──────────┘ └──────────┘ └───────────┘ │  │
│  │  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ │  │
│  │  │ Storage   │ │ Studio   │ │ Edge     │ │ Envoy     │ │  │
│  │  │ :5000     │ │ :3000    │ │ Funcs    │ │ API GW    │ │  │
│  │  └───────────┘ └──────────┘ └──────────┘ └───────────┘ │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Compose File Separation

E-Logbook and Supabase have **separate** Docker Compose files. E-Logbook connects to Supabase via a shared Docker network. Neither project modifies the other's files.

| File | Owner | Purpose |
|------|-------|---------|
| `elogbook/docker-compose.yml` | E-Logbook | App + Caddy |
| `elogbook/setup.docker-compose.yml` | E-Logbook | Setup-phase temporary DB |
| `/opt/supabase/docker-compose.yml` | Supabase | Full Supabase stack (official, untouched) |

### 2.3 Setup Mode

The E-Logbook app image supports a `SETUP_MODE` environment variable:

- `SETUP_MODE=true` — All routes redirect to `/setup` wizard
- `SETUP_MODE=false` — Normal application mode (default after setup)

A `.setup-complete` marker file in the data volume indicates setup has finished.

---

## 3. Setup Wizard

### 3.1 Entry Point

```bash
# User runs this on a fresh server with Docker installed:
git clone https://github.com/{owner}/elogbook.git
cd elogbook
docker compose -f setup.docker-compose.yml up -d
# Opens browser to http://server:3000
```

### 3.2 Wizard Steps

#### Step 1 — Welcome & Requirements Check

**UI:** Pass/fail indicators for each requirement.

| Check | Method | Min Version |
|-------|--------|-------------|
| Docker installed | `docker --version` | 24.0+ |
| Docker Compose | `docker compose version` | v2.20+ |
| Disk space | `df -h /var/lib/docker` | 5 GB free |
| RAM | `free -m` | 2 GB available |
| Port 80 available | `ss -tlnp \| grep :80` | Not in use |
| Port 443 available | `ss -tlnp \| grep :443` | Not in use |
| Port 3000 available | `ss -tlnp \| grep :3000` | Not in use |

Failed checks show installation instructions for the specific OS.

#### Step 2 — Supabase Configuration

**UI:** Form with generated values and editable fields.

Generated (read-only, displayed for backup):
- `JWT_SECRET` — 64-byte hex string
- `ANON_KEY` — JWT signed with JWT_SECRET
- `SERVICE_ROLE_KEY` — JWT signed with JWT_SECRET
- `SECRET_KEY_BASE` — 64-byte hex string
- `VAULT_ENC_KEY` — 32-byte hex string
- `PG_META_CRYPTO_KEY` — 32-byte hex string

User-provided:
- `POSTGRES_PASSWORD` — database password (min 12 chars)
- `POSTGRES_DB` — database name (default: `elogbook`)
- Supabase install path (default: `/opt/supabase`)

All generated secrets are displayed once with a "Copy & Save" button. User is warned these cannot be recovered.

#### Step 3 — Deploy Supabase Stack

**UI:** Real-time progress with per-service status.

Process:
1. Clone Supabase repo to install path
2. Write `.env` file with generated secrets
3. Run `docker compose pull` for all Supabase images
4. Run `docker compose up -d`
5. Wait for health checks on each service:
   - PostgreSQL: `pg_isready`
   - GoTrue Auth: `wget http://localhost:9999/health`
   - PostgREST: `postgrest --ready`
   - Realtime: `curl http://localhost:4000/api/tenants/.../health`
   - Storage: `wget http://storage:5000/status`
   - Studio: `fetch('http://localhost:3000/api/platform/profile')`
   - Envoy: TCP check on port 8000
6. Verify `supabase_default` Docker network exists

#### Step 4 — E-Logbook Deployment

**UI:** Progress bar with build status.

Process:
1. Build E-Logbook Docker image from source
2. Write `.env.local` with Supabase connection details:
   - `NEXT_PUBLIC_SUPABASE_URL=http://api-gw:8000`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY={ANON_KEY}`
   - `SUPABASE_SERVICE_ROLE_KEY={SERVICE_ROLE_KEY}`
   - `NEXT_PUBLIC_SITE_URL={user-provided URL}`
   - `APP_ENCRYPTION_KEY={auto-generated}`
3. Write `docker-compose.yml` (production stack)
4. Run `docker compose up -d`
5. Verify app health check: `http://localhost:3000/api/health`

#### Step 5 — Database Migrations

**UI:** Progress bar showing migration count.

Process:
1. Connect to PostgreSQL directly via `pg` client
2. Read all files from `supabase/migrations/` in order
3. Execute each migration SQL file
4. Seed subscription plans and default templates
5. Verify table counts match expected values
6. Update `versions.json` with migration state

Fallback: If direct SQL fails, try `supabase db push` + `supabase seed`.

#### Step 6 — Create Admin Account

**UI:** Form with email, password, full name fields.

Process:
1. Connect to GoTrue Auth API at `http://auth:9999`
2. Create user with `admin.create_user`:
   - email
   - password (hashed by GoTrue)
   - email_confirm: true
3. Insert profile into `profiles` table:
   - user_id (from auth response)
   - tenant_id (create new tenant if first admin)
   - role: `admin`
   - full_name
4. Verify user can authenticate

#### Step 7 — Domain & SSL

**UI:** Domain input field with validation.

Process:
1. User enters domain (e.g., `elogbook.example.com`)
2. Validate domain format
3. Generate Caddyfile:
   ```
   elogbook.example.com {
       reverse_proxy app:3000
   }
   ```
4. Write to `config/Caddyfile`
5. Start Caddy container
6. Verify SSL certificate issued (check Caddy logs)

#### Step 8 — Complete

**UI:** Summary dashboard with all service statuses.

Process:
1. Write `.setup-complete` marker file
2. Set `SETUP_MODE=false` in environment
3. Show summary:
   - All service URLs
   - Admin login credentials
   - Supabase Studio URL
   - Generated secrets (with warning)
4. "Go to Dashboard" button

---

## 4. Update Wizard

### 4.1 Access

Available at `/update` from admin panel when `.setup-complete` exists.

### 4.2 Check for Updates

**UI:** Current version → Available version with changelog.

Process:
1. Fetch latest release from E-Logbook GitHub API
2. Fetch latest release from Supabase GitHub API
3. Compare against `volumes/elogbook/versions.json`
4. Show diff: what's new, what changed

### 4.3 User Approval

**UI:** Checkboxes for which component to update.

Display:
- E-Logbook: current → available (list of changes)
- Supabase: current → available (list of changes)
- "Update Now" button (requires admin confirmation)

### 4.4 Pre-Update Backup

**UI:** Backup progress with size indicator.

Process:
1. Create full database backup via `pg_dump`
2. Export `auth.users` via Supabase Admin API
3. Snapshot storage volume files
4. Copy config files (`.env.local`, `.env`, `Caddyfile`)
5. Copy `versions.json`
6. Generate `manifest.json`
7. Apply retention policy (delete old backups)

### 4.5 Execute Update

#### E-Logbook Update

```
1. git pull origin main
2. docker compose build --no-cache app
3. Run new migrations (if any)
4. docker compose up -d app
5. Verify health check
```

#### Supabase Update

```
1. Pull latest Supabase images
2. Stop E-Logbook app (keep Caddy for status page)
3. docker compose -f /opt/supabase/docker-compose.yml up -d
4. Wait for health checks on all services
5. Restart E-Logbook app
6. Verify full stack health
```

### 4.6 Post-Update Verification

**UI:** Pass/fail per service.

Checks:
- All containers running
- Database connectivity
- Auth service responding
- Storage service responding
- E-Logbook health endpoint
- Login flow test
- Case data integrity (row counts)

### 4.7 Rollback on Failure

Automatic rollback if any health check fails:

```
1. Stop current containers
2. Restore database from backup (pg_restore)
3. Restore auth users
4. Restore config files
5. Restart with previous Docker images
6. Verify health checks
7. Show error + rollback log
```

---

## 5. Uninstall Wizard

### 5.1 Access

Available at `/uninstall` from admin panel.

### 5.2 Confirm Identity

- Enter admin email + password
- Must type "DELETE" to confirm
- Warning: "This action cannot be undone"

### 5.3 Choose Scope

| Option | What's Removed | What's Kept |
|--------|---------------|-------------|
| Stop Services | Nothing (just stops containers) | Everything |
| Remove E-Logbook | E-Logbook containers, images, config, volumes | Supabase intact |
| Remove Supabase | Supabase containers, images, volumes, config | E-Logbook intact |
| Full Removal | Everything | Nothing |

### 5.4 Execute Uninstall

#### E-Logbook Removal

```
1. docker compose -f elogbook/docker-compose.yml down -v
2. Remove elogbook/ directory
3. Remove Caddy config
4. Remove elogbook Docker images
5. Leave Supabase running
```

#### Supabase Removal

```
1. docker compose -f /opt/supabase/docker-compose.yml down -v
2. Remove Supabase volumes
3. Remove Supabase images
4. Remove /opt/supabase/ directory
5. Remove supabase_default network
```

#### Full Removal

```
1. Stop all containers (E-Logbook + Supabase)
2. Remove all volumes
3. Remove all images (elogbook + supabase)
4. Remove all config files and directories
5. Remove Docker networks
6. Clean up Docker system (docker system prune)
```

### 5.5 Confirmation

- Shows what was removed
- Offers "Reinstall" button (redirects to `/setup`)

---

## 6. Data Safeguard Rails

### 6.1 What Must Be Preserved

| Data Type | Storage | Backup Method | Survives Restart | Survives Update |
|-----------|---------|---------------|-----------------|-----------------|
| Case logs | PostgreSQL `case_entries` | pg_dump | Yes (volume) | Yes (pre-backup) |
| Case templates | PostgreSQL `case_templates` | pg_dump | Yes | Yes |
| Resident profiles | PostgreSQL `profiles` | pg_dump | Yes | Yes |
| Admin credentials | PostgreSQL `auth.users` + `profiles` | pg_dump + auth export | Yes | Yes |
| Tenant config | PostgreSQL `tenants` | pg_dump | Yes | Yes |
| Approval requests | PostgreSQL `approval_requests` | pg_dump | Yes | Yes |
| Audit logs | PostgreSQL `audit_logs` | pg_dump | Yes | Yes |
| File attachments | Docker volume `storage/` | Volume snapshot | Yes | Yes |
| Subscription plans | PostgreSQL `subscription_plans` | pg_dump | Yes | Yes |
| App config | `volumes/elogbook/.env.local` | File copy | Yes | Yes |
| Supabase secrets | `volumes/supabase/.env` | File copy | Yes | Yes |
| SSL certificates | Caddy volume `caddy_data/` | Volume snapshot | Yes | Yes |

### 6.2 Backup Architecture

```
volumes/elogbook/backups/
├── auto/
│   ├── 2026-08-18T10:00:00Z/
│   │   ├── database.sql.gz
│   │   ├── auth_users.json
│   │   ├── storage/
│   │   ├── .env.local
│   │   ├── .env
│   │   ├── versions.json
│   │   ├── Caddyfile
│   │   └── manifest.json
│   └── 2026-08-17T02:00:00Z/
├── manual/
│   └── pre-update-v3.2.0/
└── retention.json
```

### 6.3 Backup Manifest

```json
{
  "backup_id": "2026-08-18T10:00:00Z",
  "type": "auto",
  "trigger": "pre-update",
  "elogbook_version": "3.1.0",
  "supabase_version": "2026.08.01",
  "created_at": "2026-08-18T10:00:00Z",
  "size_bytes": 524288000,
  "contents": {
    "database": true,
    "auth_users": true,
    "storage_files": true,
    "config": true,
    "ssl_certs": true
  },
  "database_stats": {
    "tables": 45,
    "case_entries": 1250,
    "profiles": 35,
    "tenants": 3
  }
}
```

### 6.4 Automatic Backup Triggers

| Event | Backup Type | Retention |
|-------|------------|-----------|
| Before any update | Full backup | 30 days |
| Before container restart | Config + DB snapshot | 7 days |
| Before migration run | Full backup | 30 days |
| Daily at 2 AM | Incremental DB dump | 14 days |
| Before uninstall | Full backup | Permanent |

### 6.5 Backup Operations

```typescript
// Core backup operations
async function createFullBackup(trigger: string): Promise<BackupManifest>
async function createIncrementalBackup(): Promise<BackupManifest>
async function restoreFromBackup(backupId: string): Promise<RestoreResult>
async function verifyBackupIntegrity(backupId: string): Promise<boolean>
async function applyRetentionPolicy(): Promise<number>
```

### 6.6 Data Integrity Verification

After every operation:

```typescript
async function verifyDataIntegrity(): Promise<IntegrityReport> {
  return {
    case_entries: await countRows('case_entries'),
    profiles: await countRows('profiles'),
    tenants: await countRows('tenants'),
    auth_users: await countAuthUsers(),
    storage_files: await countStorageFiles(),
    templates: await countRows('case_templates'),
    approvals: await countRows('approval_requests'),
    audit_logs: await countRows('audit_logs'),
  };
}
```

### 6.7 Safe Restart Guard

```typescript
async function safeRestart(): Promise<void> {
  const backup = await createFullBackup('pre-restart');
  const valid = await verifyBackupIntegrity(backup.backup_id);
  if (!valid) throw new Error('Backup verification failed');
  await gracefulShutdown();
  await dockerComposeRestart();
  await waitForHealthy(60000);
  await verifyDataIntegrity();
}
```

### 6.8 Manual Backup/Restore UI

Available at `/settings/backup`:

- Create backup now
- View all backups (list with size, date, contents)
- Download backup as `.tar.gz`
- Upload backup from file
- Restore from backup (select + confirm)
- Delete backup
- Set retention policy

### 6.9 Backup Retention Policy

```json
{
  "auto_backups": {
    "daily": 14,
    "pre_update": 30,
    "pre_restart": 7
  },
  "manual_backups": {
    "retention": "permanent"
  },
  "minimum_kept": 3,
  "max_total_size_gb": 10
}
```

---

## 7. Version Tracking

### 7.1 versions.json

Located at `volumes/elogbook/versions.json`:

```json
{
  "elogbook": {
    "version": "3.2.0",
    "commit": "0d2bbec",
    "updated_at": "2026-08-18T10:00:00Z",
    "docker_images": ["elogbook-web:3.2.0", "caddy:2"]
  },
  "supabase": {
    "version": "2026.08.03",
    "commit": "022b374",
    "updated_at": "2026-08-18T10:00:00Z",
    "docker_images": [
      "supabase/postgres:17.6.1.136",
      "supabase/gotrue:v2.189.0",
      "supabase/studio:2026.08.03",
      "supabase/realtime:v2.102.3",
      "supabase/storage-api:v1.60.4",
      "supabase/postgres-meta:v0.96.6",
      "supabase/edge-runtime:v1.74.0",
      "supabase/supavisor:2.9.5",
      "postgrest/postgrest:v14.12",
      "darthsim/imgproxy:v3.30.1",
      "envoyproxy/envoy:v1.39.0"
    ]
  },
  "migrations": {
    "last_run": "20260818100000_fix_rls_case_submission_and_templates.sql",
    "count": 100
  }
}
```

---

## 8. Security

- Setup wizard only accessible when `.setup-complete` is absent
- All setup API routes validate setup state before executing
- DB credentials handled server-side, never exposed to browser
- Admin password hashed via GoTrue Auth
- Caddy config only generated with user-provided domain
- `.env.local` stored in persistent volume, not baked into image
- Backup files stored in persistent volume with restricted permissions
- Supabase's own files are never modified by E-Logbook

---

## 9. New Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | E-Logbook production stack |
| `setup.docker-compose.yml` | Setup-phase temporary stack |
| `apps/web/app/setup/page.tsx` | Setup wizard entry |
| `apps/web/app/setup/layout.tsx` | Setup layout (no auth) |
| `apps/web/app/update/page.tsx` | Update wizard page |
| `apps/web/app/uninstall/page.tsx` | Uninstall wizard page |
| `apps/web/app/settings/backup/page.tsx` | Backup/restore UI |
| `apps/web/app/api/setup/check-requirements/route.ts` | Requirement checks |
| `apps/web/app/api/setup/deploy-supabase/route.ts` | Docker API calls |
| `apps/web/app/api/setup/test-db/route.ts` | Test DB connection |
| `apps/web/app/api/setup/migrate/route.ts` | Run migrations |
| `apps/web/app/api/setup/seed/route.ts` | Run seed data |
| `apps/web/app/api/setup/create-admin/route.ts` | Create admin user |
| `apps/web/app/api/setup/configure-domain/route.ts` | Caddy config |
| `apps/web/app/api/setup/complete/route.ts` | Finalize setup |
| `apps/web/app/api/update/check/route.ts` | Check for updates |
| `apps/web/app/api/update/execute/route.ts` | Execute update |
| `apps/web/app/api/uninstall/route.ts` | Uninstall logic |
| `apps/web/app/api/backup/route.ts` | Backup operations |
| `apps/web/app/api/backup/restore/route.ts` | Restore operations |
| `apps/web/lib/setup/docker-api.ts` | Docker socket client |
| `apps/web/lib/setup/supabase-installer.ts` | Supabase clone + config |
| `apps/web/lib/setup/db-migrator.ts` | SQL migration runner |
| `apps/web/lib/setup/version-tracker.ts` | Version comparison |
| `apps/web/lib/setup/backup-manager.ts` | Backup/restore logic |
| `apps/web/lib/setup/data-verifier.ts` | Data integrity checks |
| `apps/web/lib/setup/caddy-config.ts` | Caddyfile generator |
| `apps/web/lib/setup/restart-guard.ts` | Safe restart logic |
| `apps/web/middleware.ts` | Setup mode redirect |
| `volumes/db/roles.sql` | Supabase DB roles init |
| `volumes/db/jwt.sql` | Supabase JWT init |

---

## 10. Dependencies

| Package | Purpose |
|---------|---------|
| `pg` | Raw PostgreSQL client for migrations |
| `@supabase/supabase-js` | Supabase Admin API calls (existing) |

---

## 11. Docker Compose Files

### 11.1 Setup Docker Compose

```yaml
services:
  app:
    build: .
    environment:
      - SETUP_MODE=true
    ports: ["3000:3000"]
    volumes:
      - ./volumes/elogbook:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - setup-db

  setup-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: setup_temp
      POSTGRES_DB: elogbook_setup
    tmpfs: /var/lib/postgresql/data
```

### 11.2 Production Docker Compose

```yaml
name: elogbook

services:
  app:
    build: .
    restart: unless-stopped
    ports: ["3000:3000"]
    volumes:
      - ./volumes/elogbook:/app/data
    environment:
      - SETUP_MODE=false
      - NEXT_PUBLIC_SUPABASE_URL=http://api-gw:8000
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
      - SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
      - NEXT_PUBLIC_SITE_URL=${SITE_URL}
      - APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
    depends_on:
      api-gw:
        condition: service_healthy
    networks:
      - elogbook
      - supabase_default

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./config/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - elogbook

networks:
  elogbook:
    driver: bridge
  supabase_default:
    external: true

volumes:
  caddy_data:
  caddy_config:
```

---

## 12. Middleware Logic

The middleware runs in Node.js runtime (not Edge) to allow filesystem access:

```typescript
// apps/web/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { existsSync } from 'fs';

const SETUP_COMPLETE_PATH = '/app/data/.setup-complete';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/setup|api/update|api/uninstall|api/backup).*)'],
};

export function middleware(request: NextRequest) {
  const setupMode = process.env.SETUP_MODE === 'true';
  const setupComplete = existsSync(SETUP_COMPLETE_PATH);
  const path = request.nextUrl.pathname;

  // Setup mode: redirect everything to /setup
  if (setupMode && !setupComplete && !path.startsWith('/setup')) {
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  // Normal mode: redirect away from /setup
  if (!setupMode && setupComplete && path.startsWith('/setup')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Uninstall requires setup complete
  if (path.startsWith('/uninstall') && !setupComplete) {
    return NextResponse.redirect(new URL('/setup', request.url));
  }

  return NextResponse.next();
}
```

**Note:** This requires `runtime = 'nodejs'` in `next.config.mjs` or the middleware config to ensure it runs in Node.js, not Edge.
