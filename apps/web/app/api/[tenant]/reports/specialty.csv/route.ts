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
    .from('case_entries')
    .select('case_templates!inner(specialty), status')
    .eq('tenant_id', profile.tenant_id);

  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);

  const { data: entries, error } = await query.limit(1000);
  if (error) {
    logger.error('Failed to build specialty CSV report', error, { tenantSlug });
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }

  const specialtyCounts: Record<string, number> = {};
  for (const e of (entries ?? [])) {
    const templates = e.case_templates as { specialty: string }[];
    const spec = templates[0]?.specialty ?? 'Unknown';
    specialtyCounts[spec] = (specialtyCounts[spec] || 0) + 1;
  }

  const csv = ['Specialty,Count', ...Object.entries(specialtyCounts).map(([s, c]) => [s, c].map(escapeCsvCell).join(','))].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="specialty-distribution.csv"',
    },
  });
}