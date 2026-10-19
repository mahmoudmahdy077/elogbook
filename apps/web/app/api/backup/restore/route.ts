import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { restoreFromBackup } from '@/lib/setup/backup-manager';
import { resolveRestoreTarget, restoreTargetAllowlistFromEnv } from '@/lib/setup/restore-target';
import { isSetupComplete, readInstallConfig } from '@/lib/setup/install-state';
import { controlPlaneError, controlPlaneJson, withControlPlaneHeaders } from '@/lib/http/control-plane';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const restoreRequestSchema = z.object({
  backupId: z.string().min(1).max(256),
  /** Opaque id of a server-provisioned disposable target — never a database name. */
  restoreTargetId: z.string().min(1).max(64),
  confirmDisposableTarget: z.literal(true),
}).strict();

export const runtime = 'nodejs';

/**
 * Control-plane restore.
 *
 * Authority comes ONLY from the platform-admin registry plus server-verified
 * AAL2; a tenant role label and `NODE_ENV` confer nothing.
 *
 * The caller cannot name a database. `restoreTargetId` is resolved through the
 * operator-provisioned allowlist into a name the server derives inside its own
 * namespace, so `postgres`, `template1`, the live database, and arbitrary
 * names are unreachable by construction. Nothing is decrypted and no connection
 * is opened until that resolution succeeds.
 */
function controlPlaneAbsent() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') return controlPlaneError('Not Found', 404);
  return null;
}

/**
 * Control-plane restore target inventory.
 *
 * The operator needs to know which opaque target ids exist on this installation
 * before a drill can be run, and the client cannot invent one. Only ids that
 * survive the operator allowlist (malformed and reserved entries already
 * dropped) are returned; the derived database name never leaves the server, so
 * this discloses routing identifiers, not connection targets.
 */
export async function GET() {
  const absent = controlPlaneAbsent();
  if (absent) return absent;

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return controlPlaneError(platform.error, platform.status);
  }

  const restoreTargets = restoreTargetAllowlistFromEnv();
  return controlPlaneJson({ restoreTargets });
}

export async function POST(request: Request) {
  const absent = controlPlaneAbsent();
  if (absent) return absent;

  const guarded = await guardRequest(request, restoreRequestSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return withControlPlaneHeaders(guarded.response);

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`restore:${ip}`, 5);
  if (!allowed) return withControlPlaneHeaders(rateLimitResponse(retryAfter));

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

  const { backupId, restoreTargetId, confirmDisposableTarget } = guarded.data;

  const target = resolveRestoreTarget({
    targetId: restoreTargetId,
    allowlist: restoreTargetAllowlistFromEnv(),
    productionDatabase: config.postgresDb,
  });
  if (!target.ok) {
    logger.warn('Restore target refused', { reason: target.reason });
    return controlPlaneError('Restore target is not an available disposable target', 400);
  }

  const result = await restoreFromBackup(
    backupId,
    {
      host: 'db',
      port: 5432,
      database: config.postgresDb,
      user: 'postgres',
      password: config.postgresPassword,
    },
    {
      disposableTarget: confirmDisposableTarget,
      targetDatabase: target.database,
      postRestoreCheckHook: process.env.POST_RESTORE_CHECK_HOOK || '',
    },
  );

  if (!result.success) {
    // Engine output can contain connection detail; it is logged under
    // redaction and never returned to the caller.
    logger.error('Control-plane restore failed', undefined, { backupId, restoreTarget: target.database, reason: result.error });
    return controlPlaneError('Restore failed', 500);
  }

  try {
    const adminClient = createServiceRoleClient();
    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'backup_restored',
      resource_type: 'system',
      resource_id: profile.id,
      changes: { backup_id: backupId, restore_target: target.database },
    });
  } catch (error) {
    logger.error('Control-plane restore audit failed', error, { backupId });
  }

  return controlPlaneJson({ success: true, restoreTarget: target.database });
}
