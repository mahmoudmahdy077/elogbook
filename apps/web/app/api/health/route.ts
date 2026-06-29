import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { newRequestId, requestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && /^[\w-]{1,128}$/.test(incoming) ? incoming : newRequestId();

  return requestContext.run({ requestId, route: '/api/health', method: 'GET' }, async () => {
    const start = Date.now();
    try {
      const supabase = await createServerSupabase();
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).limit(1);
      const dbOk = !error;
      const status = dbOk ? 'ok' : 'degraded';
      return NextResponse.json(
        { status, database: dbOk ? 'reachable' : 'unreachable', durationMs: Date.now() - start },
        { status: dbOk ? 200 : 503, headers: { 'X-Request-Id': requestId } },
      );
    } catch (err) {
      return NextResponse.json(
        { status: 'error', error: (err as Error).message, durationMs: Date.now() - start },
        { status: 503, headers: { 'X-Request-Id': requestId } },
      );
    }
  });
}
