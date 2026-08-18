import { NextResponse, type NextRequest } from 'next/server';
import { existsSync } from 'fs';

const SETUP_COMPLETE_PATH = '/app/data/.setup-complete';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/setup|api/update|api/uninstall|api/backup|api/health|login|auth|contact|public).*)',
  ],
};

export function middleware(request: NextRequest) {
  const setupMode = process.env.SETUP_MODE === 'true';
  const setupComplete = existsSync(SETUP_COMPLETE_PATH);
  const path = request.nextUrl.pathname;

  // Setup mode: redirect everything to /setup
  if (setupMode && !setupComplete && !path.startsWith('/setup')) {
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = '/setup';
    return NextResponse.redirect(setupUrl);
  }

  // Normal mode: redirect away from /setup
  if (!setupMode && setupComplete && path.startsWith('/setup')) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    return NextResponse.redirect(homeUrl);
  }

  // Uninstall requires setup complete
  if (path.startsWith('/uninstall') && !setupComplete) {
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = '/setup';
    return NextResponse.redirect(setupUrl);
  }

  return NextResponse.next();
}
