import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

/**
 * GET /api/[tenant]/billing/invoices
 *
 * Invoice history for the tenant's active subscription. Proxies the
 * `list-invoices` Supabase Edge Function with the caller's JWT. The
 * edge function verifies ownership (requested customer must match the
 * subscription's stripe_customer_id) before calling Stripe.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  // ---- Rate limit by IP ----
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const { allowed, retryAfter } = await checkRateLimit(`list-invoices:${ip}`, 15);
  if (!allowed) return rateLimitResponse(retryAfter);

  // ---- Auth ----
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as unknown as { slug: string };
  const { tenant: paramTenant } = await params;
  if (tenant.slug !== paramTenant) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  // Billing is admin-only, mirroring the billing page gate.
  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // ---- Resolve the tenant's Stripe customer id ----
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();

  const customerId = (subscription as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (!customerId) {
    // No billing customer yet — empty history is the correct answer.
    return NextResponse.json({ invoices: [] });
  }

  // ---- Proxy to the edge function with the user's JWT ----
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const fnUrl = `${supabaseUrl}/functions/v1/list-invoices?customer_id=${encodeURIComponent(customerId)}`;
    const res = await fetch(fnUrl, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const payload = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: payload || `Edge function ${res.status}` },
        { status: res.status >= 500 ? 502 : res.status },
      );
    }

    return new NextResponse(payload, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Invoice lookup timed out' }, { status: 504 });
    }
    return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 });
  }
}
