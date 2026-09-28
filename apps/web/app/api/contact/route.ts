import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Message too large' }, { status: 413 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = await checkRateLimit(`contact:${ip}`, 5);
  if (!allowed) return rateLimitResponse(retryAfter);

  let body: { name?: string; email?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name ?? '').trim().slice(0, 200);
  const email = (body.email ?? '').trim().slice(0, 320);
  const message = (body.message ?? '').trim().slice(0, 5000);

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'name, email and message are required' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: submission, error } = await admin
    .from('contact_submissions')
    .insert({ name, email, message })
    .select('id')
    .single();
  if (error || !submission) {
    return NextResponse.json({ error: 'Could not store message' }, { status: 500 });
  }

  const contactAlertTo = process.env.CONTACT_ALERT_TO?.trim().toLowerCase() || '';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '') || '';
  let warning: string | undefined;
  if (!contactAlertTo || !EMAIL_RE.test(contactAlertTo) || !siteUrl) {
    warning = 'Contact alert email is not configured; message stored but alert not queued.';
  } else {
    const contactUrl = `${siteUrl}/platform/contact-submissions/${submission.id}`;
    const { error: queueError } = await admin.from('email_queue').insert({
      template_key: 'contact.admin-alert',
      to_email: contactAlertTo,
      payload: { contact_url: contactUrl },
      priority: 5,
    });
    if (queueError) {
      return NextResponse.json({ error: 'Message stored but operator alert could not be queued' }, { status: 503 });
    }
  }

  return NextResponse.json({
    success: true,
    message: 'Thank you for your inquiry. We will respond within 1 business day.',
    ...(warning ? { warning } : {}),
  });
}
