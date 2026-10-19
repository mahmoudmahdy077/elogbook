import { NextResponse } from 'next/server';
import { existsSync, unlinkSync } from 'fs';
import { getVersions, saveVersions, updateComponentVersion } from '@/lib/setup/version-tracker';
import { parseAppReleaseCommit } from '@elogbook/env';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest, auditSetup, setupRuntimeEnabled,
  writeSetupMarkerAtomically, verifySetupReceipts, removeSetupMarker,
} from '@/lib/setup/guard';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';


export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (!setupRuntimeEnabled()) {
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
        'x-forwarded-proto': request.headers.get('x-forwarded-proto') ?? undefined,
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

  const previousVersions = getVersions();
  let versionWritten = false;

  try {
    // N9 transactional completion: prove every step before writing the
    // marker. A marker without these receipts is an unproven install.
    if (!existsSync('/app/data/supabase-config.json')) {
      return NextResponse.json({ error: 'Setup incomplete: Supabase is not deployed yet' }, { status: 409 });
    }
    const receipts = verifySetupReceipts();
    if (!receipts.ok) {
      return NextResponse.json({ error: receipts.error }, { status: receipts.status });
    }

    const commitHash = parseAppReleaseCommit(process.env.APP_RELEASE_COMMIT);
    versionWritten = true;
    updateComponentVersion('elogbook', '1.0.0', commitHash, ['elogbook-web:latest', 'caddy:2']);
    writeSetupMarkerAtomically();

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
    if (versionWritten) {
      if (previousVersions) {
        saveVersions(previousVersions);
      } else {
        try {
          unlinkSync('/app/data/versions.json');
        } catch {
          void 0;
        }
      }
    }
    removeSetupMarker();
    logger.error('Setup completion failed', error);
    auditSetup('complete', 'error');
    return NextResponse.json({ error: 'Setup completion failed' }, { status: 500 });
  } finally {
    releaseDurableLock('complete');
  }
}
