import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest,
  adminInputSchema, auditSetup, setupRuntimeEnabled,
  writeSetupReceiptAtomically, removeSetupReceipt,
} from '@/lib/setup/guard';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface SupabaseSetupConfig {
  serviceRoleKey: string;
  postgresDb?: string;
  postgresPassword?: string;
}

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (!setupRuntimeEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // M8.1/N9: bootstrap boundary + token + origin + rate limit + durable lock.
  // Token use is durably accounted (replay-bounded); IP honors proxy trust.
  const clientIp = clientIpOfRequest(request);
  const gate = checkSetupRequest(
    {
      url: request.url,
      method: 'POST',
      headers: {
        'x-setup-token': request.headers.get('x-setup-token') ?? undefined,
        'x-forwarded-proto': request.headers.get('x-forwarded-proto') ?? undefined,
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
      },
      ip: clientIp,
    },
    'create-admin',
  );
  if (!gate.ok) {
    auditSetup('create-admin', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('create-admin', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'create-admin');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const guarded = await guardRequest(request, adminInputSchema, {
    requireOrigin: false,
    maxBodyBytes: 16 * 1024,
  });
  if (!guarded.ok) return guarded.response;
  const { email, password, fullName } = guarded.data;

  const configPath = join('/app/data', 'supabase-config.json');
  if (!existsSync(configPath)) {
    return NextResponse.json({ error: 'Supabase not configured yet' }, { status: 400 });
  }

  let config: SupabaseSetupConfig;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as SupabaseSetupConfig;
  } catch {
    return NextResponse.json({ error: 'Supabase configuration is unreadable' }, { status: 500 });
  }

  if (typeof config.serviceRoleKey !== 'string' || !config.serviceRoleKey.startsWith('eyJ')) {
    return NextResponse.json({ error: 'Invalid service role key in config' }, { status: 500 });
  }

  // Executor lock covers the mutating section only (validation above is lock-free).
  if (!acquireDurableLock('create-admin')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }
  removeSetupReceipt('setup-admin.json');
  try {
    const pool = new Pool({
      host: 'db',
      port: 5432,
      database: config.postgresDb ?? 'supabase',
      user: 'postgres',
      password: config.postgresPassword ?? '',
      max: 1,
    });
    let tenantCreated = false;
    let tenantId = '';
    try {
      const tenantInsert = await pool.query(
        "INSERT INTO tenants (name, slug, tenant_type, mrn_hash_salt) VALUES ($1, $2, 'institution', encode(extensions.gen_random_bytes(32), 'hex')) ON CONFLICT (slug) DO NOTHING RETURNING id",
        ['My Institution', 'my-institution'],
      );
      tenantId = tenantInsert.rows[0]?.id ?? '';
      tenantCreated = Boolean(tenantId);
      if (!tenantId) {
        const existingTenant = await pool.query('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', ['my-institution']);
        tenantId = existingTenant.rows[0]?.id ?? '';
      }
      if (!tenantId) throw new Error('setup tenant could not be created');

      const setupSupabaseInternalUrl = process.env.SETUP_SUPABASE_INTERNAL_URL ?? 'http://kong:8000';
      const authClient = createClient(setupSupabaseInternalUrl, config.serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      let inviteId = '';
      try {
        const inviteResult = await pool.query(
          "INSERT INTO public.tenant_invites (tenant_id, email, role, status) VALUES ($1, $2, 'admin', 'pending') RETURNING id",
          [tenantId, email.toLowerCase()],
        );
        inviteId = String(inviteResult.rows[0]?.id ?? '');
      } catch (error) {
        if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        logger.error('Failed to create admin invitation', error, { tenantId });
        return NextResponse.json({ error: 'Admin onboarding could not be initialized' }, { status: 500 });
      }
      if (!inviteId) {
        if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        return NextResponse.json({ error: 'Admin onboarding could not be initialized' }, { status: 500 });
      }

      const { data: authUser, error: createError } = await authClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
        },
      } as Parameters<typeof authClient.auth.admin.createUser>[0]);

      if (createError || !authUser?.user?.id) {
        await pool.query('DELETE FROM public.tenant_invites WHERE id = $1', [inviteId]);
        if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        logger.error('Failed to create admin user', createError, { tenantId });
        return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 });
      }

      const userId = authUser.user.id;
      let profile: { role?: string; status?: string; pending_role?: string } | undefined;
      let profileError: unknown = null;
      try {
        const profileResult = await pool.query(
          'SELECT id, role, status, pending_role FROM public.profiles WHERE user_id = $1 AND tenant_id = $2 LIMIT 1',
          [userId, tenantId],
        );
        profile = profileResult.rows[0] as typeof profile;
      } catch (error) {
        profileError = error;
      }
      const profileReady = profileError === null
        && profile?.role === 'resident'
        && profile?.status === 'pending'
        && profile?.pending_role === 'admin';
      if (!profileReady) {
        const cleanup = await authClient.auth.admin.deleteUser(userId);
        let cleanupInviteError: unknown = null;
        try {
          await pool.query('DELETE FROM public.tenant_invites WHERE id = $1', [inviteId]);
        } catch (error) {
          cleanupInviteError = error;
        }
        if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        logger.error('Failed to verify pending admin profile', profileError ?? cleanup.error ?? cleanupInviteError, { userId, tenantId });
        return NextResponse.json({ error: 'Admin onboarding could not be initialized' }, { status: 500 });
      }

      try {
        writeSetupReceiptAtomically('setup-admin.json', {
          success: true,
          completed_at: new Date().toISOString(),
          user_id: userId,
          tenant_id: tenantId,
        });
      } catch (error) {
        await authClient.auth.admin.deleteUser(userId);
        await pool.query('DELETE FROM public.tenant_invites WHERE id = $1', [inviteId]);
        if (tenantCreated) await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
        throw error;
      }

      auditSetup('create-admin', 'ok');
      return NextResponse.json({ success: true, userId, tenantId, pendingMfaPromotion: true });
    } finally {
      await pool.end();
    }
  } catch (error) {
    removeSetupReceipt('setup-admin.json');
    logger.error('Admin creation failed', error);
    auditSetup('create-admin', 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    releaseDurableLock('create-admin');
  }
}
