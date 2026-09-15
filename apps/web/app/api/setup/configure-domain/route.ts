import { NextResponse } from 'next/server';
import { writeCaddyfile, validateDomain } from '@/lib/setup/caddy-config';
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
    'configure-domain',
  );
  if (!gate.ok) {
    auditSetup('configure-domain', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const consumed = consumeSetupToken(
    request.headers.get('x-setup-token') ?? undefined, process.env.SETUP_BOOTSTRAP_TOKEN,
  );
  if (!consumed.ok) {
    auditSetup('configure-domain', 'denied');
    return NextResponse.json({ error: consumed.error }, { status: consumed.status });
  }
  const rl = checkRateLimit(clientIp, 'configure-domain');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const body = await request.json();
  const { domain } = body;

  if (!domain) {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
  }

  const validation = validateDomain(domain);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  if (!acquireDurableLock('configure-domain')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }

  try {
    const caddyfilePath = writeCaddyfile({ domain, appPort: 3000 });
    auditSetup('configure-domain', 'ok');
    return NextResponse.json({ success: true, caddyfilePath, domain });
  } finally {
    releaseDurableLock('configure-domain');
  }
}
