import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { safeRelativePath } from '@/lib/safe-redirect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const PAGE_SIZE = 20;
const MAX_EXPORT_ROWS = 5000;
const ALLOWED_ROLES: UserRole[] = ['director', 'institution_admin', 'admin'];

const SUSPICIOUS_ACTIONS = [
  'login_failed',
  'role_change',
  'cross_tenant_access',
  'bulk_export',
  'audit_export',
  'sso_start',
];

function isSuspicious(action: string): boolean {
  return SUSPICIOUS_ACTIONS.includes(action);
}

function escapeCsv(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const headers = ['id', 'created_at', 'action', 'resource_type', 'resource_id', 'user_id', 'ip_address'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsv(r[h])).join(','));
  }
  return lines.join('\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const sp = request.nextUrl.searchParams;
  const format = sp.get('format') === 'json' ? 'json' : 'csv';
  const date_from = sp.get('date_from');
  const date_to = sp.get('date_to');
  const action_type = sp.get('action_type');
  const resource_type = sp.get('resource_type');
  const user_id = sp.get('user_id');
  const view = sp.get('view');

  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }
  if (!ALLOWED_ROLES.includes(auth.profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { allowed, retryAfter } = await checkRateLimit(`audit-export:${auth.user.id}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();

  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('tenant_id', auth.profile.tenant_id)
    .order('created_at', { ascending: false })
    .limit(MAX_EXPORT_ROWS);

  if (action_type) query = query.eq('action', action_type);
  else if (view === 'suspicious') query = query.in('action', SUSPICIOUS_ACTIONS);
  if (resource_type) query = query.eq('resource_type', resource_type);
  if (user_id) query = query.eq('user_id', user_id);
  if (date_from) query = query.gte('created_at', date_from);
  if (date_to) query = query.lte('created_at', date_to);

  const { data: logs, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (logs ?? []) as Record<string, unknown>[];

  // Audit the export (defence-in-depth: a privileged user exporting
  // data should leave a trace).
  // Use service_role client to bypass RLS (which blocks authenticated INSERTs).
  const adminClient = createServiceRoleClient();
  await adminClient.from('audit_logs').insert({
    tenant_id: auth.profile.tenant_id,
    action: 'audit_export',
    resource_type: 'audit',
    resource_id: null,
    user_id: auth.user.id,
    metadata: {
      format,
      row_count: rows.length,
      filters: { action_type, resource_type, user_id, date_from, date_to, view },
    },
  });

  const body = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
  const contentType = format === 'json' ? 'application/json' : 'text/csv';
  const filename = `audit-${tenantSlug}-${new Date().toISOString().slice(0, 10)}.${format}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
