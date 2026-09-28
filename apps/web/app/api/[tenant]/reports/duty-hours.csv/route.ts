import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { getSecurityContext } from '@/lib/supabase/security-context';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { escapeCsvCell } from '@/lib/csv';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`csv-export:${ip}`, 10);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const date_from = searchParams.get('date_from') || '';
  const date_to = searchParams.get('date_to') || '';
  const pathParts = request.nextUrl.pathname.split('/');
  const tenantSlug = pathParts[2];

  const supabase = await createServerSupabase();
  const security = await getSecurityContext(supabase, { requiredAal: 'aal2' });
  if (!security.ok) {
    return NextResponse.json(
      { error: security.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: security.status },
    );
  }

  const { profile, tenant } = security.context;
  const REPORT_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'];
  if (tenant.slug !== tenantSlug || !REPORT_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let query = supabase
    .from('duty_periods')
    .select('resident_id, shift_date, hours_worked, shift_type')
    .eq('tenant_id', profile.tenant_id);

  if (date_from) query = query.gte('shift_date', date_from);
  if (date_to) query = query.lte('shift_date', date_to);

  const { data: rows, error } = await query.limit(1000);
  if (error) {
    logger.error('Failed to build duty-hours CSV report', error, { tenantSlug });
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }

  const lines = ['Resident ID,Date,Hours Worked,Shift Type'];
  for (const r of (rows ?? [])) {
    lines.push([r.resident_id, r.shift_date, r.hours_worked, r.shift_type].map(escapeCsvCell).join(','));
  }

  const csv = lines.join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="duty-hours.csv"',
    },
  });
}