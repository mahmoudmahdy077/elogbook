import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { logger } from '@/lib/logger';

const ADMIN_ROLES = ['institution_admin', 'admin'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantSlug = request.nextUrl.pathname.split('/')[1];
  const search = searchParams.get('search') || '';
  const role = searchParams.get('role') || '';
  const status = searchParams.get('status') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, ADMIN_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const { allowed, retryAfter } = await checkRateLimit(`admin-users:${tenantSlug}`, 120);
  if (!allowed) return rateLimitResponse(retryAfter);

  let query = supabase
    .from('profiles')
    .select('id, user_id, tenant_id, role, full_name, specialty, status, created_at, last_login_at, deactivated_at', { count: 'exact' })
    .eq('tenant_id', profile.tenant_id);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,specialty.ilike.%${search}%`);
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
    logger.error('Failed to list tenant users', error, { tenantSlug, page, limit });
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }

  return NextResponse.json({
    users: users ?? [],
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  });
}
