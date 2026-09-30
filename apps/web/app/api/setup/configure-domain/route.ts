import { NextResponse } from 'next/server';
import { writeCaddyfile, validateDomain } from '@/lib/setup/caddy-config';
import {
  checkSetupRequest, checkRateLimit, acquireDurableLock, releaseDurableLock,
  consumeSetupToken, clientIpOfRequest, auditSetup, domainInputSchema, setupRuntimeEnabled,
  writeSetupReceiptAtomically, removeSetupReceipt,
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

  const guarded = await guardRequest(request, domainInputSchema, {
    requireOrigin: false,
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;
  const { domain } = guarded.data;

  const validation = validateDomain(domain);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  if (!acquireDurableLock('configure-domain')) {
    return NextResponse.json({ error: 'Another setup operation is running' }, { status: 409 });
  }
  removeSetupReceipt('setup-domain.json');

  try {
    const caddyfilePath = writeCaddyfile({ domain, appPort: 3000 });
    writeSetupReceiptAtomically('setup-domain.json', {
      success: true,
      completed_at: new Date().toISOString(),
      domain,
    });
    auditSetup('configure-domain', 'ok');
    return NextResponse.json({ success: true, caddyfilePath, domain });
  } catch {
    removeSetupReceipt('setup-domain.json');
    auditSetup('configure-domain', 'error');
    return NextResponse.json({ error: 'Domain configuration failed' }, { status: 500 });
  } finally {
    releaseDurableLock('configure-domain');
  }
}
