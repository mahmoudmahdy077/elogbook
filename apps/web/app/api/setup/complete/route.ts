import { NextResponse } from 'next/server';
import { writeFileSync, existsSync } from 'fs';
import { updateComponentVersion } from '@/lib/setup/version-tracker';
import { execSync } from 'child_process';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST() {
  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  try {
    writeFileSync('/app/data/.setup-complete', new Date().toISOString(), 'utf-8');

    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    updateComponentVersion('elogbook', '1.0.0', commitHash, ['elogbook-web:latest', 'caddy:2']);

    return NextResponse.json({
      success: true,
      message: 'Setup complete. The application will restart in normal mode.',
      urls: {
        app: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        supabase_studio: 'Supabase Studio available at Supabase port',
        supabase_api: 'http://localhost:8000',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
