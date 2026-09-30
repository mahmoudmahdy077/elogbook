import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';

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
  const ip = getClientIp(request);

  const { allowed, retryAfter } = await checkRateLimit(`list-invoices:${ip}`, 15);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
  if (!security.ok) {
    return NextResponse.json(
      { error: security.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: security.status },
    );
  }

  const { profile, tenant } = security.context;
  const { tenant: paramTenant } = await params;
  if (tenant.slug !== paramTenant || !['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
