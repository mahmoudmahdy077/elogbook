import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { checkForUpdates } from '@/lib/setup/version-tracker';
import { listBackups } from '@/lib/setup/backup-manager';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

/** Marker path for completed setup; overridable for tests. */
function setupMarkerPath(): string {
  return process.env.SETUP_COMPLETE_PATH ?? '/app/data/.setup-complete';
}

export async function GET() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!existsSync(setupMarkerPath())) {
    return NextResponse.json({ error: 'Setup not complete' }, { status: 400 });
  }

  // T16: update management is platform-operator-only. Tenant admins and
  // directors are denied here as well as in the UI.
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  const [elogbookUpdate, supabaseUpdate] = await Promise.all([
    checkForUpdates('elogbook'),
    checkForUpdates('supabase'),
  ]);

  // Backup freshness the operator must confirm before any update.
  const backups = listBackups('auto');
  const latest = backups.length > 0 ? backups[0] : null;

  return NextResponse.json({
    elogbook: elogbookUpdate,
    supabase: supabaseUpdate,
    backup: latest
      ? { count: backups.length, latest_at: latest.created_at, latest_id: latest.backup_id }
      : { count: 0, latest_at: null, latest_id: null },
  });
}
