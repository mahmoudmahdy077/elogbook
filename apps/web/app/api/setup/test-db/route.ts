import { NextResponse } from 'next/server';
import { testConnection } from '@/lib/setup/db-migrator';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function POST(request: Request) {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const body = await request.json();
  const { host, port, database, user, password } = body;

  if (!host || !port || !database || !user || !password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  const result = await testConnection(host, port, database, user, password);
  return NextResponse.json(result);
}
