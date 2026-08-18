import { NextResponse } from 'next/server';
import { restoreFromBackup } from '@/lib/setup/backup-manager';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json();
  const { backupId } = body;

  if (!backupId) {
    return NextResponse.json({ error: 'backupId is required' }, { status: 400 });
  }

  const configPath = join('/app/data', 'supabase-config.json');
  if (!existsSync(configPath)) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 400 });
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  const result = await restoreFromBackup(backupId, {
    host: 'db', port: 5432, database: config.postgresDb, user: 'postgres', password: config.postgresPassword,
  });

  return NextResponse.json(result);
}
