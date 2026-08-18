import { NextResponse } from 'next/server';
import { createFullBackup, listBackups } from '@/lib/setup/backup-manager';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

export async function GET() {
  const backups = listBackups('auto');
  return NextResponse.json({ backups });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { type = 'manual' } = body;

  const configPath = join('/app/data', 'supabase-config.json');
  if (!existsSync(configPath)) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  const manifest = await createFullBackup(type, {
    host: 'db', port: 5432, database: config.postgresDb, user: 'postgres', password: config.postgresPassword,
  }, { elogbook: '1.0.0', supabase: '1.0.0' });

  return NextResponse.json({ success: true, manifest });
}
