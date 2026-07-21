import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('tenants').select('id').limit(1).single();
    if (error) return NextResponse.json({ status: 'unhealthy', db: 'error' }, { status: 503 });
    return NextResponse.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ status: 'unhealthy', error: 'unreachable' }, { status: 503 });
  }
}
