import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createFullBackup } from '@/lib/setup/backup-manager';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';

// Privileged operation — operator-only
const ADMIN_ROLES = ['admin'];

export async function POST(request: Request) {
  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`update:${ip}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { session } } = await supabase.auth.getSession();
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
  const { component } = body;

  const allowedComponents = ['elogbook', 'supabase', 'both'];
  if (component && !allowedComponents.includes(component)) {
    return NextResponse.json({ error: `Invalid component. Must be one of: ${allowedComponents.join(', ')}` }, { status: 400 });
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
