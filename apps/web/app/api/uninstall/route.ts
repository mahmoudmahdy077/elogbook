import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createFullBackup } from '@/lib/setup/backup-manager';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  const body = await request.json();
  const { scope, confirm } = body;

  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE to confirm' }, { status: 400 });
  }

  const configPath = join('/app/data', 'supabase-config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) : null;

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
