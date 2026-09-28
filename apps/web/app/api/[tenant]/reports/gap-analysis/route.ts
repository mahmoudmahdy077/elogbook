import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { outboundRequestJson } from '@/lib/outbound-request';
import { z } from 'zod';

const gapAnalysisSchema = z.object({ resident_id: z.string().uuid() }).strict();

/**
 * POST /api/[tenant]/reports/gap-analysis
 * Body: { resident_id: string }
 *
 * Competency gap analysis for a single resident. Proxies the
 * `ai-gap-analysis` Supabase Edge Function with the caller's JWT so the
 * edge-side role gate (supervisor+) and RLS apply.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, gapAnalysisSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 4 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  // ---- CSRF (state-changing) + rate limit ----
  const ip = getClientIp(request);

  const { allowed, retryAfter } = await checkRateLimit(`gap-analysis:${ip}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
  if (!security.ok) {
    return NextResponse.json(
      { error: security.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: security.status },
    );
  }

  const { user, profile, tenant } = security.context;
  const { tenant: paramTenant } = await params;
  if (tenant.slug !== paramTenant || !['supervisor', 'director', 'institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const residentId = guarded.data.resident_id;

  // The target resident must belong to the caller's tenant.
  const { data: targetResident } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', residentId)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();
  if (!targetResident) {
    return NextResponse.json({ error: 'Resident not found in this tenant' }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!supabaseUrl) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  const { data: sess } = await supabase.auth.getSession();
  const accessToken = sess.session?.access_token;
  let supabaseHost: string;
  try {
    supabaseHost = new URL(supabaseUrl).hostname;
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const result = await outboundRequestJson<unknown>(`${supabaseUrl}/functions/v1/ai-gap-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken ?? anonKey}`,
    },
    body: JSON.stringify({ resident_id: residentId }),
    allowedHosts: [supabaseHost],
    requireAllowlist: true,
    timeoutMs: 20_000,
    maxResponseBytes: 256 * 1024,
    maxConcurrent: 4,
  });

  if (!result.ok || result.data === undefined) {
    const status = result.category === 'timeout' ? 504 : 502;
    return NextResponse.json({ error: 'Gap analysis unavailable' }, { status });
  }
  return new NextResponse(JSON.stringify(result.data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
