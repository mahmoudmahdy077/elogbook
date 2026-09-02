import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createFullBackup } from '@/lib/setup/backup-manager';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

// Privileged operation — operator-only (platform admin). Directors and
// institution_admins must not be able to destroy infrastructure.
const ADMIN_ROLES = ['admin'];

export async function POST(request: Request) {
  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  // Rate limit privileged uninstall (5/min per IP)
  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`uninstall:${ip}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { session } } = await supabase.auth.getSession();
  // Require fresh AAL2 for destructive operations — if user has MFA enrolled, session must be aal2
  if ((session as { aal?: string } | null)?.aal && (session as { aal?: string })?.aal !== 'aal2') {
    try {
      const { data: mfaData } = await supabase.auth.mfa.listFactors();
      const hasVerifiedMfa = mfaData?.all?.some((f) => f.status === 'verified') ?? false;
      if (hasVerifiedMfa) {
        return NextResponse.json({ error: 'Re-authentication with MFA required for this operation' }, { status: 403 });
      }
    } catch { /* ignore */ }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role')
    .eq('user_id', user.id)
    .single();

  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions — operator only' }, { status: 403 });
  }

  const body = await request.json();
  const { scope, confirm } = body;

  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 });
  }

  const allowedScopes = ['stop', 'elogbook', 'supabase', 'full'];
  if (!allowedScopes.includes(scope)) {
    return NextResponse.json({ error: `Invalid scope. Must be one of: ${allowedScopes.join(', ')}` }, { status: 400 });
  }

  const configPath = join('/app/data', 'supabase-config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : null;

  // Audit before destructive action (service-role bypasses RLS)
  try {
    const adminClient = createServiceRoleClient();
    await adminClient.from('audit_logs').insert({
      tenant_id: profile.tenant_id,
      user_id: user.id,
      action: 'uninstall_requested',
      resource_type: 'system',
      resource_id: scope,
      changes: { scope, ip },
    });
  } catch { /* audit best-effort */ }

  try {
    if (config && scope !== 'stop') {
      await createFullBackup('pre-uninstall', {
        host: 'db', port: 5432, database: config.postgresDb, user: 'postgres', password: config.postgresPassword,
      }, { elogbook: '1.0.0', supabase: '1.0.0' });
    }

    if (scope === 'stop') {
      execSync('docker compose down', { encoding: 'utf-8', timeout: 60000 });
      if (config) {
        execSync('docker compose down', { cwd: config.installPath, encoding: 'utf-8', timeout: 60000 });
      }
    } else if (scope === 'elogbook') {
      execSync('docker compose down -v', { encoding: 'utf-8', timeout: 60000 });
      rmSync('/app/data', { recursive: true, force: true });
      rmSync('/app/config', { recursive: true, force: true });
    } else if (scope === 'supabase' && config) {
      execSync('docker compose down -v', { cwd: config.installPath, encoding: 'utf-8', timeout: 60000 });
      rmSync(config.installPath, { recursive: true, force: true });
    } else if (scope === 'full') {
      execSync('docker compose down -v', { encoding: 'utf-8', timeout: 60000 });
      if (config) {
        execSync('docker compose down -v', { cwd: config.installPath, encoding: 'utf-8', timeout: 60000 });
        rmSync(config.installPath, { recursive: true, force: true });
      }
      rmSync('/app/data', { recursive: true, force: true });
      rmSync('/app/config', { recursive: true, force: true });
      execSync('docker system prune -f', { encoding: 'utf-8', timeout: 60000 });
    }

    return NextResponse.json({ success: true, message: `${scope} removal completed` });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
