import { NextResponse } from 'next/server';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { updateComponentVersion } from '@/lib/setup/version-tracker';
import { execSync } from 'child_process';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest, auditSetup,
} from '@/lib/setup/guard';

export const runtime = 'nodejs';


export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // M8.1/N9: bootstrap boundary + token + origin + rate limit + durable lock.
  // Token use is durably accounted (replay-bounded); IP honors proxy trust.
  const clientIp = clientIpOfRequest(request);
  const gate = checkSetupRequest(
    {
      url: request.url,
      method: 'POST',
      headers: {
        'x-setup-token': request.headers.get('x-setup-token') ?? undefined,
        origin: request.headers.get('origin') ?? undefined,
        referer: request.headers.get('referer') ?? undefined,
      },
      ip: clientIp,
    },
    'complete',
  );
  if (!gate.ok) {
    auditSetup('complete', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('complete', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'complete');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });
  if (!acquireDurableLock('complete')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }

  try {
    // N9 transactional completion: prove every step before writing the
    // marker. A marker without these receipts is an unproven install.
    if (!existsSync('/app/data/supabase-config.json')) {
      return NextResponse.json({ error: 'Setup incomplete: Supabase is not deployed yet' }, { status: 409 });
    }
    try {
      const receipt = JSON.parse(readFileSync('/app/data/migrations-applied.json', 'utf-8')) as {
        applied?: number; errors?: unknown[];
      };
      if (!receipt || (receipt.errors ?? []).length > 0 || (receipt.applied ?? 0) < 1) {
        return NextResponse.json({ error: 'Setup incomplete: migrations have errors or never ran' }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: 'Setup incomplete: no migration receipt found' }, { status: 409 });
    }

    writeFileSync('/app/data/.setup-complete', new Date().toISOString(), 'utf-8');

    const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    updateComponentVersion('elogbook', '1.0.0', commitHash, ['elogbook-web:latest', 'caddy:2']);

    auditSetup('complete', 'ok');
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
    auditSetup('complete', 'error');
    return NextResponse.json({ error: errMsg }, { status: 500 });
  } finally {
    releaseDurableLock('complete');
  }
}
