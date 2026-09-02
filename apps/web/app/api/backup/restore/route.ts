import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { restoreFromBackup } from '@/lib/setup/backup-manager';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const ADMIN_ROLES = ['director', 'institution_admin', 'admin'];

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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
