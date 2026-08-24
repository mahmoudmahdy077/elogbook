import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const t0 = Date.now();
  try {
    const supabase = await createServerSupabase();
    // Connectivity/auth/schema probe only: RLS legitimately hides all rows from
    // anon clients, so an empty result set is HEALTHY. Do not use .single() here —
    // PGRST116 on zero rows would false-alarm every deployment.
    const { error } = await supabase.from('tenants').select('id').limit(1);
    if (error) return NextResponse.json({ status: 'unhealthy', db: 'error' }, { status: 503 });
    return NextResponse.json({
      status: 'healthy',
      db: 'ok',
      durationMs: Date.now() - t0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', error: 'unreachable', durationMs: Date.now() - t0 },
      { status: 503 },
    );
  }
}
