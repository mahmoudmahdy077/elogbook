import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness probe — no dependencies, no I/O.
 *
 * Must return 200 whenever the process is running. It is exempt from rate
 * limiting in proxy.ts and is the target of docker-compose's healthcheck
 * (and any orchestrator liveness probe). A transient DB blip must NOT cause
 * the orchestrator to kill the container — that is readiness's job.
 *
 * This handler intentionally performs zero imports of supabase, redis, or
 * any other I/O. A test asserts it by mocking those modules to throw.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
