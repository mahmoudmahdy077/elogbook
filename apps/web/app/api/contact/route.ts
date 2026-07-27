import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request) {
  return NextResponse.json({ success: true, message: 'Thank you for your inquiry. We will respond within 1 business day.' });
}
