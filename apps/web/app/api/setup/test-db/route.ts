import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/setup/db-migrator';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest,
  migrateInputSchema, auditSetup, setupRuntimeEnabled,
} from '@/lib/setup/guard';
import { guardRequest } from '@/lib/http/request-guard';

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
    'test-db',
  );
  if (!gate.ok) {
    auditSetup('test-db', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('test-db', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'test-db');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const guarded = await guardRequest(request, migrateInputSchema, {
    requireOrigin: false,
    maxBodyBytes: 16 * 1024,
  });
  if (!guarded.ok) return guarded.response;
  const { host, port, database, user, password = '' } = guarded.data;
  if (!acquireDurableLock('test-db')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }

  try {
    const result = await testConnection(host, port, database, user, password);
    auditSetup('test-db', 'ok');
    return NextResponse.json(result);
  } finally {
    releaseDurableLock('test-db');
  }
}
