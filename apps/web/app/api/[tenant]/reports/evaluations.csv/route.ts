import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { getClientIp } from '@/lib/client-ip';
import { escapeCsvCell } from '@/lib/csv';

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || !profile.tenants || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const REPORT_ROLES = ['supervisor', 'director', 'institution_admin', 'admin'];
  if (!REPORT_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let query = supabase
    .from('faculty_evaluations')
    .select('resident_id, evaluator_id, evaluation_date, clinical_skills, professionalism, procedures, comments')
    .eq('tenant_id', profile.tenant_id);

  if (date_from) query = query.gte('evaluation_date', date_from);
  if (date_to) query = query.lte('evaluation_date', date_to);

  const { data: evals, error } = await query.limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const lines = ['Resident ID,Evaluator ID,Date,Clinical Skills,Professionalism,Procedures,Comments'];
  for (const e of (evals ?? [])) {
    lines.push([e.resident_id, e.evaluator_id || '', e.evaluation_date, e.clinical_skills || '', e.professionalism || '', e.procedures || '', e.comments || ''].map(escapeCsvCell).join(','));
  }

  const csv = lines.join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="evaluations.csv"',
    },
  });
}