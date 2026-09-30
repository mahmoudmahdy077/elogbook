import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { createFullBackup, listBackups } from '@/lib/setup/backup-manager';
import { isSetupComplete, readInstallConfig } from '@/lib/setup/install-state';
import { controlPlaneError, controlPlaneJson, withControlPlaneHeaders } from '@/lib/http/control-plane';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const backupRequestSchema = z.object({
  type: z.string().min(1).max(64).optional(),
}).strict();

export const runtime = 'nodejs';

/**
 * Control-plane backup.
 *
 * A backup reads the installation's database credentials and reports the
 * contents of every tenant, so authority comes ONLY from the platform-admin
 * registry plus server-verified AAL2 (`requirePlatformAdmin`). A tenant
 * `admin`/`institution_admin` label confers nothing, and `NODE_ENV` is an
 * additional build containment layer rather than the authorization decision.
 *
 * Responses are no-store, carry only backup metadata (never a credential, key
 * reference, or artifact content), and never echo an underlying error.
 */

/** Backup inventory projection: metadata only, no keys, checksums, or contents. */
type BackupManifestLike = {
  backup_id?: unknown;
  trigger?: unknown;
  created_at?: unknown;
  size_bytes?: unknown;
  durability?: unknown;
  object_lock?: { mode?: unknown } | null;
  contents?: Record<string, boolean> | null;
};

type BackupSummary = {
  backup_id: string;
  trigger: string;
  created_at: string;
  size_bytes: number;
  durability: string;
  object_lock_mode: string;
  contents: Record<string, boolean>;
};

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toBackupSummary(manifest: BackupManifestLike): BackupSummary {
  return {
    backup_id: asString(manifest.backup_id),
    trigger: asString(manifest.trigger),
    created_at: asString(manifest.created_at),
    size_bytes: typeof manifest.size_bytes === 'number' ? manifest.size_bytes : 0,
    durability: asString(manifest.durability, 'unknown'),
    object_lock_mode: asString(manifest.object_lock?.mode, 'unknown'),
    contents: { ...(manifest.contents ?? {}) },
  };
}

function controlPlaneAbsent() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') return controlPlaneError('Not Found', 404);
  return null;
}

export async function GET() {
  const absent = controlPlaneAbsent();
  if (absent) return absent;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return controlPlaneError(platform.error, platform.status);
  }

  const backups = listBackups('auto').map((manifest) => toBackupSummary(manifest));
  return controlPlaneJson({ backups });
}

export async function POST(request: Request) {
  const absent = controlPlaneAbsent();
  if (absent) return absent;

  const guarded = await guardRequest(request, backupRequestSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return withControlPlaneHeaders(guarded.response);

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return controlPlaneError(platform.error, platform.status);
  }
  const { user, profile } = platform;

  if (!isSetupComplete()) {
    return controlPlaneError('Setup not complete', 400);
  }

  // Null on a missing/malformed config: fail closed without echoing the file.
  const config = readInstallConfig();
  if (!config) {
    return controlPlaneError('Supabase not configured', 400);
  }

  const { type = 'manual' } = guarded.data;

  let manifest: Awaited<ReturnType<typeof createFullBackup>>;
  try {
    manifest = await createFullBackup(
      type,
      {
        host: 'db',
        port: 5432,
        database: config.postgresDb,
        user: 'postgres',
        password: config.postgresPassword,
      },
      { elogbook: '1.0.0', supabase: '1.0.0' },
    );
  } catch (error) {
    // The dump error can carry host paths or connection details; it is logged
    // under redaction and never returned.
    logger.error('Control-plane backup failed', error, { trigger: type });
    return controlPlaneError('Backup failed', 500);
  }

  if (manifest.durability !== 'durable') {
    return controlPlaneError('Backup is local-test-only; no durable success is reported', 503);
  }

  try {
    const adminClient = createServiceRoleClient();
    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'backup_created',
      resource_type: 'system',
      resource_id: profile.id,
      changes: {
        backup_id: manifest.backup_id,
        trigger: type,
        durability: manifest.durability,
        size_bytes: manifest.size_bytes,
      },
    });
  } catch (error) {
    logger.error('Control-plane backup audit failed', error, { trigger: type });
  }

  return controlPlaneJson({ success: true, manifest: toBackupSummary(manifest) });
}
