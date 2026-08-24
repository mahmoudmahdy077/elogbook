import { NextResponse } from 'next/server';
import { writeCaddyfile, validateDomain } from '@/lib/setup/caddy-config';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST(request: Request) {
  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const body = await request.json();
  const { domain } = body;

  if (!domain) {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 });
  }

  const validation = validateDomain(domain);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const caddyfilePath = writeCaddyfile({ domain, appPort: 3000 });

  return NextResponse.json({ success: true, caddyfilePath, domain });
}
