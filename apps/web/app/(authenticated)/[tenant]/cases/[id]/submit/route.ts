import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { submitDraftEntry } from '@/lib/cases/submit-entry';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  // P6.3: custom span around the case-submit hot path. Wraps the
  // CSRF, rate-limit, ownership, and approval-creation logic so the
  // trace shows the real production p95 in Sentry Performance.
  return await Sentry.startSpan(
    { name: 'cases.submit', op: 'http.server' },
    async (span) => {
      const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
      if (csrfError) {
        span?.setAttribute('csrf.failed', true);
        return csrfError;
      }
      return await handleSubmit(request, await params, span);
    }
  );
}

async function handleSubmit(
  request: Request,
  params: { tenant: string; id: string },
  _span: Sentry.Span | undefined
) {

  const { tenant: tenantSlug, id } = params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // P1.6: Tenant-slug URL validation — ensure the slug in the URL matches
  // the authenticated user's tenant before processing the submission.
  // This is a defense-in-depth check; the middleware also validates tenant
  // scope for all protected routes.
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (callerProfile) {
    const callerTenant = callerProfile.tenants as unknown as { slug: string } | null;
    if (callerTenant && callerTenant.slug !== tenantSlug) {
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }
  }

  const { allowed, retryAfter } = await checkRateLimit(`cases-submit:${user.id}:${id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  // Shared with the bearer-auth mobile API: identical rules on both clients.
  const result = await submitDraftEntry(supabase, user, id);
  return NextResponse.json(result.body, { status: result.status });
}
