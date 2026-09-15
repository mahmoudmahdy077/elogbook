import { NextResponse } from 'next/server';
import { checkAllRequirements, allPassed } from '@/lib/setup/requirement-checks';
import { checkSetupRequest, checkRateLimit, clientIpOfRequest, auditSetup } from '@/lib/setup/guard';

export const runtime = 'nodejs';


export async function GET(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  // M8.1: bootstrap boundary + token + origin + rate limit (read-only: no executor lock).
  const gate = checkSetupRequest(
    { url: request.url, method: 'GET', headers: { origin: request.headers.get('origin') ?? undefined }, ip: clientIpOfRequest(request) },
    'check-requirements',
  );
  if (!gate.ok) {
    auditSetup('check-requirements', 'denied');
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const rl = checkRateLimit(clientIpOfRequest(request), 'check-requirements');
  if (!rl.ok) return NextResponse.json({ error: rl.error }, { status: rl.status });

  const checks = await checkAllRequirements();
  auditSetup('check-requirements', 'ok');
  return NextResponse.json({ checks, ready: allPassed(checks) });
}
