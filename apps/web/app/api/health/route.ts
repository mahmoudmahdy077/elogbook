import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { newRequestId, requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDGE_FUNCTION_HEALTH_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/_health`
  : null;

export async function GET(request: Request) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : newRequestId();

  return requestContext.run({ requestId, route: '/api/health', method: 'GET' }, async () => {
    const start = Date.now();
    const checks: Record<string, string> = {};
    let overallStatus: 'healthy' | 'degraded' = 'healthy';

    try {
      const supabase = await createServerSupabase();

      // ── Database check ──────────────────────────────────────────────
      const { error: dbError } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      checks.database = dbError ? `unreachable: ${dbError.message}` : 'reachable';
      if (dbError) overallStatus = 'degraded';

      // ── Auth check ──────────────────────────────────────────────────
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError) {
        checks.auth = `unreachable: ${authError.message}`;
        overallStatus = 'degraded';
      } else if (!authData?.user) {
        // No active session — the endpoint is reachable but unauthenticated.
        // This is normal for health probes that don't carry a session cookie.
        checks.auth = 'reachable (no session)';
      } else {
        checks.auth = 'reachable';
      }

      // ── Edge Functions check ───────────────────────────────────────
      if (EDGE_FUNCTION_HEALTH_URL) {
        try {
          const edgeResp = await fetch(EDGE_FUNCTION_HEALTH_URL, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5_000),
          });
          checks.edge_functions = edgeResp.ok ? 'reachable' : `error: ${edgeResp.status}`;
          if (!edgeResp.ok) overallStatus = 'degraded';
        } catch (efErr) {
          checks.edge_functions = `unreachable: ${(efErr as Error).message}`;
          overallStatus = 'degraded';
        }
      } else {
        checks.edge_functions = 'skipped (no URL configured)';
      }
    } catch (err) {
      return NextResponse.json(
        {
          status: 'error',
          error: (err as Error).message,
          checks,
          durationMs: Date.now() - start,
        },
        { status: 503, headers: { 'X-Request-Id': requestId } },
      );
    }

    const httpStatus = overallStatus === 'healthy' ? 200 : 503;

    return NextResponse.json(
      {
        status: overallStatus,
        checks,
        durationMs: Date.now() - start,
      },
      { status: httpStatus, headers: { 'X-Request-Id': requestId } },
    );
  });
}
