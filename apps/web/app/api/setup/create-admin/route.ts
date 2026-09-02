import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const body = await request.json();
  const { email, password, fullName } = body;

  if (!email || !password || !fullName) {
    return NextResponse.json({ error: 'email, password, and fullName are required' }, { status: 400 });
  }

  const configPath = join('/app/data', 'supabase-config.json');
  if (!existsSync(configPath)) {
    return NextResponse.json({ error: 'Supabase not configured yet' }, { status: 400 });
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  if (typeof config.serviceRoleKey !== 'string' || !config.serviceRoleKey.startsWith('eyJ')) {
    return NextResponse.json({ error: 'Invalid service role key in config' }, { status: 500 });
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

      return NextResponse.json({ success: true, userId: authUser.user.id, tenantId });
    } finally {
      await pool.end();
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
