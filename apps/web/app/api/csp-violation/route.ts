import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.text();
  console.warn('CSP Violation:', body);
  return new NextResponse(null, { status: 204 });
}