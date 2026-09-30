import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { createFullBackup } from '@/lib/setup/backup-manager';
import { runDocker } from '@/lib/setup/host-exec';
import {
  isSafeInstallPath,
  isSetupComplete,
  readInstallConfig,
  uninstallReceiptPath,
} from '@/lib/setup/install-state';
import { acquireDurableLock, releaseDurableLock } from '@/lib/setup/guard';
import { controlPlaneError, controlPlaneJson, withControlPlaneHeaders } from '@/lib/http/control-plane';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const uninstallSchema = z.object({
  scope: z.enum(['stop', 'elogbook', 'supabase', 'full']),
  confirm: z.literal('DELETE'),
}).strict();

type UninstallScope = z.infer<typeof uninstallSchema>['scope'];

export const runtime = 'nodejs';

/**
 * Control-plane uninstall.
 *
 * Uninstall destroys containers, volumes, and installation paths for EVERY
 * tenant, so it is platform-operator only: the platform-admin registry plus
 * server-verified AAL2 (`requirePlatformAdmin`). A tenant `admin` role label
 * is explicitly not sufficient, and `NODE_ENV` is build containment layered on
 * top, never the authorization decision.
 *
 * Safety properties:
 *  - serialized by a durable lease, so two destroys cannot interleave,
 *  - idempotent per scope via an owner-only receipt, so a retried call after a
 *    partial failure reports the recorded outcome instead of re-running,
 *  - scoped to paths the server reads from its own config; a caller can never
 *    supply a tenant id or a filesystem path, and
 *  - never returns a raw child-process or filesystem error.
 */

function controlPlaneAbsent() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') return controlPlaneError('Not Found', 404);
  return null;
}

function receiptRecorded(scope: UninstallScope): boolean {
  try {
    return existsSync(uninstallReceiptPath(scope));
  } catch {
    return false;
  }
}

function recordReceipt(scope: UninstallScope, operatorId: string): void {
  const path = uninstallReceiptPath(scope);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ scope, operator: operatorId, appliedAt: new Date().toISOString() })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  renameSync(temporaryPath, path);
}

function alreadyApplied(scope: UninstallScope) {
  return controlPlaneJson({ success: true, alreadyApplied: true, scope });
}

export async function POST(request: Request) {
  const absent = controlPlaneAbsent();
  if (absent) return absent;

  const guarded = await guardRequest(request, uninstallSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return withControlPlaneHeaders(guarded.response);

  if (!isSetupComplete()) {
    return controlPlaneError('Setup not complete', 400);
  }

  // Rate limit privileged uninstall (5/min per IP)
  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`uninstall:${ip}`, 5);
  if (!allowed) return withControlPlaneHeaders(rateLimitResponse(retryAfter));

  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return controlPlaneError(platform.error, platform.status);
  }
  const { user, profile } = platform;

  const { scope } = guarded.data;

  if (receiptRecorded(scope)) return alreadyApplied(scope);

  if (!acquireDurableLock('uninstall')) {
    return controlPlaneError('Another uninstall operation is running', 409);
  }

  try {
    // Re-check under the lease: a caller that waited for the previous
    // executor must observe its recorded outcome, not run a second teardown.
    if (receiptRecorded(scope)) return alreadyApplied(scope);

    // Null on a missing/malformed config; never echoes file contents.
    const config = readInstallConfig();
    const supabasePath = config?.installPath ?? null;
    const safeSupabasePath = isSafeInstallPath(supabasePath) ? supabasePath : null;

    if (scope !== 'stop' && scope !== 'elogbook' && safeSupabasePath === null) {
      return controlPlaneError('Supabase install path is unavailable', 400);
    }

    try {
      const adminClient = createServiceRoleClient();
      await adminClient.from('audit_logs').insert({
        tenant_id: profile.tenant_id,
        user_id: user.id,
        action: 'uninstall_requested',
        resource_type: 'system',
        resource_id: profile.id,
        changes: { scope },
      });
    } catch (error) {
      logger.error('Uninstall audit failed', error, { scope });
    }

    if (config && scope !== 'stop') {
      try {
        await createFullBackup(
          'pre-uninstall',
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
        // Refuse to destroy data that was not captured first.
        logger.error('Pre-uninstall backup failed', error, { scope });
        return controlPlaneError('Pre-uninstall backup failed — refusing to remove data', 500);
      }
    }

    switch (scope) {
      case 'stop':
        runDocker(['compose', 'down']);
        if (safeSupabasePath) runDocker(['compose', 'down'], { cwd: safeSupabasePath });
        break;
      case 'elogbook':
        runDocker(['compose', 'down', '-v']);
        rmSync('/app/data', { recursive: true, force: true });
        rmSync('/app/config', { recursive: true, force: true });
        break;
      case 'supabase':
        runDocker(['compose', 'down', '-v'], { cwd: safeSupabasePath as string });
        rmSync(safeSupabasePath as string, { recursive: true, force: true });
        break;
      case 'full':
        runDocker(['compose', 'down', '-v']);
        runDocker(['compose', 'down', '-v'], { cwd: safeSupabasePath as string });
        rmSync(safeSupabasePath as string, { recursive: true, force: true });
        rmSync('/app/data', { recursive: true, force: true });
        rmSync('/app/config', { recursive: true, force: true });
        runDocker(['system', 'prune', '-f']);
        break;
    }

    recordReceipt(scope, user.id);
    return controlPlaneJson({ success: true, alreadyApplied: false, scope });
  } catch (error) {
    // A failed teardown stays retryable: no receipt is written, so a later
    // call re-runs the scope instead of claiming a success that never happened.
    logger.error('Uninstall failed', error, { scope });
    return controlPlaneError('Uninstall failed', 500);
  } finally {
    releaseDurableLock('uninstall');
  }
}
