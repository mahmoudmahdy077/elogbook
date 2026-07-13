import { NextResponse } from 'next/server';

// P1.4: SSO disabled until complete SAML/OIDC implementation is verified
export async function GET() {
  return NextResponse.json({ available: false }, { status: 503 });
}
