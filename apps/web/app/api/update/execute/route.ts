import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createFullBackup } from '@/lib/setup/backup-manager';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  const body = await request.json();
  const { component } = body;

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
