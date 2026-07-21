import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

const MAX_BODY_BYTES = 4096;

export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (parsed && typeof parsed === 'object' && 'csp-report' in parsed) {
    Sentry.captureMessage('CSP Violation', {
      level: 'info',
      extra: { report: parsed },
    });
  }
  return new NextResponse(null, { status: 204 });
}
