import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest,
  adminInputSchema, auditSetup,
} from '@/lib/setup/guard';

export const runtime = 'nodejs';


export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
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

  const body = await request.json();
    // M8.1: strict input validation (email shape, password strength, name bounds).
    const parsed = adminInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'email, password (min 12 chars), and fullName are required' }, { status: 400 });
    }
    const { email, password, fullName } = parsed.data;

  const configPath = join('/app/data', 'supabase-config.json');
  if (!existsSync(configPath)) {
    return NextResponse.json({ error: 'Supabase not configured yet' }, { status: 400 });
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  if (typeof config.serviceRoleKey !== 'string' || !config.serviceRoleKey.startsWith('eyJ')) {
    return NextResponse.json({ error: 'Invalid service role key in config' }, { status: 500 });
  }

  // Executor lock covers the mutating section only (validation above is lock-free).
  if (!acquireDurableLock('create-admin')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }
  try {
    const adminClient = createClient('http://auth:9999', config.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: authUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    } as Parameters<typeof adminClient.auth.admin.createUser>[0]);

    if (createError) {
      return NextResponse.json({ error: `Auth error: ${createError.message}` }, { status: 500 });
    }

    if (!authUser?.user?.id) {
      return NextResponse.json({ error: 'User creation returned no ID' }, { status: 500 });
    }

    const pool = new Pool({
      host: 'db',
      port: 5432,
      database: config.postgresDb,
      user: 'postgres',
      password: config.postgresPassword,
      max: 1,
    });

    try {
      const tenantResult = await pool.query(
        "INSERT INTO tenants (name, slug, tenant_type) VALUES ($1, $2, 'institution') RETURNING id",
        ['My Institution', 'my-institution']
      );
      const tenantId = tenantResult.rows[0].id;

      await pool.query(
        "INSERT INTO profiles (id, user_id, tenant_id, role, full_name) VALUES ($1, $2, $3, 'admin', $4)",
        [authUser.user.id, authUser.user.id, tenantId, fullName]
      );

      auditSetup('create-admin', 'ok');
      return NextResponse.json({ success: true, userId: authUser.user.id, tenantId });
    } finally {
      await pool.end();
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    auditSetup('create-admin', 'error');
    return NextResponse.json({ error: errMsg }, { status: 500 });
  } finally {
    releaseDurableLock('create-admin');
  }
}
