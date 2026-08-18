import { NextResponse } from 'next/server';
import { checkAllRequirements, allPassed } from '@/lib/setup/requirement-checks';
import { existsSync } from 'fs';

export const runtime = 'nodejs';

function isSetupAllowed(): boolean {
  if (process.env.SETUP_MODE !== 'true') return false;
  return !existsSync('/app/data/.setup-complete');
}

export async function GET() {
  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'Setup not available' }, { status: 403 });
  }

  const checks = await checkAllRequirements();
  return NextResponse.json({ checks, ready: allPassed(checks) });
}
