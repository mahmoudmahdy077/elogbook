import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { checkForUpdates } from '@/lib/setup/version-tracker';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

const ADMIN_ROLES = ['director', 'institution_admin', 'admin'];

export async function GET() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
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

  const [elogbookUpdate, supabaseUpdate] = await Promise.all([
    checkForUpdates('elogbook'),
    checkForUpdates('supabase'),
  ]);

  return NextResponse.json({ elogbook: elogbookUpdate, supabase: supabaseUpdate });
}
