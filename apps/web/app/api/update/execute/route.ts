import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createFullBackup } from '@/lib/setup/backup-manager';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!existsSync(process.env.SETUP_COMPLETE_PATH ?? '/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`update:${ip}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  // T16: platform operators only (registry + AAL2 via requirePlatformAdmin).
  // Tenant admins/directors are denied here as well as in the UI.
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }
  const { user, profile } = platform;

  const body = await request.json();
  const { component } = body;

  const allowedComponents = ['elogbook', 'supabase', 'both'];
  if (component && !allowedComponents.includes(component)) {
    return NextResponse.json({ error: `Invalid component. Must be one of: ${allowedComponents.join(', ')}` }, { status: 400 });
  }

  // T16: the synchronous in-app updater (F02) is retired. Durable execution
  // belongs to the manager job flow (T10-full/T14). Explicit escape hatch
  // preserves the legacy path for non-production recovery only; default is
  // an honest 503 — never fake success.
  if (process.env.ELOGBOOK_LEGACY_UPDATER !== 'true') {
    return NextResponse.json(
      {
        error: 'Update executor unavailable',
        state: 'unavailable',
        detail:
          'Durable update execution is not enabled on this installation. Set ELOGBOOK_LEGACY_UPDATER=true for the legacy non-production path, or wait for manager-owned updates.',
      },
      { status: 503 },
    );
  }

  // Audit
  try {
    const adminClient = createServiceRoleClient();
    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'update_requested',
      resource_type: 'system',
      resource_id: component || 'both',
      changes: { component, ip },
    });
  } catch { /* best-effort */ }

  const configPath = join('/app/data', 'supabase-config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : null;

  try {
    if (config) {
      await createFullBackup('pre-update', {
        host: 'db', port: 5432, database: config.postgresDb, user: 'postgres', password: config.postgresPassword,
      }, { elogbook: '1.0.0', supabase: '1.0.0' });
    }

    if (component === 'elogbook' || component === 'both') {
      execSync('git pull origin main', { encoding: 'utf-8', timeout: 120000 });
      execSync('docker compose build --no-cache app', { encoding: 'utf-8', timeout: 600000 });
      execSync('docker compose up -d app', { encoding: 'utf-8', timeout: 120000 });
    }

    if ((component === 'supabase' || component === 'both') && config) {
      execSync('git pull origin master', { cwd: config.installPath, encoding: 'utf-8', timeout: 120000 });
      execSync('docker compose pull', { cwd: config.installPath, encoding: 'utf-8', timeout: 300000 });
      execSync('docker compose up -d', { cwd: config.installPath, encoding: 'utf-8', timeout: 120000 });
    }

    return NextResponse.json({ success: true, message: 'Update completed successfully' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
