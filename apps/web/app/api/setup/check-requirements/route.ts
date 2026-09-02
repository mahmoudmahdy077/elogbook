import { NextResponse } from 'next/server';
import { checkAllRequirements, allPassed } from '@/lib/setup/requirement-checks';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function GET() {
  // D-5: control plane must be absent in PHI/production build — Gate C probes 404.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const checks = await checkAllRequirements();
  return NextResponse.json({ checks, ready: allPassed(checks) });
}
