// apps/web/app/api/email/unsubscribe/route.ts
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
function validToken(email: string, token: string, key: string): boolean {
  const expectedHex = createHmac('sha256', key).update(email.toLowerCase()).digest('hex');
  try {
    const a = Buffer.from(token.trim().toLowerCase(), 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
export async function GET(request: Request) {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') ?? '').toLowerCase();
  const token = url.searchParams.get('token') ?? '';
  if (!email || !validToken(email, token, key)) return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  await createServiceRoleClient().from('email_suppressions').upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email' });
  return new Response('<p>Unsubscribed.</p>', { headers: { 'Content-Type': 'text/html' } });
}
