import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

const ADMIN_ROLES = ['institution_admin', 'admin'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const role = searchParams.get('role') || '';
  const status = searchParams.get('status') || '';
  // Clamp before they reach PostgREST: an unbounded `limit` is a cheap way to
  // dump the tenant's profile table in one request.
  const page = Math.max(Number.parseInt(searchParams.get('page') || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 100);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles') // tenant-scope-exempt: user-scoped lookup by user_id (1:1), not a tenant list
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { allowed, retryAfter } = await checkRateLimit(`admin-users:${tenantSlug}`, 120);
  if (!allowed) return rateLimitResponse(retryAfter);

  if (!ADMIN_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let query = supabase
    .from('profiles')
    .select('id, user_id, tenant_id, role, full_name, specialty, status, created_at, last_login_at, deactivated_at', { count: 'exact' })
    .eq('tenant_id', profile.tenant_id);

  if (search) {
    // `or()` is a raw PostgREST filter: commas/parentheses alter the
    // expression, so strip them instead of interpolating caller input.
    const term = search.replace(/[(),*]/g, ' ').trim().slice(0, 100);
    if (term) {
      query = query.or(`full_name.ilike.%${term}%,specialty.ilike.%${term}%`);
    }
  }
  if (role) {
    query = query.eq('role', role);
  }
  if (status) {
    query = query.eq('status', status);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data: users, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.error('[admin/users] list failed:', error.message);
    return NextResponse.json({ error: 'Could not load users' }, { status: 500 });
  }

  return NextResponse.json({
    users: users ?? [],
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  });
}
