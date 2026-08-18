import { NextResponse } from 'next/server';
import { checkForUpdates } from '@/lib/setup/version-tracker';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

export async function GET() {
  if (!existsSync('/app/data/.setup-complete')) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  const [elogbookUpdate, supabaseUpdate] = await Promise.all([
    checkForUpdates('elogbook'),
    checkForUpdates('supabase'),
  ]);

  return NextResponse.json({ elogbook: elogbookUpdate, supabase: supabaseUpdate });
}
