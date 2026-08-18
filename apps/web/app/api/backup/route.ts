import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { createFullBackup, listBackups } from '@/lib/setup/backup-manager';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const ADMIN_ROLES = ['director', 'institution_admin', 'admin'];

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (!profile || !ADMIN_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
  }
  return { user, profile };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const backups = listBackups('auto');
  return NextResponse.json({ backups });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

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
