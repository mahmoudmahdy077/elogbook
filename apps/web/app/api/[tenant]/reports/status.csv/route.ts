import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
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
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || !profile.tenants || (profile.tenants as { slug: string }[]).some((t: { slug: string }) => t.slug !== tenantSlug)) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  let query = supabase
    .from('case_entries')
    .select('status')
    .eq('tenant_id', profile.tenant_id);

  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);

  const { data: entries, error } = await query.limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const statusCounts: Record<string, number> = { draft: 0, pending: 0, approved: 0, rejected: 0 };
  for (const e of (entries ?? [])) {
    const status = e.status as string;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const csv = ['Status,Count', ...Object.entries(statusCounts).map(([s, c]) => `"${s}",${c}`)].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="status-distribution.csv"',
    },
  });
}