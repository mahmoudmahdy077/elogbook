import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/setup/db-migrator';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest,
  migrateInputSchema, auditSetup,
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

  const body = await request.json();
  const { host, port, database, user, password } = body;

  if (!host || !port || !database || !user || !password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }
  const parsed = migrateInputSchema.safeParse({ host, port, database, user, password });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid connection fields' }, { status: 400 });
  }
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
