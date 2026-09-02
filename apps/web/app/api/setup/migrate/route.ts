import { NextResponse } from 'next/server';
import { runMigrations } from '@/lib/setup/db-migrator';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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
  const { host, port, database, user, password } = body;

  const configPath = join('/app/data', 'supabase-config.json');
  let dbConfig = { host: 'db', port: 5432, database: 'supabase', user: 'postgres', password: '' };

  if (existsSync(configPath)) {
    const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    dbConfig = {
      host: host || 'db',
      port: port || 5432,
      database: database || savedConfig.postgresDb || 'supabase',
      user: user || 'postgres',
      password: password || savedConfig.postgresPassword,
    };
  } else if (host && password) {
    dbConfig = { host, port: port || 5432, database: database || 'supabase', user: user || 'postgres', password };
  }

  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
  const results = await runMigrations(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, migrationsDir);

  const errors = results.filter(r => r.status === 'error');
  return NextResponse.json({
    success: errors.length === 0,
    total: results.length,
    applied: results.filter(r => r.status === 'success').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: errors.map(e => ({ file: e.file, error: e.error })),
  });
}
