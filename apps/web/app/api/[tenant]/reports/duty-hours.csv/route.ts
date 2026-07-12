import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit(`csv-export:${ip}`, 10);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const date_from = searchParams.get('date_from') || '';
  const date_to = searchParams.get('date_to') || '';
  const pathParts = request.nextUrl.pathname.split('/');

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let query = supabase
    .from('duty_periods')
    .select('resident_id, shift_date, hours_worked, shift_type')
    .eq('tenant_id', profile.tenant_id);

  if (profile.role === 'resident') {
    query = query.eq('resident_id', profile.id as string);
  }

  if (date_from) query = query.gte('shift_date', date_from);
  if (date_to) query = query.lte('shift_date', date_to);

  const { data: rows, error } = await query.limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const lines = ['Resident ID,Date,Hours Worked,Shift Type'];
  for (const r of (rows ?? [])) {
    lines.push(`"${r.resident_id}","${r.shift_date}",${r.hours_worked},"${r.shift_type}"`);
  }

  const csv = lines.join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="duty-hours.csv"',
    },
  });
}