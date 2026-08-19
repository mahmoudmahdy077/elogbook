import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST(request: Request) {
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

  try {
    // Semgrep false positive: HTTP is acceptable for internal Docker services
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const authResponse = await fetch('http://auth:9999/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.serviceRoleKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }),
    });

    if (!authResponse.ok) {
      const error = await authResponse.text();
      return NextResponse.json({ error: `Auth error: ${error}` }, { status: 500 });
    }

    const authUser = await authResponse.json() as { id: string };

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
        [authUser.id, authUser.id, tenantId, fullName]
      );

      return NextResponse.json({ success: true, userId: authUser.id, tenantId });
    } finally {
      await pool.end();
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
